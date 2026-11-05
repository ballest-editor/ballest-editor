import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { openInNewWindow, openInThisWindow } from "../editor/actions"
import { useEditor } from "../editor/store"

/**
 * New project…, Open project… and a recent project ask this once the project is known, when this window has something
 * to take over. This window goes on to the unsaved-changes prompt, as switching always has; New window starts another
 * copy of the app and leaves this one as it is. Cancel does nothing, and a new project's folder doesn't exist yet.
 */
export function WhereToOpenDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const asked = useEditor((s) => s.dialog?.id === "whereToOpen" ? s.dialog : null)
  const current = useEditor((s) => s.project?.current?.name ?? "Untitled Project")
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Open {asked?.name}</DialogTitle>
          <DialogDescription>
            This window is on <span className="text-foreground">{current}</span>. Open{" "}
            <span className="text-foreground">{asked?.name}</span> here in its place, or in a new window?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="sm:mr-auto" onClick={() => void openInNewWindow()}>New window</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button autoFocus onClick={() => void openInThisWindow()}>This window</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
