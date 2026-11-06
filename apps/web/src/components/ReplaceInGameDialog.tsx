import { mapLabelOf } from "../domain/factory"
import { replaceInGame } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ConfirmDialog, HintedButton } from "./TitledDialog"

/**
 * Open in game found the in-game editor holding a map whose pieces moved, were added or deleted since it opened,
 * which a reload would throw away (docs/DESKTOP.md § Play). The game can't say whether that work is saved, so this
 * asks: replace it after all, or cancel and save it in the game first.
 */
export function ReplaceInGameDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const unsaved = useEditor((s) => s.dialog?.id === "replaceInGame" ? s.dialog : null)
  const label = unsaved === null ? "" : mapLabelOf(unsaved.name)
  const other = unsaved?.inGame !== null && unsaved?.inGame !== undefined && unsaved.inGame !== label
    ? unsaved.inGame
    : null
  return (
    <ConfirmDialog
      open={open && unsaved !== null}
      onClose={onClose}
      title={other === null
        ? "The in-game editor has changes that aren't saved"
        : `The in-game editor has ${other} open, with changes that aren't saved`}
      description={`Pieces there moved, were added or deleted since the map opened. Updating replaces them with the version of ${label} just exported. To keep them, save in the game first, then update again.`}
      confirm={
        <HintedButton
          hint="What the in-game editor holds is lost; the exported file is what it shows next."
          variant="destructive"
          onClick={() => void replaceInGame()}
        >
          Replace in game
        </HintedButton>
      }
    />
  )
}
