import { IconAlertCircle, IconBell, IconInfoCircle, IconPin } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"
import { panelSections, unreadCount } from "../domain/notifications"
import { dayLabel, formatClock, formatDateTime } from "../domain/time"
import { runNotificationAction } from "../editor/actions"
import { type NotificationRecord, useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"

function NotificationItem({ notice }: { readonly notice: NotificationRecord }) {
  const Icon = notice.level === "error" ? IconAlertCircle : IconInfoCircle
  return (
    <li className={cn("flex gap-2 rounded-md px-2 py-1.5", !notice.read && "bg-muted/60")}>
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          notice.level === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <p className={cn("min-w-0 flex-1 break-words", !notice.read && "font-medium")}>{notice.title}</p>
          <time
            className="shrink-0 text-muted-foreground tabular-nums"
            dateTime={notice.at}
            title={formatDateTime(notice.at)}
          >
            {formatClock(notice.at)}
          </time>
        </div>
        {notice.body !== null && <p className="break-words text-muted-foreground">{notice.body}</p>}
        {notice.actions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {notice.actions.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                size="xs"
                onClick={() => runNotificationAction(notice, action)}
              >
                {action.label}
              </Button>
            ))}
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
    <section className="flex flex-col gap-0.5">
      <h3 className="flex items-center gap-1 px-2 pt-1 text-[0.6875rem] font-medium text-muted-foreground uppercase">
        {pinned && <IconPin className="size-3" />}
        {title}
      </h3>
      <ul className="flex flex-col gap-0.5">
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
            className="relative h-5 gap-1 px-1.5 text-xs font-normal"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <IconBell className="size-3.5" />
        {unread > 0 && <span className="tabular-nums">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-96 gap-2 p-1.5">
        <div className="flex items-center gap-1 px-1 pt-1">
          <PopoverTitle className="flex-1">Notifications</PopoverTitle>
          <Button variant="ghost" size="xs" disabled={unread === 0} onClick={() => markRead()}>Mark all read</Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={notifications.length === pinned.length}
            onClick={clear}
          >
            Clear
          </Button>
        </div>
        <div className="flex max-h-[min(60vh,32rem)] flex-col gap-2 overflow-y-auto">
          {notifications.length === 0 && (
            <p className="px-2 py-6 text-center text-muted-foreground">
              No notifications
            </p>
          )}
          {pinned.length > 0 && <Section title="Pinned" pinned notices={pinned} />}
          {days.map(({ day, notices }) => <Section key={day} title={day} notices={notices} />)}
        </div>
      </PopoverContent>
    </Popover>
  )
}
