import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import * as Electron from "electron"
import { program } from "./app/DesktopApp"
import { DesktopEnvironment } from "./app/DesktopEnvironment"
import { layerElectronApp } from "./electron/live/ElectronApp"
import { layerElectronDialog } from "./electron/live/ElectronDialog"
import { layerElectronMenu } from "./electron/live/ElectronMenu"
import { layerElectronProtocol, registerSchemePrivileges } from "./electron/live/ElectronProtocol"
import { layerElectronShell } from "./electron/live/ElectronShell"
import { layerElectronUpdater } from "./electron/live/ElectronUpdater"
import { layerElectronWindow } from "./electron/live/ElectronWindow"
import { GameCreator } from "./game/GameCreator"
import { GameHost } from "./game/GameHost"
import { GameLink } from "./game/GameLink"
import { GamePaths } from "./game/GamePaths"
import { GamePlay } from "./game/GamePlay"
import { GameProcess } from "./game/GameProcess"
import { SteamLibrary } from "./game/SteamLibrary"
import { DesktopIpc } from "./ipc/DesktopIpc"
import { NotificationLog } from "./notifications/NotificationLog"
import { layerProjects } from "./project/layers"
import { Recovery } from "./project/Recovery"
import { WindowRegistry } from "./project/WindowRegistry"
import { DesktopSettings } from "./settings/DesktopSettings"
import { SiteAccount, SiteSeal } from "./site/SiteAccount"
import { SiteClient } from "./site/SiteClient"
import { DesktopUpdates } from "./updates/DesktopUpdates"
import { CollectClient } from "./usage/CollectClient"
import { UsageStats } from "./usage/UsageStats"
import { DesktopWindow } from "./window/DesktopWindow"
import { WindowLauncher } from "./window/WindowLauncher"
import { WindowStage } from "./window/WindowStage"

// The Electron main process (docs/DESKTOP.md § Main process). Electron only grants scheme privileges before
// `ready`, so this runs synchronously at load, before the runtime starts.
registerSchemePrivileges()

// scripts/dev-electron.ts keeps each checkout's dev profile in that checkout. Set before `ready`, so the session's
// storage (localStorage) moves with it.
const userDataDir = process.env["BALLEST_USER_DATA_DIR"]
if (userDataDir !== undefined) Electron.app.setPath("userData", userDataDir)

const layerElectron = Layer.mergeAll(
  layerElectronApp,
  layerElectronDialog,
  layerElectronMenu,
  layerElectronShell,
  layerElectronUpdater,
  layerElectronWindow,
  layerElectronProtocol,
  WindowStage.layer,
  DesktopIpc.layer(Electron.ipcMain)
)

/** The site token at rest, sealed with the OS's own keystore where it has one (`safeStorage`). */
const layerSiteSeal = Layer.succeed(
  SiteSeal,
  SiteSeal.of({
    seal: (text) =>
      Effect.promise(async () =>
        await Electron.safeStorage.isAsyncEncryptionAvailable()
          ? `safe:${(await Electron.safeStorage.encryptStringAsync(text)).toString("base64")}`
          : `plain:${text}`
      ),
    open: (sealed) =>
      Effect.tryPromise(async () => {
        if (sealed.startsWith("plain:")) return Option.some(sealed.slice("plain:".length))
        if (!sealed.startsWith("safe:") || !(await Electron.safeStorage.isAsyncEncryptionAvailable())) {
          return Option.none<string>()
        }
        const { result } = await Electron.safeStorage.decryptStringAsync(
          Buffer.from(sealed.slice("safe:".length), "base64")
        )
        return Option.some(result)
      }).pipe(Effect.orElseSucceed(() => Option.none()))
  })
)

const layerGame = Layer.mergeAll(GameCreator.layer, GameLink.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(GamePaths.layer, GameProcess.layer)),
  Layer.provide(SteamLibrary.layer),
  Layer.provideMerge(GameHost.layer)
)

const layerProjectsAndGame = Layer.merge(layerProjects, Recovery.layer).pipe(
  Layer.provideMerge(layerGame),
  Layer.provideMerge(WindowRegistry.layer)
)

const layerDesktopRuntime = Layer.mergeAll(
  DesktopWindow.layer,
  DesktopUpdates.layer,
  WindowLauncher.layer,
  NotificationLog.layer,
  GamePlay.layer,
  UsageStats.layer,
  SiteAccount.layer
).pipe(
  Layer.provideMerge(CollectClient.layer((url, init) => Electron.net.fetch(url, init))),
  Layer.provideMerge(SiteClient.layer((url, init) => Electron.net.fetch(url, init))),
  Layer.provideMerge(layerSiteSeal),
  Layer.provideMerge(layerProjectsAndGame),
  Layer.provideMerge(DesktopSettings.layer),
  Layer.provideMerge(DesktopEnvironment.layer(__dirname)),
  Layer.provideMerge(layerElectron),
  Layer.provideMerge(NodeServices.layer)
)

program.pipe(Effect.provide(layerDesktopRuntime), NodeRuntime.runMain)
