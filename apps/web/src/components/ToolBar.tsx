import { IconArrowsMaximize, IconArrowsMove, IconBrush, IconPointer, IconRefresh } from "@tabler/icons-react"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import type { KeybindAction } from "../domain/Keybinds"
import { type Tool, useEditor } from "../editor/store"
import { PaintPalette } from "./PaintPalette"
import { GROUP, noFocus, SEGMENT } from "./viewControlStyle"
import { ViewTip } from "./ViewTip"

/**
 * Icons chosen to match the game's own tool bar (pointer, cross arrows, circular arrows, diagonal arrows); the brush is
 * the editor's own tool.
 */
const TOOLS: ReadonlyArray<{
  readonly tool: Tool
  readonly label: string
  readonly action: KeybindAction
  readonly icon: typeof IconPointer
}> = [
  { tool: "select", label: "Select", action: "selectMode", icon: IconPointer },
  { tool: "translate", label: "Move", action: "translateMode", icon: IconArrowsMove },
  { tool: "rotate", label: "Rotate", action: "rotateMode", icon: IconRefresh },
  { tool: "scale", label: "Scale", action: "scaleMode", icon: IconArrowsMaximize },
  { tool: "paint", label: "Paint", action: "paintMode", icon: IconBrush }
]

/** The tools with chrome of their own over the tool bar while they're on: a view each (viewIds.ts, `tool:<tool>`). */
export const toolPanels: ReadonlyArray<Tool> = ["paint"]

/**
 * Tool switcher, bottom-centre of the viewport. It belongs to no pane and floats over them all: a divider under it passes
 * behind the pill and drags from either side of it. The paint tool's palette sits above it while that tool is on, and
 * scrolls rather than grow past the top of the viewport. Pointer-only, so keybinds stay with the viewport.
 */
export function ToolBar({ disabled }: { readonly disabled: boolean }) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 bottom-3 flex flex-col items-center justify-end gap-2">
      {tool === "paint" && !disabled && <PaintPalette />}
      <ToggleGroup
        pill="primary"
        value={[tool]}
        onValueChange={(value) => {
          const next = TOOLS.find((t) => value.includes(t.tool))
          if (next !== undefined) setTool(next.tool) // clicking the active tool keeps it
        }}
        disabled={disabled}
        className={cn(GROUP, "h-9 shrink-0")}
      >
        {TOOLS.map(({ tool: t, label, action, icon: Icon }) => (
          <ViewTip
            key={t}
            label={label}
            action={action}
            side="top"
            render={
              <ToggleGroupItem
                value={t}
                aria-label={label}
                className={cn(SEGMENT, "aspect-square px-0")}
                {...noFocus}
              />
            }
          >
            <Icon className="size-5" />
          </ViewTip>
        ))}
      </ToggleGroup>
    </div>
  )
}
