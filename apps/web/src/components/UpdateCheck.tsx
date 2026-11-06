import { Button } from "@workspace/ui/components/button"
import { canCheckForUpdates, updateStatusOf, updateSummaryOf } from "../domain/updates"
import { checkForUpdates } from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"

/** The status bar's left end: the running version, and what a check is doing. Empty in a browser, which has no updater. */
export function VersionStatus() {
  const state = useUpdateState()
  const checked = useEditor((s) => s.updateChecked)
  if (state === null) return <div />
  const status = updateStatusOf(state, checked)
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 text-fg-tertiary">
      <span className="tabular-nums">v{state.currentVersion}</span>
      {status !== null && <span className="truncate">{status}</span>}
    </div>
  )
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
