import { updateStatusOf } from "../domain/updates"
import { useEditor, useUpdateState } from "../editor/store"

/** The status bar's left end: what a check for updates is doing. Nothing in a browser, which has no updater. */
export function UpdateStatus() {
  const state = useUpdateState()
  const checked = useEditor((s) => s.updateChecked)
  const status = state === null ? null : updateStatusOf(state, checked)
  return status === null ? null : <span className="truncate px-1 text-fg-tertiary">{status}</span>
}
