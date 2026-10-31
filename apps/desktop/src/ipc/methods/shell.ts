import { OpenExternalPayload } from "@ballest/contracts"
import { Effect, Schema } from "effect"
import { ElectronShell } from "../../electron/ElectronShell"
import { OPEN_EXTERNAL_CHANNEL } from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

/** Opens a web link in the default browser; anything but http(s) is refused (false). */
export const openExternal = makeIpcMethod({
  channel: OPEN_EXTERNAL_CHANNEL,
  payload: OpenExternalPayload,
  result: Schema.Boolean,
  handler: Effect.fn("ipc.openExternal")(function*({ url }) {
    return yield* (yield* ElectronShell).openExternal(url)
  })
})
