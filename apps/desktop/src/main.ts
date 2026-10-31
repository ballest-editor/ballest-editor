import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import * as Electron from "electron"
import { program } from "./app/DesktopApp"
import { DesktopEnvironment } from "./app/DesktopEnvironment"
import { ElectronApp } from "./electron/ElectronApp"
import { ElectronDialog } from "./electron/ElectronDialog"
import { ElectronMenu } from "./electron/ElectronMenu"
import { ElectronProtocol, registerSchemePrivileges } from "./electron/ElectronProtocol"
import { ElectronShell } from "./electron/ElectronShell"
import { ElectronUpdater } from "./electron/ElectronUpdater"
import { ElectronWindow } from "./electron/ElectronWindow"
import { GameCreator } from "./game/GameCreator"
import { GameHost } from "./game/GameHost"
import { GameLink } from "./game/GameLink"
import { GamePaths } from "./game/GamePaths"
import { GameProcess } from "./game/GameProcess"
import { SteamLibrary } from "./game/SteamLibrary"
import { DesktopIpc } from "./ipc/DesktopIpc"
import { NotificationLog } from "./notifications/NotificationLog"
import { Backups } from "./project/Backups"
import { MapLinks } from "./project/MapLinks"
import { Projects } from "./project/Projects"
import { DesktopSettings } from "./settings/DesktopSettings"
import { DesktopUpdates } from "./updates/DesktopUpdates"
import { DesktopWindow } from "./window/DesktopWindow"

// The Electron main process (docs/DESKTOP.md § Main process). Electron only grants scheme privileges before
// `ready`, so this runs synchronously at load, before the runtime starts.
registerSchemePrivileges()

// scripts/dev-electron.ts keeps each checkout's dev profile in that checkout. Set before `ready`, so the session's
// storage (localStorage) moves with it.
const userDataDir = process.env["BALLEST_USER_DATA_DIR"]
if (userDataDir !== undefined) Electron.app.setPath("userData", userDataDir)

const layerElectron = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronShell.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  ElectronProtocol.layer,
  DesktopIpc.layer(Electron.ipcMain)
)

const layerGame = Layer.mergeAll(GameCreator.layer, GameLink.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(GamePaths.layer, GameProcess.layer)),
  Layer.provide(SteamLibrary.layer),
  Layer.provideMerge(GameHost.layer)
)

const layerProjects = Projects.layer.pipe(
  Layer.provide(Layer.mergeAll(MapLinks.layer, Backups.layer)),
  Layer.provideMerge(layerGame)
)

const layerDesktopRuntime = Layer.mergeAll(
  DesktopWindow.layer,
  DesktopUpdates.layer,
  NotificationLog.layer,
  layerProjects
).pipe(
  Layer.provideMerge(DesktopSettings.layer),
  Layer.provideMerge(DesktopEnvironment.layer(__dirname)),
  Layer.provideMerge(layerElectron),
  Layer.provideMerge(NodeServices.layer)
)

program.pipe(Effect.provide(layerDesktopRuntime), NodeRuntime.runMain)
