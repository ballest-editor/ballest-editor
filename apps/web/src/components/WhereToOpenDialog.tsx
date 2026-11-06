import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { useState } from "react"
import { openInNewWindow, openInThisWindow, updateSettings } from "../editor/actions"
import { useEditor } from "../editor/store"
import { TitledDialog } from "./TitledDialog"
import { useOnOpen } from "./useOnOpen"

/**
 * New project…, Open project… and a recent project open in this window; this asks first, once the project is known,
 * only while this window has unsaved changes (docs/DESKTOP.md § Other windows). This window goes on to the
 * unsaved-changes rule (§ Window); New window starts another copy of the app and leaves this one as it is. Cancel does
 * nothing, and a new project's folder doesn't exist yet. Always do this keeps the answer in Settings › General, which is
 * where it is undone.
 */
export function WhereToOpenDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const [always, setAlways] = useState(false)
  // Each time it asks, it starts unset: a Cancel keeps nothing.
  useOnOpen(open, () => setAlways(false))
  const remember = (opensIn: "thisWindow" | "newWindow") =>
    always ? updateSettings("general", { projectOpensIn: opensIn }) : Promise.resolve(undefined)
  const asked = useEditor((s) => s.dialog?.id === "whereToOpen" ? s.dialog : null)
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      showCloseButton={false}
      title={<>Open {asked?.name}</>}
      description="This window has unsaved changes. New window leaves them as they are."
    >
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
    </TitledDialog>
  )
}
