import { PingPayload, PingResult } from "@ballest/contracts"
import { Effect } from "effect"
import { PING_CHANNEL } from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

/** Echoes the renderer's message: the smallest check that the bridge, IPC and schemas line up. */
export const ping = makeIpcMethod({
  channel: PING_CHANNEL,
  payload: PingPayload,
  result: PingResult,
  handler: ({ message }) => Effect.succeed({ message })
})
