import { IconArrowsMaximize, IconArrowsMove, IconPointer, IconRefresh } from "@tabler/icons-react"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import type { KeybindAction } from "../domain/Keybinds"
import { toolStripOf } from "../domain/viewLayout"
import { type Tool, useEditor } from "../editor/store"
import { GROUP, noFocus, SEGMENT } from "./viewControlStyle"
import { ViewTip } from "./ViewTip"

/** Icons chosen to match the game's own tool bar (pointer, cross arrows, circular arrows, diagonal arrows). */
const TOOLS: ReadonlyArray<{
  readonly tool: Tool
  readonly label: string
  readonly action: KeybindAction
  readonly icon: typeof IconPointer
}> = [
  { tool: "select", label: "Select", action: "selectMode", icon: IconPointer },
  { tool: "translate", label: "Move", action: "translateMode", icon: IconArrowsMove },
  { tool: "rotate", label: "Rotate", action: "rotateMode", icon: IconRefresh },
  { tool: "scale", label: "Scale", action: "scaleMode", icon: IconArrowsMaximize }
]

/**
 * Tool switcher, bottom-centre of the viewport. It belongs to no pane: over one, maximised or not, it floats, and under
 * several it sits in the strip they leave it (`toolStripOf`), so no divider runs through it. Pointer-only, so keybinds
 * stay with the viewport.
 */
export function ToolBar({ disabled }: { readonly disabled: boolean }) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const strip = useEditor((s) => toolStripOf(s.viewLayout))

  return (
    <div
      className={cn(
        "absolute inset-x-0 flex items-center justify-center",
        strip > 0 ? "pointer-events-auto bottom-0 border-t border-border bg-card" : "pointer-events-none bottom-3"
      )}
      style={strip > 0 ? { height: strip } : undefined}
      data-tool-strip={strip > 0 ? "" : undefined}
    >
      <ToggleGroup
        pill="primary"
        value={[tool]}
        onValueChange={(value) => {
          const next = TOOLS.find((t) => value.includes(t.tool))
          if (next !== undefined) setTool(next.tool) // clicking the active tool keeps it
        }}
        disabled={disabled}
        className={cn(GROUP, "h-9")}
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
