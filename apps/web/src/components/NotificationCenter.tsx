import { IconBell, IconPin } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { MUTABLE_KINDS } from "../domain/gameLink"
import { panelSections, unreadCount } from "../domain/notifications"
import { dayLabel } from "../domain/time"
import { muteNotificationKind, runNotificationAction } from "../editor/actions"
import { type NotificationRecord, useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"
import { NoticeRow } from "./NoticeRow"

function NotificationItem({ notice }: { readonly notice: NotificationRecord }) {
  return (
    <li className={cn("rounded-control px-3 py-2", !notice.read && "bg-muted/60")}>
      <NoticeRow
        notice={notice}
        actions={notice.actions}
        onAction={(action) => runNotificationAction(notice, action)}
      >
        {MUTABLE_KINDS.has(notice.kind)
          ? (
            <Button variant="ghost" size="sm" onClick={() => void muteNotificationKind(notice.kind)}>
              Don't show again
            </Button>
          )
          : undefined}
      </NoticeRow>
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
 * The bell at the right of the status bar and its panel (docs/DESKTOP.md § Notifications): every notification, newest
 * first and grouped by day, the pinned ones (persistent, until resolved) on top. Their buttons still work, after a
 * restart too. The bell counts the unread ones.
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
            size="icon-sm"
            className="relative"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <IconBell />
        {unread > 0 && (
          <span className="absolute top-0 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-control bg-primary px-0.5 text-caption text-primary-foreground tabular-nums">
            {unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-96 gap-1 p-2">
        <div className="flex items-center gap-1 px-2 pt-1 pb-1">
          <PopoverTitle className="flex-1">Notifications</PopoverTitle>
          {notifications.length > 0 && (
            <>
              <Button variant="ghost" size="sm" disabled={unread === 0} onClick={() => markRead()}>
                Mark all read
              </Button>
              <Button variant="ghost" size="sm" disabled={notifications.length === pinned.length} onClick={clear}>
                Clear
              </Button>
            </>
          )}
        </div>
        {/* the cap goes on the viewport: it is what scrolls */}
        <ScrollArea className="[&_[data-slot=scroll-area-viewport]]:max-h-[min(60vh,32rem)]">
          <div className="flex flex-col gap-3 py-1 pr-3 pl-1">
            {notifications.length === 0 && <p className="px-2 py-6 text-center text-fg-tertiary">Nothing yet.</p>}
            {pinned.length > 0 && <Section title="Pinned" pinned notices={pinned} />}
            {days.map(({ day, notices }) => <Section key={day} title={day} notices={notices} />)}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
