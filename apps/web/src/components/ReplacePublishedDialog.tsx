import { mapLabelOf } from "../domain/factory"
import { replacePublishedDraft } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ConfirmDialog, HintedButton } from "./TitledDialog"

/**
 * Export to game (or Play, which exports first) found a file of the same name in the maps folder that is the draft of a published map. Replacing it
 * loses the draft's link to its Workshop item, so this asks first.
 */
export function ReplacePublishedDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const draft = useEditor((s) => s.dialog?.id === "replacePublished" ? s.dialog : null)
  return (
    <ConfirmDialog
      open={open && draft !== null}
      onClose={onClose}
      title="Replace a published map's draft?"
      description={`Replacing ${draft === null ? "" : mapLabelOf(draft.name)} unlinks it from the Workshop.`}
      confirm={
        <HintedButton
          hint="The draft goes to the backups."
          variant="destructive"
          onClick={() => void replacePublishedDraft()}
        >
          Replace
        </HintedButton>
      }
    />
  )
}
