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
import { importAsCopy, replaceOnImport } from "../editor/actions"
import { useEditor } from "../editor/store"

/** Import found a map of the same file name in the project: replace it (it is backed up) or import a renamed copy. */
export function ImportClashDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const clash = useEditor((s) => s.importClash)
  const projectName = useEditor((s) => s.project?.current.name ?? "the project")
  const setImportClash = useEditor((s) => s.setImportClash)
  const cancel = () => {
    setImportClash(null)
    onClose()
  }
  return (
    <Dialog open={open && clash !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace the map in the project?</DialogTitle>
          <DialogDescription>
            {projectName} already has{" "}
            <span className="text-foreground">{mapLabelOf(clash?.fileName ?? "")}</span>. Replace it with the imported
            file (the project's copy goes to its backups), or import the file as a copy under the next free name.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>Cancel</Button>
          <Button variant="outline" onClick={() => void importAsCopy()}>Import as copy</Button>
          <Button variant="destructive" onClick={() => void replaceOnImport()}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
