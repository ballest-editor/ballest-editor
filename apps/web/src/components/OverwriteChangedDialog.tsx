import { mapLabelOf } from "../domain/factory"
import { overwriteChangedExport, reimportFirst } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ConfirmDialog, HintedButton } from "./TitledDialog"

/**
 * Export to game (or Play, which exports first) found that the game changed the map's export since the last export:
 * the in-game editor saved it (docs/PROJECTS.md § Sync). Writing over it loses those edits unless they are taken in
 * first, so this asks: back the game's version up and overwrite it, re-import it into the project, or cancel.
 */
export function OverwriteChangedDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const changed = useEditor((s) => s.dialog?.id === "overwriteChanged" ? s.dialog : null)
  const label = changed === null ? "" : mapLabelOf(changed.name)
  return (
    <ConfirmDialog
      open={open && changed !== null}
      onClose={onClose}
      title={`${label} was changed in the game`}
      description={`${changed?.from === "play" ? "Play" : "Export"} would write over those changes.`}
      alternative={
        <HintedButton
          hint="Takes the game's version into the project and exports nothing."
          variant="outline"
          className="sm:mr-auto"
          onClick={() => void reimportFirst()}
        >
          Re-import first
        </HintedButton>
      }
      confirm={
        <HintedButton
          hint="The game's version goes to the backups."
          variant="destructive"
          onClick={() => void overwriteChangedExport()}
        >
          Back up and overwrite
        </HintedButton>
      }
    />
  )
}
