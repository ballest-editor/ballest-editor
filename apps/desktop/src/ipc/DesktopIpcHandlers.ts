import { Effect } from "effect"
import { DesktopIpc } from "./DesktopIpc"
import {
  chooseGamePath,
  findCreator,
  gamePaths,
  installPlugin,
  isGameRunning,
  launchGame,
  pluginStatus,
  resetGamePath,
  revealGamePath
} from "./methods/game"
import { ping } from "./methods/ping"
import {
  chooseProject,
  createMap,
  exportMap,
  importMap,
  listMaps,
  pickImport,
  projectState,
  readMap,
  renameMap,
  revealProject,
  saveMap,
  switchProject
} from "./methods/project"
import { openExternal } from "./methods/shell"
import { downloadUpdate, getUpdateState, installUpdate } from "./methods/updates"
import { confirmUnsaved, setWindowTheme } from "./methods/window"

/** Registers every IPC method for the lifetime of the current scope. Runs before the first window loads. */
export const installDesktopIpcHandlers = Effect.fn("installDesktopIpcHandlers")(function*() {
  const ipc = yield* DesktopIpc
  yield* ipc.handle(ping)
  yield* ipc.handle(projectState)
  yield* ipc.handle(chooseProject)
  yield* ipc.handle(switchProject)
  yield* ipc.handle(revealProject)
  yield* ipc.handle(listMaps)
  yield* ipc.handle(readMap)
  yield* ipc.handle(createMap)
  yield* ipc.handle(saveMap)
  yield* ipc.handle(renameMap)
  yield* ipc.handle(pickImport)
  yield* ipc.handle(importMap)
  yield* ipc.handle(exportMap)
  yield* ipc.handle(openExternal)
  yield* ipc.handle(setWindowTheme)
  yield* ipc.handle(confirmUnsaved)
  yield* ipc.handle(gamePaths)
  yield* ipc.handle(chooseGamePath)
  yield* ipc.handle(resetGamePath)
  yield* ipc.handle(revealGamePath)
  yield* ipc.handle(launchGame)
  yield* ipc.handle(isGameRunning)
  yield* ipc.handle(findCreator)
  yield* ipc.handle(pluginStatus)
  yield* ipc.handle(installPlugin)
  yield* ipc.handle(getUpdateState)
  yield* ipc.handle(downloadUpdate)
  yield* ipc.handle(installUpdate)
})
