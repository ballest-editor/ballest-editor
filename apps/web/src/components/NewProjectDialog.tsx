import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { newProject } from "../editor/actions"
import { NewProjectFields, useNewProjectDraft } from "./NewProjectFields"
import { TitledDialog } from "./TitledDialog"

/** A new project's name, offered free and selected, and where its folder goes, with Change… for another. */
function NewProjectForm({ onCancel }: { readonly onCancel: () => void }) {
  const draft = useNewProjectDraft()
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.ok) void newProject(draft.project.name, draft.project.folder)
      }}
    >
      <NewProjectFields draft={draft} id="new-project-name" label="Name" autoFocus />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!draft.ok}>Create</Button>
      </DialogFooter>
    </form>
  )
}

/**
 * New project… (desktop: File, and the welcome window's Start): a name and a folder, and where it opens comes next
 * (`newProject`). A project main refuses leaves the dialog up, so it can be changed.
 */
export function NewProjectDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <TitledDialog open={open} onClose={onClose} title="New project">
      <NewProjectForm onCancel={onClose} />
    </TitledDialog>
  )
}
