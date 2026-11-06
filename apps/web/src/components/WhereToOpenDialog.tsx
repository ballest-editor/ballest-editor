import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { useState } from "react"
import { openInNewWindow, openInThisWindow, updateSettings } from "../editor/actions"
import { useEditor } from "../editor/store"

/**
 * New project…, Open project… and a recent project ask this once the project is known, in any window but the required
 * chooser's (docs/DESKTOP.md § Other windows). This window goes on to the unsaved-changes rule (§ Window); New window
 * starts another copy of the app and leaves this one as it is. Cancel does nothing, and a new project's folder doesn't
 * exist yet. Always do this keeps the answer in Settings › General, which is where it is undone.
 */
export function WhereToOpenDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const [always, setAlways] = useState(false)
  // Each time it asks, it starts unset: a Cancel keeps nothing.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAlways(false)
  }
  const remember = (opensIn: "thisWindow" | "newWindow") =>
    always ? updateSettings("general", { projectOpensIn: opensIn }) : Promise.resolve(undefined)
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
        <div className="flex items-center gap-2">
          <Switch id="where-always" checked={always} onCheckedChange={setAlways} />
          <Label htmlFor="where-always">Always do this</Label>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="sm:mr-auto"
            onClick={() => void remember("newWindow").then(openInNewWindow)}
          >
            New window
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button autoFocus onClick={() => void remember("thisWindow").then(openInThisWindow)}>This window</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
