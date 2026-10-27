import { IconArrowsMaximize, IconArrowsMove, IconPointer, IconRefresh } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatBinding, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
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

/**
 * Floating tool switcher, bottom-centre of the viewport. Pointer-only: items never take
 * focus (mousedown is prevented, tabIndex -1) and ignore Space/Enter, so keyboard focus
 * and keybinds stay with the viewport. `disabled` greys it out while the scene is loading.
 */
export function ToolBar({ disabled = false }: { readonly disabled?: boolean }) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const keybinds = useEditor((s) => s.keybinds)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <ToggleGroup
        value={[tool]}
        onValueChange={(value) => {
          const next = TOOLS.find((t) => value.includes(t.tool))
          if (next !== undefined) setTool(next.tool) // clicking the active tool keeps it
        }}
        spacing={1}
        disabled={disabled}
        className="pointer-events-auto rounded-full border border-border/60 bg-background/60 p-1 shadow-lg backdrop-blur-md"
      >
        {TOOLS.map(({ tool: t, action, icon: Icon }) => (
          <Tooltip key={t}>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  value={t}
                  aria-label={keybindActionLabels[action]}
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
              {keybindActionLabels[action]}
              {keybinds[action].map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </div>
  )
}
