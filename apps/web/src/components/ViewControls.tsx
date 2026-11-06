import {
  IconAngle,
  IconChevronDown,
  IconCube,
  IconGrid4x4,
  IconHaze,
  IconRestore,
  IconWorld
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Toggle } from "@workspace/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { floorHeightOf } from "../domain/level"
import { AUTO_GRID_COLORS, gizmoSizes, isDefaultDisplay, type Settings, withDefaultDisplay } from "../domain/Settings"
import { formatGridSize, formatRotationStep, GRID_SIZES, ROTATION_STEPS } from "../domain/snap"
import { saveSettings, setGridHeight, updateSettings } from "../editor/actions"
import { useEditor, useOpenPrefab } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { ColorSetting } from "./ColorSetting"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"
import { ToolBar } from "./ToolBar"
import { GROUP, GROUP_DIVIDER, noFocus, releaseFocus, SEGMENT } from "./viewControlStyle"
import { ViewLayoutControl, ViewPanes } from "./ViewPanes"
import { ViewTip, ViewTipBoundary } from "./ViewTip"

/**
 * Everything floating over the viewport: its panes' frames, the tool bar (bottom) and, in the viewport's top right like
 * the game's, over every pane since they all share them, two pills: how the view divides into panes and what it displays,
 * then the gizmo's axes with grid and rotation snapping. Pointer-only, so keybinds stay with the viewport.
 */
export function ViewportControls({ disabled }: { readonly disabled: boolean }) {
  const settings = useEditor((s) => s.settings)
  const { enabled, gridSize, rotationEnabled, rotationStep } = settings.snapping
  const units = settings.general.units
  const update = (snapping: Partial<Settings["snapping"]>) => void updateSettings("snapping", snapping)

  return (
    <ViewTipBoundary>
      <ViewPanes disabled={disabled} />
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap justify-end gap-2">
        <div className={GROUP}>
          <ViewLayoutControl disabled={disabled} />
          <span aria-hidden className={GROUP_DIVIDER} />
          <DisplayControl disabled={disabled} />
        </div>
        <div className={GROUP}>
          <AxesToggle disabled={disabled} />
          <span aria-hidden className={GROUP_DIVIDER} />
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
          <span aria-hidden className={GROUP_DIVIDER} />
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
        </div>
      </div>
      <ToolBar disabled={disabled} />
    </ViewTipBoundary>
  )
}

