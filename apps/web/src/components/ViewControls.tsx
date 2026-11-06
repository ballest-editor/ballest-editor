import { IconAngle, IconCube, IconEye, IconGrid4x4, IconWorld } from "@tabler/icons-react"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Toggle } from "@workspace/ui/components/toggle"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import type { Settings } from "../domain/Settings"
import { formatGridSize, formatRotationStep, GRID_SIZES, ROTATION_STEPS } from "../domain/snap"
import { updateSettings } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ToolBar } from "./ToolBar"
import { GROUP, noFocus, releaseFocus, SEGMENT, SEGMENT_ON } from "./viewControlStyle"
import { ActivePaneBox, ViewLayoutControl, ViewPanes } from "./ViewPanes"
import { ViewTip } from "./ViewTip"

/**
 * Everything floating over the viewport: its panes' frames, the tool bar (bottom) and, in the active pane's top right
 * like the game's, how the view divides into panes, what it displays, the gizmo's axes, then grid and rotation snapping.
 * Pointer-only, so keybinds stay with the viewport.
 */
export function ViewportControls({ disabled }: { readonly disabled: boolean }) {
  const settings = useEditor((s) => s.settings)
  const { enabled, gridSize, rotationEnabled, rotationStep } = settings.snapping
  const units = settings.general.units
  const update = (snapping: Partial<Settings["snapping"]>) => void updateSettings("snapping", snapping)

  return (
    <>
      <ViewPanes disabled={disabled} />
      <ActivePaneBox>
        <ViewLayoutControl disabled={disabled} />
        <DisplayControl disabled={disabled} />
        <AxesToggle disabled={disabled} />
        <SnapGroup
          icon={<IconGrid4x4 />}
          label="Snap to grid"
          enabled={enabled}
          onToggle={(pressed) => update({ enabled: pressed })}
          value={gridSize}
          options={GRID_SIZES}
          onPick={(size) => update({ enabled: true, gridSize: size })}
          valueLabel="Grid size"
          format={(size) => formatGridSize(size, units)}
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
          format={formatRotationStep}
          disabled={disabled}
        />
      </ActivePaneBox>
      <ToolBar disabled={disabled} />
    </>
  )
}

/** The gizmo's axes: the piece's own (cube) or the world's (globe). */
function AxesToggle({ disabled }: { readonly disabled: boolean }) {
  const local = useEditor((s) => s.gizmoSpace === "local")
  const toggleGizmoSpace = useEditor((s) => s.toggleGizmoSpace)
  const label = local ? "Gizmo follows the piece's axes" : "Gizmo follows the world's axes"
  return (
    <div className={GROUP}>
      <ViewTip
        label={label}
        action="toggleGizmoSpace"
        render={
          <Toggle
            pressed={local}
            onPressedChange={toggleGizmoSpace}
            disabled={disabled}
            aria-label={label}
            className={cn(SEGMENT, "gap-1.5 aria-pressed:bg-transparent aria-pressed:hover:bg-muted")}
            {...noFocus}
          />
        }
      >
        {local ? <IconCube /> : <IconWorld />}
        <span className="text-foreground">{local ? "Local" : "World"}</span>
      </ViewTip>
    </div>
  )
}

function DisplayRow({ label, checked, onChange }: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-7 items-center justify-between gap-4">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

/** What the viewport shows around the map; the same settings as Settings › Appearance and Lighting. */
function DisplayControl({ disabled }: { readonly disabled: boolean }) {
  const { mapLighting, skyVisible } = useEditor((s) => s.settings.lighting)
  const waterVisible = useEditor((s) => s.settings.appearance.waterVisible)
  return (
    <div className={GROUP}>
      <Popover>
        <ViewTip
          label="Display"
          render={
            <PopoverTrigger
              disabled={disabled}
              render={<button type="button" aria-label="Display" className={SEGMENT} {...noFocus} />}
            />
          }
        >
          <IconEye className="size-4" />
        </ViewTip>
        <PopoverContent align="end" finalFocus={false} className="w-44 gap-0 px-3 py-1.5">
          <DisplayRow
            label="Map lighting"
            checked={mapLighting}
            onChange={(on) => void updateSettings("lighting", { mapLighting: on })}
          />
          <DisplayRow
            label="Show sky"
            checked={skyVisible}
            onChange={(on) => void updateSettings("lighting", { skyVisible: on })}
          />
          <DisplayRow
            label="Show water"
            checked={waterVisible}
            onChange={(on) => void updateSettings("appearance", { waterVisible: on })}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** One kind of gizmo snapping: the icon turns it on and off, the value next to it picks the step and turns it on. */
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
  /** The step, with its unit, on the button and in the list. */
  readonly format: (value: V) => string
  readonly disabled: boolean
}) {
  const { enabled, disabled } = props
  const items = Object.fromEntries(props.options.map((v) => [v, props.format(v)]))

  return (
    <div className={GROUP}>
      <ViewTip
        label={`${props.label}: ${enabled ? "on" : "off"}`}
        render={
          <Toggle
            pressed={enabled}
            onPressedChange={props.onToggle}
            disabled={disabled}
            aria-label={props.label}
            className={cn(SEGMENT, SEGMENT_ON)}
            {...noFocus}
          />
        }
      >
        {props.icon}
      </ViewTip>
      <Select
        value={props.value}
        items={items}
        disabled={disabled}
        onValueChange={(v: V | null) => v !== null && props.onPick(v)}
        onOpenChangeComplete={releaseFocus}
      >
        <ViewTip
          label={props.valueLabel}
          render={
            <SelectTrigger
              aria-label={props.valueLabel}
              tabIndex={-1}
              className={cn(
                SEGMENT,
                "border-none bg-transparent px-2 tabular-nums data-[size=default]:h-full dark:bg-transparent dark:hover:bg-muted [&>svg]:hidden",
                enabled ? "text-foreground" : "text-fg-tertiary"
              )}
            />
          }
        >
          <SelectValue className="flex-none justify-center text-center" />
        </ViewTip>
        <SelectContent side="bottom" align="end" alignItemWithTrigger={false}>
          {props.options.map((v) => (
            <SelectItem key={v} value={v} className="tabular-nums">
              {props.format(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
