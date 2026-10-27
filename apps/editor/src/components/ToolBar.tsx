import { IconArrowsMaximize, IconArrowsMove, IconCube, IconPointer, IconRefresh, IconWorld } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"
import { Separator } from "@workspace/ui/components/separator"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatBinding, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import type { GizmoSpace } from "../editor/gizmo/handles"
import { type Tool, useEditor } from "../editor/store"

/** Icons chosen to match the game's own tool bar (pointer, cross arrows, circular arrows, diagonal arrows). */
const TOOLS: ReadonlyArray<{
  readonly tool: Tool
  readonly action: KeybindAction
  readonly icon: typeof IconPointer
}> = [
  { tool: "select", action: "selectMode", icon: IconPointer },
  { tool: "translate", action: "translateMode", icon: IconArrowsMove },
  { tool: "rotate", action: "rotateMode", icon: IconRefresh },
  { tool: "scale", action: "scaleMode", icon: IconArrowsMaximize }
]

const SPACES: ReadonlyArray<{
  readonly space: GizmoSpace
  readonly label: string
  readonly icon: typeof IconPointer
}> = [
  { space: "local", label: "Local axes", icon: IconCube },
  { space: "world", label: "World axes", icon: IconWorld }
]

/** One round, focus-proof tool bar button with a tooltip showing its label and bindings. */
function BarItem({ value, label, action, icon: Icon }: {
  readonly value: string
  readonly label: string
  readonly action: KeybindAction
  readonly icon: typeof IconPointer
}) {
  const keybinds = useEditor((s) => s.keybinds)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleGroupItem
            value={value}
            aria-label={label}
            tabIndex={-1}
            className="size-8 rounded-full data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") e.preventDefault()
            }}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-1.5">
        {label}
        {keybinds[action].map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Floating tool switcher, bottom-centre of the viewport, with the gizmo's local/world
 * axes toggle beside it. Pointer-only: items never take focus (mousedown is prevented,
 * tabIndex -1) and ignore Space/Enter, so keyboard focus and keybinds stay with the
 * viewport. `disabled` greys it out while the scene is loading.
 */
export function ToolBar({ disabled = false }: { readonly disabled?: boolean }) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const gizmoSpace = useEditor((s) => s.gizmoSpace)
  const setGizmoSpace = useEditor((s) => s.setGizmoSpace)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-background/60 p-1 shadow-lg backdrop-blur-md">
        <ToggleGroup
          value={[tool]}
          onValueChange={(value) => {
            const next = TOOLS.find((t) => value.includes(t.tool))
            if (next !== undefined) setTool(next.tool) // clicking the active tool keeps it
          }}
          spacing={1}
          disabled={disabled}
        >
          {TOOLS.map(({ tool: t, action, icon }) => (
            <BarItem key={t} value={t} label={keybindActionLabels[action]} action={action} icon={icon} />
          ))}
        </ToggleGroup>
        <Separator orientation="vertical" className="my-1.5" />
        <ToggleGroup
          value={[gizmoSpace]}
          onValueChange={(value) => {
            const next = SPACES.find((s) => value.includes(s.space))
            if (next !== undefined) setGizmoSpace(next.space) // clicking the active space keeps it
          }}
          spacing={1}
          disabled={disabled}
        >
          {SPACES.map(({ space, label, icon }) => (
            <BarItem key={space} value={space} label={label} action="toggleGizmoSpace" icon={icon} />
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}
