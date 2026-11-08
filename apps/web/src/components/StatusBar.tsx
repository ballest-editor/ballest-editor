import { DragKeyHints, useDragKeysShown } from "./DragKeyHints"
import { EnteredGroupStatus } from "./EnteredGroupStatus"
import { LastExportStatus, LinkStatus } from "./LinkStatus"
import { NotificationCenter } from "./NotificationCenter"
import { SelectionStatus } from "./SelectionStatus"
import { SnapStatus } from "./SnapStatus"
import { UpdatePill, UpdateStatus } from "./UpdatePill"

/**
 * The middle of the bar: the map's sync status, or during a drag the keys it can take. Nothing is saved or exported until
 * the drag lets go, so the status has nothing to say meanwhile. A click shows no keys, so the status stays put.
 */
function CentreStatus() {
  return useDragKeysShown() ? <DragKeyHints /> : <LinkStatus />
}

/** Along the bottom of the window (docs/PROJECTS.md § Shell): the selection, the map's sync status, updates, the bell. */
export function StatusBar() {
  return (
    <footer className="grid h-6 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t bg-card px-2 [&_button]:[outline-offset:-2px]!">
      <div className="flex min-w-0 items-center gap-3">
        <SelectionStatus />
        <UpdateStatus />
        <EnteredGroupStatus />
      </div>
      <div className="flex min-w-0 items-center justify-center">
        <CentreStatus />
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <LastExportStatus />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <SnapStatus />
          <UpdatePill />
          <NotificationCenter />
        </div>
      </div>
    </footer>
  )
}
