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
  const changed = useEditor((s) => s.changedExport)
  const setChangedExport = useEditor((s) => s.setChangedExport)
  const cancel = () => {
    setChangedExport(null)
    onClose()
  }
  const label = changed === null ? "" : mapLabelOf(changed.name)
  return (
    <Dialog open={open && changed !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} was changed in the game</DialogTitle>
          <DialogDescription>
            The game's copy of {label} has changed since it was last exported, most likely saved in the in-game editor.
            {" "}
            {changed?.from === "play" ? "Play exports" : "Exporting writes"}{" "}
            this map over it. Back up and overwrite keeps the game's version in the backups; Re-import first replaces
            the map here with the game's version instead, and exports nothing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>Cancel</Button>
          <Button variant="outline" onClick={() => void reimportFirst()}>Re-import first</Button>
          <Button variant="destructive" onClick={() => void overwriteChangedExport()}>Back up and overwrite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
