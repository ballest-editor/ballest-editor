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
import { replacePublishedDraft } from "../editor/actions"
import { useEditor } from "../editor/store"
import { PathText } from "./PathText"

/**
 * Export to game (or Play, which exports first) found a file of the same name in the maps folder that is the draft of a published map. Replacing it
 * loses the draft's link to its Workshop item, so this asks first.
 */
export function ReplacePublishedDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const draft = useEditor((s) => s.dialog?.id === "replacePublished" ? s.dialog : null)
  return (
    <Dialog open={open && draft !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Replace a published map's draft?</DialogTitle>
          <DialogDescription>
            The game's maps folder has the draft of{" "}
            {draft === null ? "" : mapLabelOf(draft.name)}, a map published to the Workshop (item{" "}
            {draft?.publishedFileId}):
            <PathText block>{draft?.name ?? ""}</PathText>
            {draft?.from === "play" ? "Play" : "Export"}{" "}
            writes this map over it, and the game stops treating it as the published one. The draft goes to the backups.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => void replacePublishedDraft()}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
