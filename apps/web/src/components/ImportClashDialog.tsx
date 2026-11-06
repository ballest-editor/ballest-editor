import { mapLabelOf } from "../domain/factory"
import { importAsCopy, replaceOnImport } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ConfirmDialog, HintedButton } from "./TitledDialog"

/** Import found a map of the same file name in the project: replace it (it is backed up) or import a renamed copy. */
export function ImportClashDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const clash = useEditor((s) => s.dialog?.id === "importClash" ? s.dialog : null)
  const projectName = useEditor((s) => s.project?.current?.name ?? "Untitled Project")
  return (
    <ConfirmDialog
      open={open && clash !== null}
      onClose={onClose}
      title="Replace the map in the project?"
      description={
        <>
          {projectName} already has <span className="text-foreground">{mapLabelOf(clash?.fileName ?? "")}</span>.
        </>
      }
      alternative={
        <HintedButton
          hint="Imports it under the next free name."
          variant="outline"
          className="sm:mr-auto"
          onClick={() => void importAsCopy()}
        >
          Import as copy
        </HintedButton>
      }
      confirm={
        <HintedButton
          hint="The current copy goes to the backups."
          variant="destructive"
          onClick={() => void replaceOnImport()}
        >
          Replace
        </HintedButton>
      }
    />
  )
}
