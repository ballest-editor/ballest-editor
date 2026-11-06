import { EnteredGroupStatus } from "./EnteredGroupStatus"
import { LinkStatus } from "./LinkStatus"
import { NotificationCenter } from "./NotificationCenter"
import { UpdateStatus } from "./UpdateCheck"
import { UpdatePill } from "./UpdatePill"

/** Along the bottom of the window (docs/PROJECTS.md § Shell), where state that used to be a toast lives. */
export function StatusBar() {
  return (
    <footer className="grid h-6 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t bg-card px-2 [&_button]:[outline-offset:-2px]!">
      <div className="flex min-w-0 items-center gap-3">
        <UpdateStatus />
        <EnteredGroupStatus />
      </div>
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
