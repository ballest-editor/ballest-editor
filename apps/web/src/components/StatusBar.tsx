import { LinkStatus } from "./LinkStatus"
import { NotificationCenter } from "./NotificationCenter"
import { UpdatePill } from "./UpdatePill"

/**
 * Along the bottom of the window (docs/PROJECTS.md § Shell), where state that used to be a toast lives: the open map's
 * link state in the middle, the update pill and the notification bell on the right. The project is the window's title.
 */
export function StatusBar() {
  return (
    <footer className="grid h-7 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t bg-card px-2 text-xs">
      <div />
      <div className="flex min-w-0 items-center justify-center">
        <LinkStatus />
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        <UpdatePill />
        <NotificationCenter />
      </div>
    </footer>
  )
}
