import { useUpdateState } from "../editor/store"
import { TitledDialog } from "./TitledDialog"

/** Help › About. The version comes from the updater, so a browser, which has none, shows only the line about the app. */
export function AboutDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const update = useUpdateState()
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title="Ballest Editor"
      description="A map editor for Ballest of Them All."
    >
      {update !== null && <p className="text-fg-secondary tabular-nums">Version {update.currentVersion}</p>}
    </TitledDialog>
  )
}
