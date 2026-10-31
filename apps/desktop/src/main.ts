import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import * as Electron from "electron"
import { program } from "./app/DesktopApp"
import { DesktopEnvironment } from "./app/DesktopEnvironment"
import { ElectronApp } from "./electron/ElectronApp"
import { ElectronDialog } from "./electron/ElectronDialog"
import { ElectronProtocol, registerSchemePrivileges } from "./electron/ElectronProtocol"
import { ElectronShell } from "./electron/ElectronShell"
import { ElectronWindow } from "./electron/ElectronWindow"
import { DesktopIpc } from "./ipc/DesktopIpc"
import { DesktopSettings } from "./settings/DesktopSettings"
import { DesktopWindow } from "./window/DesktopWindow"

// The Electron main process (docs/DESKTOP.md § Main process). Electron only grants scheme privileges before
// `ready`, so this runs synchronously at load, before the runtime starts.
registerSchemePrivileges()

const layerElectron = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronShell.layer,
  ElectronWindow.layer,
  ElectronProtocol.layer,
  DesktopIpc.layer(Electron.ipcMain)
)

const layerDesktopRuntime = DesktopWindow.layer.pipe(
  Layer.provideMerge(DesktopSettings.layer),
  Layer.provideMerge(DesktopEnvironment.layer(__dirname)),
  Layer.provideMerge(layerElectron),
  Layer.provideMerge(NodeServices.layer)
)

program.pipe(Effect.provide(layerDesktopRuntime), NodeRuntime.runMain)
