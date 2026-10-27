import { IconCube, IconWorld } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"
import { Toggle } from "@workspace/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatBinding } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { ToolBar } from "./ToolBar"

/**
 * Floating view controls, top-right of the viewport, like the game's. For now one
 * icon toggle: the gizmo's local (cube) or world (globe) axes, named in its tooltip. Pointer-only like the tool bar, so keybinds stay with the viewport.
 */
export function ViewControls({ disabled = false }: { readonly disabled?: boolean }) {
  const gizmoSpace = useEditor((s) => s.gizmoSpace)
  const toggleGizmoSpace = useEditor((s) => s.toggleGizmoSpace)
  const keybinds = useEditor((s) => s.keybinds)
  const local = gizmoSpace === "local"
  const label = local ? "Using piece-local axes" : "Using world axes"

  return (
    <div className="pointer-events-none absolute top-3 right-3 flex justify-end">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-background/60 p-1 shadow-lg backdrop-blur-md">
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                pressed={local}
                onPressedChange={toggleGizmoSpace}
                disabled={disabled}
                aria-label={label}
                tabIndex={-1}
                className="size-8 rounded-full aria-pressed:bg-transparent aria-pressed:hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") e.preventDefault()
                }}
              />
            }
          >
            {local ? <IconCube /> : <IconWorld />}
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-1.5">
            {label}
            {keybinds.toggleGizmoSpace.map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/** Everything floating over the viewport: the view controls (top right) and the tool bar (bottom). */
export function ViewportControls({ disabled = false }: { readonly disabled?: boolean }) {
  return (
    <>
      <ViewControls disabled={disabled} />
      <ToolBar disabled={disabled} />
    </>
  )
}
