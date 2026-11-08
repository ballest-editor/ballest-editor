import {
  IconAngle,
  IconChevronDown,
  IconCircleDot,
  IconCircles,
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
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { soleGroupOf } from "../domain/groupSelection"
import { floorHeightOf } from "../domain/level"
import { AUTO_GRID_COLORS, isDefaultDisplay, withDefaultDisplay } from "../domain/Settings"
import { formatGridSize, formatRotationStep, GRID_SIZES, ROTATION_STEPS } from "../domain/snap"
import {
  pickGridSize,
  saveSettings,
  setGridHeight,
  updateSettings,
  updateSnap,
  updateSnapTarget
} from "../editor/actions"
import {
  selectionUnits,
  shownGizmoSpace,
  shownPivotMode,
  shownTransform,
  snapConfigOf,
  useEditor,
  useOpenPrefab
} from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { ColorSetting } from "./ColorSetting"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"
import { SizeToggle } from "./SizeToggle"
import { SnapMagnet } from "./SnapMagnet"
import { ToolBar } from "./ToolBar"
import { CONTROL_WORD, GROUP, GROUP_DIVIDER, noFocus, releaseFocus, SEGMENT } from "./viewControlStyle"
import { ViewLayoutControl, ViewPanes } from "./ViewPanes"
import { ViewTip, ViewTipBoundary } from "./ViewTip"

/**
 * Everything floating over the viewport: its panes' frames, the tool bar (bottom) and, in the viewport's top right like
 * the game's, over every pane since they all share them, two pills: how the view divides into panes and what it displays,
 * then the gizmo's pivot and axes with snapping: the magnet and its menu, and the grid and angle steps. They sit in the top right pane's corner (`ViewPanes`): as that
 * pane narrows they go to icons, and only then does the second pill drop under the first, clear of the pane's label.
 * Pointer-only, so keybinds stay with the viewport.
 */
export function ViewportControls({ disabled }: { readonly disabled: boolean }) {
  const units = useEditor((s) => s.settings.general.units)
  const { enabled, gridSize, rotationEnabled, rotationStep, targets } = useEditor(snapConfigOf)

  return (
    <ViewTipBoundary>
      <ViewPanes disabled={disabled}>
        <div className="absolute top-3 right-3 flex items-end gap-2 @max-[30rem]/corner:flex-col" data-view-controls>
          <div className={GROUP}>
            <ViewLayoutControl disabled={disabled} />
            <span aria-hidden className={GROUP_DIVIDER} />
            <DisplayControl disabled={disabled} />
          </div>
          <div className={GROUP}>
            <PivotToggle disabled={disabled} />
            <span aria-hidden className={GROUP_DIVIDER} />
            <AxesToggle disabled={disabled} />
            <span aria-hidden className={GROUP_DIVIDER} />
            <SnapMagnet disabled={disabled} />
            <span aria-hidden className={GROUP_DIVIDER} />
            <SnapGroup
              icon={<IconGrid4x4 />}
              label="Snap to grid"
              enabled={targets.grid.enabled}
              snapping={enabled}
              onToggle={(pressed) => updateSnapTarget("grid", { enabled: pressed })}
              value={gridSize}
              options={GRID_SIZES}
              onPick={pickGridSize}
              valueLabel="Grid size"
              format={(size) => formatGridSize(size, units)}
              disabled={disabled}
            />
            <span aria-hidden className={GROUP_DIVIDER} />
            <SnapGroup
              icon={<IconAngle />}
              label="Snap angle"
              enabled={rotationEnabled}
              snapping={enabled}
              onToggle={(pressed) => updateSnap({ rotationEnabled: pressed })}
              value={rotationStep}
              options={ROTATION_STEPS}
              onPick={(step) => updateSnap({ rotationEnabled: true, rotationStep: step })}
              valueLabel="Angle step"
              format={formatRotationStep}
              disabled={disabled}
            />
          </div>
        </div>
      </ViewPanes>
      <ToolBar disabled={disabled} />
    </ViewTipBoundary>
  )
}

/**
 * What a selection pivots about: one point for all, the active one's pivot, as the game does (Together), or each unit
 * its own (Each). Each needs two or more pieces or groups, so with fewer the toggle is held at Together and says why.
 */
function PivotToggle({ disabled }: { readonly disabled: boolean }) {
  const each = useEditor((s) => shownPivotMode(s) === "each")
  const units = useEditor((s) => selectionUnits(s, (id) => shownTransform(s, id))?.units.length ?? 0)
  const soleGroup = useEditor((s) => soleGroupOf(s.doc.structure.tree, s.selectedIds, s.enteredGroupId) !== undefined)
  const worldMove = useEditor((s) => s.tool === "translate" && shownGizmoSpace(s) === "world")
  const togglePivotMode = useEditor((s) => s.togglePivotMode)
  const held = units < 2
  const label = held
    ? soleGroup
      ? "One group is one piece to Each: enter it to work on its members"
      : "Each needs two or more pieces or groups selected"
    : each
    ? `Each piece or group pivots on its own${worldMove ? " (same as Together for a move along world axes)" : ""}`
    : `Everything pivots on the active piece, as the game does${
      worldMove ? " (same as Each for a move along world axes)" : ""
    }`
  return (
    <ViewTip
      label={label}
      action="togglePivotMode"
      render={
        <Toggle
          pressed={each}
          onPressedChange={togglePivotMode}
          disabled={disabled || held}
          aria-label={label}
          className={cn(SEGMENT, "aria-pressed:bg-transparent aria-pressed:hover:bg-hover")}
          {...noFocus}
        />
      }
    >
      {each ? <IconCircles /> : <IconCircleDot />}
      <span className={cn("text-foreground", CONTROL_WORD)}>{each ? "Each" : "Together"}</span>
    </ViewTip>
  )
}

/** The gizmo's axes: the piece's own (cube) or the world's (globe). Scale is always the piece's, so it holds the toggle there. */
function AxesToggle({ disabled }: { readonly disabled: boolean }) {
  const local = useEditor((s) => shownGizmoSpace(s) === "local")
  const scaling = useEditor((s) => s.tool === "scale")
  const toggleGizmoSpace = useEditor((s) => s.toggleGizmoSpace)
  const label = scaling
    ? "Scale always follows the piece's axes"
    : local
    ? "Gizmo follows the piece's axes"
    : "Gizmo follows the world's axes"
  return (
    <ViewTip
      label={label}
      action="toggleGizmoSpace"
      render={
        <Toggle
          pressed={local}
          onPressedChange={toggleGizmoSpace}
          disabled={disabled || scaling}
          aria-label={label}
          className={cn(SEGMENT, "aria-pressed:bg-transparent aria-pressed:hover:bg-hover")}
          {...noFocus}
        />
      }
    >
      {local ? <IconCube /> : <IconWorld />}
      <span className={cn("text-foreground", CONTROL_WORD)}>{local ? "Local" : "World"}</span>
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
        Grid colors
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
          label="Grid color (1 m cells)"
          className="w-full"
          value={gridCellColor}
          auto={auto.cell}
          onChange={(v) => void updateSettings("appearance", { gridCellColor: v })}
        />
        <ColorSetting
          label="Grid color (10 m sections)"
          className="w-full"
          value={gridSectionColor}
          auto={auto.section}
          onChange={(v) => void updateSettings("appearance", { gridSectionColor: v })}
        />
      </div>
    </div>
  )
}

/** The transform gizmo's size and when it shows. */
function GizmoRows() {
  const { size, showForGroups } = useEditor((s) => s.settings.gizmo)
  return (
    <div className="flex flex-col gap-1 pt-2">
      <SectionTitle>Gizmo</SectionTitle>
      <div className="flex h-7 items-center justify-between gap-4">
        Size
        <SizeToggle label="Gizmo size" value={size} onChange={(next) => void updateSettings("gizmo", { size: next })} />
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
            render={<button type="button" aria-label="Display" className={SEGMENT} {...noFocus} />}
          />
        }
      >
        <IconHaze className="size-4" />
        <span className={cn("text-foreground", CONTROL_WORD)}>Display</span>
        <IconChevronDown className={cn("size-3", CONTROL_WORD)} />
      </ViewTip>
      <PopoverContent align="end" initialFocus={false} finalFocus={false} className="w-72 gap-0 px-3 py-1">
        <DisplayRows />
      </PopoverContent>
    </Popover>
  )
}