/** The gizmo's axes: the piece's own (cube) or the world's (globe). */
function AxesToggle({ disabled }: { readonly disabled: boolean }) {
  const local = useEditor((s) => s.gizmoSpace === "local")
  const toggleGizmoSpace = useEditor((s) => s.toggleGizmoSpace)
  const label = local ? "Gizmo follows the piece's axes" : "Gizmo follows the world's axes"
  return (
    <ViewTip
      label={label}
      action="toggleGizmoSpace"
      render={
        <Toggle
          pressed={local}
          onPressedChange={toggleGizmoSpace}
          disabled={disabled}
          aria-label={label}
          className={cn(SEGMENT, "aria-pressed:bg-transparent aria-pressed:hover:bg-hover")}
          {...noFocus}
        />
      }
    >
      {local ? <IconCube /> : <IconWorld />}
      <span className="text-foreground">{local ? "Local" : "World"}</span>
    </ViewTip>
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

/**
 * Where the open map's grid sits, kept with its prefs; a prefab tab has no such thing. It's in the popup so it only looks
 * for the player start while that's open.
 */
function GridHeightRow() {
  const units = useEditor((s) => s.settings.general.units)
  const floorHeight = useEditor((s) => s.floorHeight)
  const startHeight = useEditor((s) => floorHeightOf(s.doc.map))
  const perUnit = units === "m" ? 100 : 1
  return (
    <div className="flex flex-col gap-1 py-2">
      Grid height
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <NumberField
            label="Grid height"
            value={floorHeight / perUnit}
            digits={units === "m" ? 3 : 1}
            handle={false}
            unit={units}
            onCommit={(value) => void setGridHeight(value * perUnit)}
          />
        </div>
        <Button
          variant="outline"
          disabled={floorHeight === startHeight}
          onClick={() => void setGridHeight(startHeight)}
        >
          Use player start
        </Button>
      </div>
      <span className="text-fg-tertiary">Where the grid sits and new pieces land.</span>
    </div>
  )
}

/** The two grid colours, as Settings › Appearance has them, and one way back to automatic for both. */
function GridColorsRow() {
  const { theme, gridCellColor, gridSectionColor } = useEditor((s) => s.settings.appearance)
  const auto = AUTO_GRID_COLORS[useDarkTheme(theme) ? "dark" : "light"]
  const automatic = gridCellColor === null && gridSectionColor === null
  return (
    <div className="flex flex-col gap-1 pb-2">
      <div className="flex h-6 items-center justify-between">
        Grid colours
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Use automatic grid colours"
          disabled={automatic}
          onClick={() => void updateSettings("appearance", { gridCellColor: null, gridSectionColor: null })}
        >
          <IconRestore />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-caption text-fg-tertiary">
        <span>1 m cells</span>
        <span>10 m sections</span>
        <ColorSetting
          label="Grid colour (1 m cells)"
          className="w-full"
          value={gridCellColor}
          auto={auto.cell}
          onChange={(v) => void updateSettings("appearance", { gridCellColor: v })}
        />
        <ColorSetting
          label="Grid colour (10 m sections)"
          className="w-full"
          value={gridSectionColor}
          auto={auto.section}
          onChange={(v) => void updateSettings("appearance", { gridSectionColor: v })}
        />
      </div>
    </div>
  )
}

/** The axis gizmo's size and when it shows. */
function GizmoRows() {
  const { size, showForGroups } = useEditor((s) => s.settings.gizmo)
  return (
    <div className="flex flex-col gap-1 pt-2">
      <SectionTitle>Gizmo</SectionTitle>
      <div className="flex h-7 items-center justify-between gap-4">
        Size
        <ToggleGroup
          aria-label="Gizmo size"
          value={[size]}
          onValueChange={(value) => {
            const next = gizmoSizes.find((choice) => value.includes(choice))
            if (next !== undefined) void updateSettings("gizmo", { size: next }) // clicking the pressed size keeps it
          }}
        >
          {gizmoSizes.map((choice) => (
            <ToggleGroupItem key={choice} value={choice} className="min-w-8 uppercase">{choice}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <DisplayRow
        label="Show for groups"
        checked={showForGroups}
        onChange={(on) => void updateSettings("gizmo", { showForGroups: on })}
      />
    </div>
  )
}

/** The one home of what the viewport shows around the map, and of where its grid sits. */
function DisplayRows() {
  const settings = useEditor((s) => s.settings)
  const { gridVisible, waterVisible } = settings.appearance
  const { mapLighting, skyVisible } = settings.lighting
  const prefab = useOpenPrefab()
  const floorHeight = useEditor((s) => s.floorHeight)
  const startHeight = useEditor((s) => floorHeightOf(s.doc.map))
  const gridHeight = prefab === null ? startHeight : null
  const reset = () => {
    void saveSettings(withDefaultDisplay(settings))
    if (gridHeight !== null) void setGridHeight(gridHeight)
  }
  return (
    <>
      <div className="pb-1">
        <DisplayRow
          label="Show grid"
          checked={gridVisible}
          onChange={(on) => void updateSettings("appearance", { gridVisible: on })}
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
        <DisplayRow
          label="Map lighting"
          checked={mapLighting}
          onChange={(on) => void updateSettings("lighting", { mapLighting: on })}
        />
      </div>
      {prefab === null && <GridHeightRow />}
      <GridColorsRow />
      <GizmoRows />
      <div className="flex justify-end py-2">
        <Button
          variant="outline"
          disabled={isDefaultDisplay(settings) && (gridHeight === null || floorHeight === gridHeight)}
          onClick={reset}
        >
          Reset to defaults
        </Button>
      </div>
    </>
  )
}

function DisplayControl({ disabled }: { readonly disabled: boolean }) {
  return (
    <Popover>
      <ViewTip
        label="Grid, sky, water and lighting"
        render={
          <PopoverTrigger
            disabled={disabled}
            render={<button type="button" className={SEGMENT} {...noFocus} />}
          />
        }
      >
        <IconHaze className="size-4" />
        <span className="text-foreground">Display</span>
        <IconChevronDown className="size-3" />
      </ViewTip>
      <PopoverContent align="end" initialFocus={false} finalFocus={false} className="w-72 gap-0 px-3 py-1">
        <DisplayRows />
      </PopoverContent>
    </Popover>
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
    <>
      <ViewTip
        label={`${props.label}: ${enabled ? "on" : "off"}`}
        render={
          <Toggle
            pressed={enabled}
            onPressedChange={props.onToggle}
            disabled={disabled}
            aria-label={props.label}
            className={cn(SEGMENT, "aria-pressed:bg-primary/12 aria-pressed:text-foreground")}
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
                "border-none bg-transparent px-2 tabular-nums data-[size=default]:h-full dark:bg-transparent [&>svg]:hidden",
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
    </>
  )
}
