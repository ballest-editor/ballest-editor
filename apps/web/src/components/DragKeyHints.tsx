import { cn } from "@workspace/ui/lib/utils"
import { dragHintsOf } from "../editor/snap/dragKeys"
import { useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"

/**
 * The keys a drag can take, in the middle of the status bar from the press to the release, as Blender lists a modal
 * tool's keys (docs/SNAPPING.md § Modifiers). What is held, or the lock that is set, takes the pressed wash.
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
            <KeyChip key={binding} binding={binding} className={cn(down && "bg-primary/12 text-foreground")} />
          ))}
          <span className={cn("text-caption", active ? "text-foreground" : "text-fg-tertiary")}>{word}</span>
        </span>
      ))}
    </div>
  )
}
