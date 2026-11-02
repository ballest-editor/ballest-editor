import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useState } from "react"
import { createProject } from "../editor/actions"
import { useEditor } from "../editor/store"

/** A folder name every OS accepts (main checks the same): letters, digits, spaces, `-` and `_`. */
const isProjectName = (name: string): boolean => /^[\p{L}\p{N}_-][\p{L}\p{N} _-]{0,63}$/u.test(name)

/**
 * File › New project… (desktop): the folder's name is all it asks. The project is made under `projectsFolder`
 * (`Documents/Ballest Editor`) and becomes the one in use; Open project… is the way to use a folder elsewhere.
 */
export function NewProjectDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const projectsFolder = useEditor((s) => s.project?.projectsFolder ?? "")
  const recent = useEditor((s) => s.project)
  const [name, setName] = useState("")
  const trimmed = name.trim()
  const valid = isProjectName(trimmed)
  const taken = recent !== null &&
    [recent.current, ...recent.recent].some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  const submit = async () => {
    await createProject(trimmed)
    setName("")
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !taken) void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>A folder of maps, exported to the game one by one.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-project-name">Name</Label>
            <Input
              id="new-project-name"
              autoFocus
              value={name}
              placeholder="Season 3 tracks"
              aria-invalid={trimmed !== "" && (!valid || taken)}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {trimmed === ""
                ? `Made in ${projectsFolder}`
                : taken
                ? "A project with that name is in the recent list already."
                : valid
                ? <span className="font-mono text-[0.6875rem]">{`${projectsFolder}/${trimmed}`}</span>
                : "Letters, digits, spaces, - and _ only."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid || taken}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
