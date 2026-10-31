import { NotificationRecords } from "@ballest/contracts"
import { Effect, Schema } from "effect"
import { NotificationLog } from "../../notifications/NotificationLog"
import { LOAD_NOTIFICATIONS_CHANNEL, SAVE_NOTIFICATIONS_CHANNEL } from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

export const loadNotifications = makeIpcMethod({
  channel: LOAD_NOTIFICATIONS_CHANNEL,
  payload: Schema.Undefined,
  result: NotificationRecords,
  handler: Effect.fn("ipc.loadNotifications")(function*() {
    return yield* (yield* NotificationLog).load
  })
})

export const saveNotifications = makeIpcMethod({
  channel: SAVE_NOTIFICATIONS_CHANNEL,
  payload: Schema.Struct({ records: NotificationRecords }),
  result: Schema.Void,
  handler: Effect.fn("ipc.saveNotifications")(function*({ records }) {
    yield* (yield* NotificationLog).save(records)
  })
})
