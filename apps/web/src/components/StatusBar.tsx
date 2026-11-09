import { useStatusHint } from "../editor/statusHint"
import { EnteredGroupStatus } from "./EnteredGroupStatus"
import { LastExportStatus, LinkStatus } from "./LinkStatus"
import { NotificationCenter } from "./NotificationCenter"
import { PaintToolStatus } from "./PaintPalette"
import { SelectionStatus } from "./SelectionStatus"
import { StatusHintLine } from "./StatusHintLine"
import { UpdatePill, UpdateStatus } from "./UpdatePill"

/**
 * Along the bottom of the window (docs/PROJECTS.md § Shell): the selection and the paint tool's hint, the map's sync
 * status, updates, the bell. While a control shows a hint (editor/statusHint) the hint takes the selection's place, as
 * in Blender.
 */
export function StatusBar() {
  const hinting = useStatusHint((s) => s.hint !== null)
  return (
    <footer className="grid h-6 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t bg-card px-2 [&_button]:[outline-offset:-2px]!">
      <div className="flex min-w-0 items-center gap-3">
        {hinting ? <StatusHintLine /> : (
          <>
            <SelectionStatus />
            <PaintToolStatus />
            <UpdateStatus />
            <EnteredGroupStatus />
          </>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-center">
        <LinkStatus />
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <LastExportStatus />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <UpdatePill />
          <NotificationCenter />
        </div>
      </div>
    </footer>
  )
}
