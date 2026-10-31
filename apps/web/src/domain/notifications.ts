/**
 * The notification centre's list (docs/PROJECTS.md § Shell): newest first, at most `limit` kept. A persistent
 * notification is pinned to the top until it is resolved; notifying the same persistent kind again replaces it.
 */

/** The fields the list works on (`NotificationRecord` in @ballest/contracts). */
export interface Notice {
  readonly id: string
  readonly kind: string
  readonly at: string
  readonly read: boolean
  readonly persistent: boolean
  readonly resolvedAt: string | null
}

/** Shown above the rest until its cause goes away. */
export const isPinned = (notice: Notice): boolean => notice.persistent && notice.resolvedAt === null

/** At most `limit`, dropping the oldest unpinned ones first. */
const capped = <N extends Notice>(log: ReadonlyArray<N>, limit: number): ReadonlyArray<N> => {
  const room = Math.max(0, limit - log.filter(isPinned).length)
  let kept = 0
  return log.filter((notice) => isPinned(notice) || kept++ < room).slice(0, limit)
}

/** `notice` on top of `log`; a pinned notice of the same kind gives way to it. */
export const addNotice = <N extends Notice>(log: ReadonlyArray<N>, notice: N, limit: number): ReadonlyArray<N> =>
  capped([notice, ...log.filter((n) => !(notice.persistent && isPinned(n) && n.kind === notice.kind))], limit)

/** Unpins the notifications of `kind`, their cause having gone away; they stay in the list as history. */
export const resolveNotices = <N extends Notice>(log: ReadonlyArray<N>, kind: string, at: string): ReadonlyArray<N> =>
  log.some((n) => n.kind === kind && isPinned(n))
    ? log.map((n) => n.kind === kind && isPinned(n) ? { ...n, resolvedAt: at } : n)
    : log

/** Marks `ids` read (every notification when absent). */
export const markRead = <N extends Notice>(log: ReadonlyArray<N>, ids?: ReadonlySet<string>): ReadonlyArray<N> =>
  log.some((n) => !n.read && (ids === undefined || ids.has(n.id)))
    ? log.map((n) => !n.read && (ids === undefined || ids.has(n.id)) ? { ...n, read: true } : n)
    : log

/** Clear: only the pinned ones stay, since they resolve themselves. */
export const clearNotices = <N extends Notice>(log: ReadonlyArray<N>): ReadonlyArray<N> => log.filter(isPinned)

/** This session's notifications (newer) with the ones kept from before, without duplicates. */
export const mergeNotices = <N extends Notice>(
  current: ReadonlyArray<N>,
  kept: ReadonlyArray<N>,
  limit: number
): ReadonlyArray<N> => {
  const ids = new Set(current.map((n) => n.id))
  // a persistent kind notified again this session replaces the pinned one kept from before
  const pinnedKinds = new Set(current.filter(isPinned).map((n) => n.kind))
  return capped(
    [...current, ...kept.filter((n) => !ids.has(n.id) && !(isPinned(n) && pinnedKinds.has(n.kind)))],
    limit
  )
}

export const unreadCount = (log: ReadonlyArray<Notice>): number => log.filter((n) => !n.read).length

/** The panel's layout: the pinned ones, then the rest grouped by `dayOf` (consecutive, so newest day first). */
export const panelSections = <N extends Notice>(
  log: ReadonlyArray<N>,
  dayOf: (notice: N) => string
): {
  readonly pinned: ReadonlyArray<N>
  readonly days: ReadonlyArray<{ readonly day: string; readonly notices: ReadonlyArray<N> }>
} => {
  const days: Array<{ day: string; notices: Array<N> }> = []
  for (const notice of log) {
    if (isPinned(notice)) continue
    const day = dayOf(notice)
    const last = days.at(-1)
    if (last?.day === day) last.notices.push(notice)
    else days.push({ day, notices: [notice] })
  }
  return { pinned: log.filter(isPinned), days }
}
