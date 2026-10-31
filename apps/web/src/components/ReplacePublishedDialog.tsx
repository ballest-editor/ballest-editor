import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { replacePublishedDraft } from "../editor/actions"
import { useEditor } from "../editor/store"

/**
 * Export to game found a file of the same name in the maps folder that is the draft of a published map. Replacing it
 * loses the draft's link to its Workshop item, so this asks first.
 */
export function ReplacePublishedDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const draft = useEditor((s) => s.publishedDraft)
  const setPublishedDraft = useEditor((s) => s.setPublishedDraft)
  const cancel = () => {
    setPublishedDraft(null)
    onClose()
  }
  return (
    <Dialog open={open && draft !== null} onOpenChange={(next) => !next && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace a published map's draft?</DialogTitle>
          <DialogDescription>
            The game's maps folder already has{" "}
            <code className="break-all">{draft?.name}</code>, the draft of a map published to the Workshop (item{" "}
            {draft?.publishedFileId}). Exporting writes this map over that draft, and the game no longer treats it as
            the published one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>Cancel</Button>
          <Button variant="destructive" onClick={() => void replacePublishedDraft()}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
