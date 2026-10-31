import { Effect } from "effect"
import { DesktopIpc } from "./DesktopIpc"
import { openMap, readMap, recentMaps, saveMap, writeMap } from "./methods/files"
import { ping } from "./methods/ping"
import { openExternal } from "./methods/shell"
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
})
