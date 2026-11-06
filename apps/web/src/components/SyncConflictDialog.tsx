import { mapLabelOf } from "../domain/factory"
import { mapDiffLabelOf } from "../domain/mapDiff"
import { keepProjectVersion, takeGameVersion } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ConfirmDialog, HintedButton } from "./TitledDialog"

/**
 * A map whose project and game versions have both moved on (docs/DESKTOP.md § Sync): this says how they differ and asks
 * which to keep. Whichever loses goes to the backups, unsaved edits included, and Cancel leaves both as they are.
 */
export function SyncConflictDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const conflict = useEditor((s) => s.dialog?.id === "syncConflict" ? s.dialog : null)
  const label = conflict === null ? "" : mapLabelOf(conflict.name)
  const unsaved = useEditor((s) => s.dirty)
  return (
    <ConfirmDialog
      open={open && conflict !== null}
      onClose={onClose}
      title={`${label} was changed in the game`}
      description={
        <>
          The project's version has changes the game's doesn't, so one replaces the other.{" "}
          {conflict?.diff != null && <>The game's version: {mapDiffLabelOf(conflict.diff)}.</>}
        </>
      }
      alternative={
        <HintedButton
          hint={`Takes the game's version into the project. The project's${
            unsaved ? ", with its unsaved edits," : ""
          } goes to the backups.`}
          variant="outline"
          className="sm:mr-auto"
          onClick={() => void takeGameVersion()}
        >
          Use game version
        </HintedButton>
      }
      confirm={
        <HintedButton
          hint="Exports the project's version over the game's, which goes to the backups."
          onClick={() => void keepProjectVersion()}
        >
          Keep project version
        </HintedButton>
      }
    />
  )
}
