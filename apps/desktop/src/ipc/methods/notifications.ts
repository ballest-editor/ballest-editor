import { Effect } from "effect"
import { NotificationLog } from "../../notifications/NotificationLog"
import { DesktopSettings } from "../../settings/DesktopSettings"
import type { DesktopIpcHandlers } from "../DesktopIpc"

export const notificationHandlers = {
  loadNotifications: Effect.fn("ipc.loadNotifications")(function*() {
    return yield* (yield* NotificationLog).load
  }),
  saveNotifications: Effect.fn("ipc.saveNotifications")(function*({ records }) {
    yield* (yield* NotificationLog).save(records)
  }),
  /** "Don't show again": the kind joins `notifications.muted` in `desktop-settings.json`. */
  muteNotifications: Effect.fn("ipc.muteNotifications")(function*({ kind }) {
    const next = yield* (yield* DesktopSettings).update((s) => {
      const muted = s.notifications?.muted ?? []
      return muted.includes(kind) ? s : { ...s, notifications: { ...s.notifications, muted: [...muted, kind] } }
    })
    return next.notifications?.muted ?? []
  }),
  gameLinkMemory: Effect.fn("ipc.gameLinkMemory")(function*() {
    const settings = yield* (yield* DesktopSettings).get
    return { last: settings.gameLink?.last ?? null, muted: settings.notifications?.muted ?? [] }
  }),
  rememberGameLink: Effect.fn("ipc.rememberGameLink")(function*(last) {
    yield* (yield* DesktopSettings).update((s) => ({ ...s, gameLink: { ...s.gameLink, last } }))
  })
} satisfies Partial<DesktopIpcHandlers>
