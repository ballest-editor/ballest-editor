import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useState } from "react"
import { newMap } from "../editor/actions"

const CREATOR_KEY = "ballest-editor.creator"

export function NewMapDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const [name, setName] = useState("")
  const [creator, setCreator] = useState(() => localStorage.getItem(CREATOR_KEY) ?? "")
  const valid = name.trim().length > 0 && creator.trim().length > 0
  const submit = async () => {
    if (!valid) return
    localStorage.setItem(CREATOR_KEY, creator.trim())
    await newMap(name.trim(), creator.trim())
    setName("")
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>New map</DialogTitle>
            <DialogDescription>
              Saved as <code>Map_LevelEditorMain&amp;{name || "name"}_{creator || "creator"}.balledit</code>. Starts with
              the one player start the game requires. Unsaved changes in the current map are discarded.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-name">Map name</Label>
            <Input id="new-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-creator">Creator</Label>
            <Input id="new-creator" value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="your in-game name" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
