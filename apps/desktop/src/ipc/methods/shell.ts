import { Effect } from "effect"
import { ElectronShell } from "../../electron/ElectronShell"
import type { DesktopIpcHandlers } from "../DesktopIpc"

export const shellHandlers = {
  /** Opens a web link in the default browser; anything but http(s) is refused (false). */
  openExternal: Effect.fn("ipc.openExternal")(function*({ url }) {
    return yield* (yield* ElectronShell).openExternal(url)
  })
} satisfies Partial<DesktopIpcHandlers>
