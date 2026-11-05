import { useEditor } from "../store"
import { run } from "./run"
import { saveTabPrefs } from "./shared"

/** A dragged divider changes the layout on every move; it is written once it settles. */
const SAVE_DELAY_MS = 300

/**
 * Keeps each map's view layout with its prefs while the editor runs, a moment after each change (docs/DESKTOP.md § View
 * panes). Another tab coming forward or a map being loaded brings a layout along; neither is a change to save.
 */
export const followViewLayouts = (
  save: (tabId: string) => void = (tabId) => void run(saveTabPrefs(tabId))
): () => void => {
  const waiting = new Map<string, ReturnType<typeof setTimeout>>()
  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.viewLayout === prev.viewLayout || s.tabId !== prev.tabId || s.mapShownRequest !== prev.mapShownRequest) return
    const { tabId } = s
    clearTimeout(waiting.get(tabId))
    waiting.set(
      tabId,
      setTimeout(() => {
        waiting.delete(tabId)
        save(tabId)
      }, SAVE_DELAY_MS)
    )
  })
  return () => {
    unsubscribe()
    for (const timer of waiting.values()) clearTimeout(timer)
  }
}
