import { IconArrowsMove, IconMaximize, IconPointer, IconRotate } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatBinding, type KeybindAction } from "../domain/Keybinds"
import { type Tool, useEditor } from "../editor/store"

const TOOLS: ReadonlyArray<{
  readonly tool: Tool
  readonly label: string
  readonly action: KeybindAction
  readonly icon: typeof IconPointer
}> = [
  { tool: "select", label: "Select", action: "selectMode", icon: IconPointer },
  { tool: "translate", label: "Move", action: "translateMode", icon: IconArrowsMove },
  { tool: "rotate", label: "Rotate", action: "rotateMode", icon: IconRotate },
  { tool: "scale", label: "Scale", action: "scaleMode", icon: IconMaximize }
]

/**
 * Floating tool switcher, bottom-centre of the viewport. Pointer-only: items never take
 * focus (mousedown is prevented, tabIndex -1) and ignore Space/Enter, so keyboard focus
 * and keybinds stay with the viewport.
 */
export function ToolBar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const keybinds = useEditor((s) => s.keybinds)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <ToggleGroup
        value={[tool]}
        onValueChange={(value) => {
          const next = value[0] as Tool | undefined
          if (next !== undefined) setTool(next) // clicking the active tool keeps it
        }}
        spacing={1}
        className="pointer-events-auto rounded-full border border-border/60 bg-background/60 p-1 shadow-lg backdrop-blur-md"
      >
        {TOOLS.map(({ tool: t, label, action, icon: Icon }) => (
          <Tooltip key={t}>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  value={t}
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
            <TooltipContent side="top">
              {label}
              {keybinds[action] !== "" && <Kbd>{formatBinding(keybinds[action])}</Kbd>}
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </div>
  )
}
