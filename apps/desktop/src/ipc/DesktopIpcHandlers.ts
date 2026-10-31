import { Effect } from "effect"
import { DesktopIpc } from "./DesktopIpc"
import { ping } from "./methods/ping"

/** Registers every IPC method for the lifetime of the current scope. Runs before the first window loads. */
export const installDesktopIpcHandlers = Effect.fn("installDesktopIpcHandlers")(function*() {
  const ipc = yield* DesktopIpc
  yield* ipc.handle(ping)
})
