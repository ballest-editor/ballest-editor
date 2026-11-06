import { Button } from "@workspace/ui/components/button"
import { canCheckForUpdates, updateStatusOf, updateSummaryOf } from "../domain/updates"
import { checkForUpdates } from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"

/** The status bar's left end: what a check for updates is doing. Nothing in a browser, which has no updater. */
export function UpdateStatus() {
  const state = useUpdateState()
  const checked = useEditor((s) => s.updateChecked)
  const status = state === null ? null : updateStatusOf(state, checked)
  return status === null ? null : <span className="truncate px-1 text-fg-tertiary">{status}</span>
}

/** Settings › General's updates row: its text and its button. Null in a browser. */
export function useUpdateCheck() {
  const state = useUpdateState()
  const checked = useEditor((s) => s.updateChecked)
  if (state === null) return null
  return {
    summary: updateSummaryOf(state, checked),
    button: (
      <Button
        variant="outline"
        size="sm"
        disabled={!canCheckForUpdates(state)}
        onClick={() => void checkForUpdates()}
      >
        Check for updates
      </Button>
    )
  }
}