/**
 * One kind of gizmo snapping: the icon turns it on and off, the value next to it picks the step and turns it on. Both
 * stay working while snapping as a whole (the magnet beside them) is off, and are dimmed to say they wait on it.
 */
function SnapGroup<V extends number>(props: {
  readonly icon: ReactNode
  readonly label: string
  readonly enabled: boolean
  /** Snapping as a whole. */
  readonly snapping: boolean
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
  const { enabled, disabled, snapping } = props
  const items = Object.fromEntries(props.options.map((v) => [v, props.format(v)]))

  return (
    <>
      <ViewTip
        label={`${props.label}: ${enabled ? "on" : "off"}${snapping ? "" : " (snapping is off)"}`}
        action={snapping ? undefined : "snapToggle"}
        render={
          <Toggle
            pressed={enabled}
            onPressedChange={props.onToggle}
            disabled={disabled}
            aria-label={props.label}
            className={cn(
              SEGMENT,
              "aria-pressed:bg-primary/12",
              snapping ? "aria-pressed:text-foreground" : "text-fg-disabled aria-pressed:text-fg-tertiary"
            )}
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
          label={`${props.valueLabel}: ${props.format(props.value)}`}
          render={
            <SelectTrigger
              aria-label={props.valueLabel}
              tabIndex={-1}
              className={cn(
                SEGMENT,
                "border-none bg-transparent px-2 tabular-nums data-[size=default]:h-full dark:bg-transparent [&>svg]:hidden @max-[42rem]/corner:px-1 @max-[42rem]/corner:*:data-[slot=select-value]:hidden @max-[42rem]/corner:[&>svg]:block",
                enabled && snapping ? "text-foreground" : snapping ? "text-fg-tertiary" : "text-fg-disabled"
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
