import { IconAngle, IconCube, IconGrid4x4, IconWorld } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Toggle } from "@workspace/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ReactNode } from "react"
import { formatBinding } from "../domain/Keybinds"
import type { Settings } from "../domain/Settings"
import { formatGridSize, formatRotationStep, GRID_SIZES, ROTATION_STEPS } from "../domain/snap"
import { updateSettings } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ToolBar } from "./ToolBar"
import { GROUP, noFocus, POPUP_OFFSET } from "./viewControlStyle"
import { ViewLayoutControl, ViewPanes } from "./ViewPanes"

/**
 * Everything floating over the viewport: its panes' frames, the tool bar (bottom) and, top right like the game's, how the
 * view divides into panes, the gizmo's local (cube) or world (globe) axes, then grid and rotation snapping. Pointer-only,
 * so keybinds stay with the viewport.
 */
export function ViewportControls({ disabled }: { readonly disabled: boolean }) {
  const gizmoSpace = useEditor((s) => s.gizmoSpace)
  const toggleGizmoSpace = useEditor((s) => s.toggleGizmoSpace)
  const keybinds = useEditor((s) => s.keybinds)
  const settings = useEditor((s) => s.settings)
  const local = gizmoSpace === "local"
  const label = local ? "Using piece-local axes" : "Using world axes"
  const { enabled, gridSize, rotationEnabled, rotationStep } = settings.snapping
  const units = settings.general.units
  const update = (snapping: Partial<Settings["snapping"]>) => void updateSettings("snapping", snapping)
  const degrees = (step: number) => `${formatRotationStep(step)}°`

  return (
    <>
      <ViewPanes disabled={disabled} />
      <div className="pointer-events-none absolute top-3 right-3 flex justify-end gap-2">
        <ViewLayoutControl disabled={disabled} />
        <div className={GROUP}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  pressed={local}
                  onPressedChange={toggleGizmoSpace}
                  disabled={disabled}
                  aria-label={label}
                  className="size-8 rounded-control aria-pressed:bg-transparent aria-pressed:hover:bg-muted"
                  {...noFocus}
                />
              }
            >
              {local ? <IconCube /> : <IconWorld />}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={POPUP_OFFSET.button} className="flex items-center gap-1.5">
              {label}
              {keybinds.toggleGizmoSpace.map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
            </TooltipContent>
          </Tooltip>
        </div>
        <SnapGroup
          icon={<IconGrid4x4 />}
          label="Snap to grid"
          enabled={enabled}
          onToggle={(pressed) => update({ enabled: pressed })}
          value={gridSize}
          options={GRID_SIZES}
          onPick={(size) => update({ enabled: true, gridSize: size })}
          valueLabel={`Grid size (${units})`}
          // The button shows just the number, like the game's; the menu and tooltip carry the unit.
          short={(size) => String(units === "m" ? size / 100 : size)}
          long={(size) => formatGridSize(size, units)}
          disabled={disabled}
        />
        <SnapGroup
          icon={<IconAngle />}
          label="Snap rotation"
          enabled={rotationEnabled}
          onToggle={(pressed) => update({ rotationEnabled: pressed })}
          value={rotationStep}
          options={ROTATION_STEPS}
          onPick={(step) => update({ rotationEnabled: true, rotationStep: step })}
          valueLabel="Rotation step"
          short={degrees}
          long={degrees}
          disabled={disabled}
        />
      </div>
      <ToolBar disabled={disabled} />
    </>
  )
}

/** One kind of gizmo snapping: the icon turns it on and off, the number next to it picks the step and turns it on. */
function SnapGroup<V extends number>(props: {
  readonly icon: ReactNode
  readonly label: string
  readonly enabled: boolean
  readonly onToggle: (pressed: boolean) => void
  readonly value: V
  readonly options: ReadonlyArray<V>
  readonly onPick: (value: V) => void
  /** Names the step picker in its tooltip. */
  readonly valueLabel: string
  /** The step on the button, and in the menu. */
  readonly short: (value: V) => string
  readonly long: (value: V) => string
  readonly disabled: boolean
}) {
  const { enabled, disabled } = props
  const items = Object.fromEntries(props.options.map((v) => [v, props.short(v)]))

  return (
    <div className={GROUP}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              pressed={enabled}
              onPressedChange={props.onToggle}
              disabled={disabled}
              aria-label={props.label}
              className="size-8 rounded-control data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
              {...noFocus}
            />
          }
        >
          {props.icon}
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={POPUP_OFFSET.button}>
          {props.label} {enabled ? "on" : "off"}
        </TooltipContent>
      </Tooltip>
      <Select
        value={props.value}
        items={items}
        disabled={disabled}
        onValueChange={(v: V | null) => v !== null && props.onPick(v)}
        onOpenChangeComplete={(open) => {
          // Hand focus back to the viewport so Space doesn't reopen the menu.
          if (!open && document.activeElement instanceof HTMLElement) document.activeElement.blur()
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                aria-label={props.valueLabel}
                size="sm"
                tabIndex={-1}
                className={`min-w-8 justify-center rounded-control border-none bg-transparent px-1.5 tabular-nums dark:bg-transparent [&>svg]:hidden ${
                  enabled ? "" : "text-fg-tertiary"
                }`}
              />
            }
          >
            <SelectValue className="flex-none justify-center text-center" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={POPUP_OFFSET.size}>{props.valueLabel}</TooltipContent>
        </Tooltip>
        <SelectContent side="bottom" sideOffset={POPUP_OFFSET.size} align="end" alignItemWithTrigger={false}>
          {props.options.map((v) => (
            <SelectItem key={v} value={v} className="tabular-nums">
              {props.long(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
