import {
  GameLinkMemory,
  GameLinkResult,
  MutedNotificationKinds,
  NotificationKindPayload,
  NotificationRecords
} from "@ballest/contracts"
import { Effect, Schema } from "effect"
import { NotificationLog } from "../../notifications/NotificationLog"
import { DesktopSettings } from "../../settings/DesktopSettings"
import {
  GAME_LINK_MEMORY_CHANNEL,
  LOAD_NOTIFICATIONS_CHANNEL,
  MUTE_NOTIFICATIONS_CHANNEL,
  REMEMBER_GAME_LINK_CHANNEL,
  SAVE_NOTIFICATIONS_CHANNEL
} from "../channels"
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

/** "Don't show again": the kind joins `notifications.muted` in `desktop-settings.json`. */
export const muteNotifications = makeIpcMethod({
  channel: MUTE_NOTIFICATIONS_CHANNEL,
  payload: NotificationKindPayload,
  result: MutedNotificationKinds,
  handler: Effect.fn("ipc.muteNotifications")(function*({ kind }) {
    const next = yield* (yield* DesktopSettings).update((s) => {
      const muted = s.notifications?.muted ?? []
      return muted.includes(kind) ? s : { ...s, notifications: { ...s.notifications, muted: [...muted, kind] } }
    })
    return next.notifications?.muted ?? []
  })
})

export const gameLinkMemory = makeIpcMethod({
  channel: GAME_LINK_MEMORY_CHANNEL,
  payload: Schema.Undefined,
  result: GameLinkMemory,
  handler: Effect.fn("ipc.gameLinkMemory")(function*() {
    const settings = yield* (yield* DesktopSettings).get
    return { last: settings.gameLink?.last ?? null, muted: settings.notifications?.muted ?? [] }
  })
})

export const rememberGameLink = makeIpcMethod({
  channel: REMEMBER_GAME_LINK_CHANNEL,
  payload: GameLinkResult,
  result: Schema.Void,
  handler: Effect.fn("ipc.rememberGameLink")(function*(last) {
    yield* (yield* DesktopSettings).update((s) => ({ ...s, gameLink: { ...s.gameLink, last } }))
  })
})
