/** Times as the status bar, the Start tab and the notification centre show them, in the user's local time zone. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const startOfDay = (time: number): number => {
  const day = new Date(time)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** Whole local days from `time` to `now`: 0 the same day, 1 the day before. */
const daysBefore = (time: number, now: number): number => Math.round((startOfDay(now) - startOfDay(time)) / (24 * HOUR))

/** `just now`, `4 min ago`, `2 h ago`, `yesterday`, `3 d ago`, then the date. */
export const formatAgo = (iso: string, now: number): string => {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return "at an unknown time"
  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE) return "just now"
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  const days = daysBefore(time, now)
  if (days === 0) return `${Math.floor(elapsed / HOUR)} h ago`
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} d ago`
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/** The heading a day's notifications go under: `Today`, `Yesterday`, else the date. */
export const dayLabel = (iso: string, now: number): string => {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return "Earlier"
  const days = daysBefore(time, now)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  return new Date(time).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}

/** The time of day, `14:05` (or the locale's way of writing it). */
export const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

/** The date and time in full, for a tooltip. */
export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
