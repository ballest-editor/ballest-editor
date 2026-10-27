import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useState } from "react"
import { isValidName, mapFileNameOf, NAME_RULE } from "../domain/factory"
import { newMap, saveSettings } from "../editor/actions"
import { useEditor } from "../editor/store"

export function NewMapDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const settings = useEditor((s) => s.settings)
  const creator = settings.general.creatorName.trim()
  const [name, setName] = useState("")
  const [creatorDraft, setCreatorDraft] = useState("")
  const effectiveCreator = creator || creatorDraft.trim()
  const valid = isValidName(name) && isValidName(effectiveCreator)
  const submit = async () => {
    if (!valid) return
    if (creator === "") await saveSettings({ ...settings, general: { ...settings.general, creatorName: effectiveCreator } })
    await newMap(name, effectiveCreator)
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
              Exports as <code className="break-all">{mapFileNameOf(name || "name", effectiveCreator || "creator")}</code>. Starts with
              the one player start the game requires. Unsaved changes in the current map are discarded.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-name">Map name</Label>
            <Input id="new-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={name !== "" && !isValidName(name)} />
            <span className="text-[0.7rem] text-muted-foreground">{NAME_RULE}</span>
          </div>
          {creator === "" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-creator">Creator (your in-game name)</Label>
              <Input id="new-creator" value={creatorDraft} onChange={(e) => setCreatorDraft(e.target.value)} />
              <span className="text-[0.7rem] text-muted-foreground">Saved to Settings › General.</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
