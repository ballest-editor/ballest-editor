import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { mapLabelOf } from "../domain/factory"
import { overwriteChangedExport, reimportFirst } from "../editor/actions"
import { useEditor } from "../editor/store"

/**
 * Export to game (or Play, which exports first) found that the game changed the map's export since the last export:
 * the in-game editor saved it (docs/PROJECTS.md § Sync). Writing over it loses those edits unless they are taken in
 * first, so this asks: back the game's version up and overwrite it, re-import it into the project, or cancel.
 */
export function OverwriteChangedDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const changed = useEditor((s) => s.dialog?.id === "overwriteChanged" ? s.dialog : null)
  const label = changed === null ? "" : mapLabelOf(changed.name)
  return (
    <Dialog open={open && changed !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} was changed in the game</DialogTitle>
          <DialogDescription>
            The game's copy of {label} changed since the last export, probably saved in the in-game editor.{" "}
            {changed?.from === "play" ? "Play" : "Export"}{" "}
            would write over it. Back up and overwrite keeps the game's version in the backups. Re-import first takes
            the game's version into the project instead, and exports nothing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => void reimportFirst()}>Re-import first</Button>
          <Button variant="destructive" onClick={() => void overwriteChangedExport()}>Back up and overwrite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
