import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState } from "react"
import { dragHintsOf } from "../editor/snap/dragKeys"
import { useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"

/** How long a press waits before its keys show, so a click on a selected piece doesn't flash them in and out. */
export const DRAG_KEYS_DELAY_MS = 150

/**
 * Whether the status bar shows the drag's keys: once the press has lasted `DRAG_KEYS_DELAY_MS`, or at once when one of
 * them goes down, and never for a click.
 */
export function useDragKeysShown(): boolean {
  const dragging = useEditor((s) => s.dragKeys !== null)
  const keyed = useEditor((s) =>
    s.dragKeys !== null && (s.dragKeys.pressed.length > 0 || s.dragKeys.lock !== undefined)
  )
  const [lasted, setLasted] = useState(false)
  // the release starts the next press over, without an effect's extra render
  if (!dragging && lasted) setLasted(false)
  useEffect(() => {
    if (!dragging) return
    const timer = setTimeout(() => setLasted(true), DRAG_KEYS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [dragging])
  return dragging && (lasted || keyed)
}

/**
 * The keys a drag can take, in the middle of the status bar from the press to the release, as Blender lists a modal
 * tool's keys (docs/SNAPPING.md § Modifiers). What is held, or the lock that is set, is filled with the accent, which
 * reads in both themes.
 */
export function DragKeyHints() {
  const shown = useEditor((s) => s.dragKeys)
  const keybinds = useEditor((s) => s.keybinds)
  if (shown === null) return null
  return (
    <div className="flex min-w-0 items-center gap-3 overflow-hidden" data-drag-keys={shown.transform}>
      {dragHintsOf(keybinds, shown).map(({ active, id, keys, word }) => (
        <span key={id} className="flex shrink-0 items-center gap-1" data-drag-key={id} data-active={active}>
          {keys.map(({ active: down, binding }) => (
            <KeyChip key={binding} binding={binding} className={cn(down && "bg-primary text-primary-foreground")} />
          ))}
          <span className={cn("text-caption", active ? "text-foreground" : "text-fg-tertiary")}>
            {word}
          </span>
        </span>
      ))}
    </div>
  )
}
