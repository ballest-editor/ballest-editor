import { Effect } from "effect"
import type { DesktopIpcHandlers } from "../DesktopIpc"

export const pingHandlers = {
  /** Echoes the renderer's message: the smallest check that the bridge, IPC and schemas line up. */
  ping: ({ message }) => Effect.succeed({ message })
} satisfies Partial<DesktopIpcHandlers>
