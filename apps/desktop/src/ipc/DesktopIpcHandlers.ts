import { Effect } from "effect"
import { DesktopIpc } from "./DesktopIpc"
import {
  chooseGamePath,
  findCreator,
  gamePaths,
  installPlugin,
  isGameRunning,
  launchGame,
  play,
  pluginStatus,
  resetGamePath,
  revealGamePath
} from "./methods/game"
import {
  gameLinkMemory,
  loadNotifications,
  muteNotifications,
  rememberGameLink,
  saveNotifications
} from "./methods/notifications"
import { ping } from "./methods/ping"
import {
  checkExports,
  chooseProject,
  createMap,
  exportMap,
  importMap,
  listBackups,
  listMaps,
  pickImport,
  projectState,
  readBackup,
  readMap,
  reimportMap,
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
  yield* ipc.handle(checkExports)
  yield* ipc.handle(reimportMap)
  yield* ipc.handle(listBackups)
  yield* ipc.handle(readBackup)
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
  yield* ipc.handle(play)
  yield* ipc.handle(loadNotifications)
  yield* ipc.handle(saveNotifications)
  yield* ipc.handle(muteNotifications)
  yield* ipc.handle(gameLinkMemory)
  yield* ipc.handle(rememberGameLink)
  yield* ipc.handle(getUpdateState)
  yield* ipc.handle(downloadUpdate)
  yield* ipc.handle(installUpdate)
})
