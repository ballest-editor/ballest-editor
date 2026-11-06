import { IconAlertCircle, IconBell, IconInfoCircle, IconPin } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { MUTABLE_KINDS } from "../domain/gameLink"
import { panelSections, unreadCount } from "../domain/notifications"
import { dayLabel, formatClock, formatDateTime } from "../domain/time"
import { muteNotificationKind, runNotificationAction } from "../editor/actions"
import { type NotificationRecord, useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"

function NotificationItem({ notice }: { readonly notice: NotificationRecord }) {
  const Icon = notice.level === "error" ? IconAlertCircle : IconInfoCircle
  const mutable = MUTABLE_KINDS.has(notice.kind)
  return (
    <li className={cn("flex gap-2.5 rounded-control px-3 py-2", !notice.read && "bg-muted/60")}>
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          notice.level === "error" ? "text-destructive" : "text-fg-secondary"
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <p className={cn("min-w-0 flex-1 break-words", !notice.read && "text-body-strong")}>{notice.title}</p>
          <time
            className="shrink-0 text-fg-tertiary tabular-nums"
            dateTime={notice.at}
            title={formatDateTime(notice.at)}
          >
            {formatClock(notice.at)}
          </time>
        </div>
        {notice.body !== null && <p className="break-words text-fg-tertiary">{notice.body}</p>}
        {(notice.actions.length > 0 || mutable) && (
          <div className="flex flex-wrap gap-1">
            {notice.actions.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                onClick={() => runNotificationAction(notice, action)}
              >
                {action.label}
              </Button>
            ))}
            {mutable && (
              <Button variant="ghost" size="sm" onClick={() => void muteNotificationKind(notice.kind)}>
                Don't show again
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function Section(
  { title, pinned = false, notices }: {
    readonly title: string
    readonly pinned?: boolean
    readonly notices: ReadonlyArray<NotificationRecord>
  }
) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1 px-3 pt-1 text-caption uppercase tracking-wider text-fg-secondary">
        {pinned && <IconPin className="size-3" />}
        {title}
      </h3>
      <ul className="flex flex-col gap-1">
        {notices.map((notice) => <NotificationItem key={notice.id} notice={notice} />)}
      </ul>
    </section>
  )
}

/**
 * The bell at the right of the status bar and its panel (docs/PROJECTS.md § Shell): every notification, newest first
 * and grouped by day, the pinned ones (persistent, until resolved) on top. Their buttons still work, after a restart
 * too. The bell counts the unread ones.
 */
export function NotificationCenter() {
  const notifications = useEditor((s) => s.notifications)
  const markRead = useEditor((s) => s.markNotificationsRead)
  const clear = useEditor((s) => s.clearNotifications)
  const now = useNow(60_000)
  const unread = unreadCount(notifications)
  const { pinned, days } = panelSections(notifications, (notice) => dayLabel(notice.at, now))

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="relative h-5 gap-1 px-1.5 text-body font-normal"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <IconBell className="size-3.5" />
        {unread > 0 && <span className="tabular-nums">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[26rem] gap-1 p-2">
        <div className="flex items-center gap-1 px-2 pt-1 pb-1">
          <PopoverTitle className="flex-1">Notifications</PopoverTitle>
          <Button variant="ghost" size="sm" disabled={unread === 0} onClick={() => markRead()}>Mark all read</Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={notifications.length === pinned.length}
            onClick={clear}
          >
            Clear
          </Button>
        </div>
        {/* the cap goes on the viewport: it is what scrolls */}
        <ScrollArea className="[&_[data-slot=scroll-area-viewport]]:max-h-[min(60vh,32rem)]">
          <div className="flex flex-col gap-3 py-1 pr-3 pl-1">
            {notifications.length === 0 && (
              <div className="flex flex-col items-center gap-1 px-2 py-6 text-center">
                <p className="text-body-strong">No notifications</p>
                <p className="text-fg-tertiary">Exports, updates and problems with the game link land here.</p>
              </div>
            )}
            {pinned.length > 0 && <Section title="Pinned" pinned notices={pinned} />}
            {days.map(({ day, notices }) => <Section key={day} title={day} notices={notices} />)}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
