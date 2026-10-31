import { UpdateState } from "@ballest/contracts"
import { Effect, Schema } from "effect"
import { DesktopUpdates } from "../../updates/DesktopUpdates"
import { DOWNLOAD_UPDATE_CHANNEL, GET_UPDATE_STATE_CHANNEL, INSTALL_UPDATE_CHANNEL } from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

export const getUpdateState = makeIpcMethod({
  channel: GET_UPDATE_STATE_CHANNEL,
  payload: Schema.Undefined,
  result: UpdateState,
  handler: Effect.fn("ipc.getUpdateState")(function*() {
    return yield* (yield* DesktopUpdates).state
  })
})

/** Starts the download and returns; the page follows it on `UPDATE_STATE_CHANNEL`. */
export const downloadUpdate = makeIpcMethod({
  channel: DOWNLOAD_UPDATE_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("ipc.downloadUpdate")(function*() {
    yield* (yield* DesktopUpdates).download
  })
})

export const installUpdate = makeIpcMethod({
  channel: INSTALL_UPDATE_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("ipc.installUpdate")(function*() {
    yield* (yield* DesktopUpdates).install
  })
})
