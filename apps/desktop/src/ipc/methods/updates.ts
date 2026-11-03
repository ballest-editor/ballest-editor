import { Effect } from "effect"
import { DesktopUpdates } from "../../updates/DesktopUpdates"
import type { DesktopIpcHandlers } from "../DesktopIpc"

export const updateHandlers = {
  getUpdateState: Effect.fn("ipc.getUpdateState")(function*() {
    return yield* (yield* DesktopUpdates).state
  }),
  /** Starts the download and returns; the page follows it on `PushChannels.onUpdateState`. */
  downloadUpdate: Effect.fn("ipc.downloadUpdate")(function*() {
    yield* (yield* DesktopUpdates).download
  }),
  installUpdate: Effect.fn("ipc.installUpdate")(function*() {
    yield* (yield* DesktopUpdates).install
  })
} satisfies Partial<DesktopIpcHandlers>
