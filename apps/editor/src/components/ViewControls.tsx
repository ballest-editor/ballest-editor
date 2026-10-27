import { IconCube, IconMagnet, IconWorld } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Toggle } from "@workspace/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { KeyboardEvent, MouseEvent } from "react"
import { formatBinding } from "../domain/Keybinds"
import type { Settings } from "../domain/Settings"
import { formatGridSize, GRID_SIZES, type GridSize } from "../domain/snap"
import { saveSettings } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ToolBar } from "./ToolBar"

/** Keeps keyboard focus with the viewport: no focus on mousedown, no Space/Enter activation. */
const noFocus = {
  tabIndex: -1,
  onMouseDown: (e: MouseEvent) => e.preventDefault(),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") e.preventDefault()
  }
}

/**
 * Floating view controls, top-right of the viewport, like the game's: the gizmo's local
 * (cube) or world (globe) axes, then grid snapping. Icons are named in their tooltips.
 * Pointer-only like the tool bar, so keybinds stay with the viewport.
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
                className="size-8 rounded-full aria-pressed:bg-transparent aria-pressed:hover:bg-muted"
                {...noFocus}
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
        <SnapControls disabled={disabled} />
      </div>
    </div>
  )
}

/**
 * Grid snapping for gizmo translation: the magnet turns it on and off, the menu picks the
 * grid size (and turns snapping on). Saved with the settings.
 */
function SnapControls({ disabled }: { readonly disabled: boolean }) {
  const settings = useEditor((s) => s.settings)
  const { enabled, gridSize } = settings.snapping
  const units = settings.general.units
  const update = (snapping: Partial<Settings["snapping"]>) =>
    void saveSettings({ ...settings, snapping: { ...settings.snapping, ...snapping } })
  const items = Object.fromEntries(GRID_SIZES.map((size) => [size, formatGridSize(size, units)]))

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              pressed={enabled}
              onPressedChange={(pressed) => update({ enabled: pressed })}
              disabled={disabled}
              aria-label="Snap to grid"
              className="size-8 rounded-full data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
              {...noFocus}
            />
          }
        >
          <IconMagnet />
        </TooltipTrigger>
        <TooltipContent side="bottom">Snap to grid {enabled ? "on" : "off"}</TooltipContent>
      </Tooltip>
      <Select
        value={gridSize}
        items={items}
        disabled={disabled}
        onValueChange={(size: GridSize | null) => size !== null && update({ enabled: true, gridSize: size })}
        onOpenChangeComplete={(open) => {
          // Hand focus back to the viewport so Space doesn't reopen the menu.
          if (!open && document.activeElement instanceof HTMLElement) document.activeElement.blur()
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                aria-label="Grid size"
                tabIndex={-1}
                className={`h-8 w-22 rounded-full border-none bg-transparent pr-2 pl-3 tabular-nums dark:bg-transparent ${
                  enabled ? "" : "text-muted-foreground"
                }`}
              />
            }
          >
            <SelectValue />
          </TooltipTrigger>
          <TooltipContent side="bottom">Grid size</TooltipContent>
        </Tooltip>
        <SelectContent side="bottom" align="end" alignItemWithTrigger={false}>
          {GRID_SIZES.map((size) => (
            <SelectItem key={size} value={size} className="tabular-nums">
              {items[size]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
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
