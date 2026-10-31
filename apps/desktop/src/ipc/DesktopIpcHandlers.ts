import { Effect } from "effect"
import { DesktopIpc } from "./DesktopIpc"
import { openMap, readMap, recentMaps, saveMap, writeMap } from "./methods/files"
import {
  chooseGamePath,
  gamePaths,
  isGameRunning,
  launchGame,
  resetGamePath,
  revealGamePath,
  saveToGame
} from "./methods/game"
import { ping } from "./methods/ping"
import { openExternal } from "./methods/shell"
import { downloadUpdate, getUpdateState, installUpdate } from "./methods/updates"
import { setWindowTheme } from "./methods/window"

/** Registers every IPC method for the lifetime of the current scope. Runs before the first window loads. */
export const installDesktopIpcHandlers = Effect.fn("installDesktopIpcHandlers")(function*() {
  const ipc = yield* DesktopIpc
  yield* ipc.handle(ping)
  yield* ipc.handle(openMap)
  yield* ipc.handle(saveMap)
  yield* ipc.handle(readMap)
  yield* ipc.handle(writeMap)
  yield* ipc.handle(recentMaps)
  yield* ipc.handle(openExternal)
  yield* ipc.handle(setWindowTheme)
  yield* ipc.handle(gamePaths)
  yield* ipc.handle(chooseGamePath)
  yield* ipc.handle(resetGamePath)
  yield* ipc.handle(revealGamePath)
  yield* ipc.handle(saveToGame)
  yield* ipc.handle(launchGame)
  yield* ipc.handle(isGameRunning)
  yield* ipc.handle(getUpdateState)
  yield* ipc.handle(downloadUpdate)
  yield* ipc.handle(installUpdate)
})
