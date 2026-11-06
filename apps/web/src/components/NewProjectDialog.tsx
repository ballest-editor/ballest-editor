import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { type ReactNode, useState } from "react"
import { pathInFolder } from "../domain/paths"
import { isProjectName, PROJECT_NAME_RULE } from "../domain/project"
import { newProject } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ProjectFolderLine } from "./NewProjectFields"
import { TitledDialog } from "./TitledDialog"

/**
 * The name a new project goes by, and where that puts it under `projectsFolder` (`Documents/Ballest Editor`).
 * `onCreate` hears a usable name; `actions` holds what sits beside Create.
 */
export function NewProjectForm({ actions, onCreate }: {
  readonly actions: ReactNode
  readonly onCreate: (name: string) => void
}) {
  const projectsFolder = useEditor((s) => s.project?.projectsFolder ?? "")
  const recent = useEditor((s) => s.project)
  const [name, setName] = useState("")
  const trimmed = name.trim()
  const valid = isProjectName(trimmed)
  const taken = recent !== null &&
    [recent.current, ...recent.recent].some((p) => p !== null && p.name.toLowerCase() === trimmed.toLowerCase())
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !taken) onCreate(trimmed)
      }}
    >
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
        {taken || (trimmed !== "" && !valid)
          ? (
            <span className="text-body text-destructive">
              {taken ? "A recent project has that name already." : PROJECT_NAME_RULE}
            </span>
          )
          : <ProjectFolderLine path={trimmed === "" ? projectsFolder : pathInFolder(projectsFolder, trimmed)} />}
      </div>
      <DialogFooter>
        {actions}
        <Button type="submit" disabled={!valid || taken}>Create</Button>
      </DialogFooter>
    </form>
  )
}

/**
 * File › New project… (desktop): the folder's name is all it asks, and where it opens comes next (`newProject`). A name
 * main refuses leaves the dialog up, so it can be changed. Open project… is the way to use a folder elsewhere.
 */
export function NewProjectDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title="New project"
    >
      <NewProjectForm
        actions={<Button type="button" variant="outline" onClick={onClose}>Cancel</Button>}
        onCreate={(name) => void newProject(name)}
      />
    </TitledDialog>
  )
}
