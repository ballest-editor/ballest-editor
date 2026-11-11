import { IconChevronDown, IconMagnet } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Toggle } from "@workspace/ui/components/toggle"
import { cn } from "@workspace/ui/lib/utils"
import {
  formatGridSize,
  formatRotationStep,
  formatScaleStep,
  GRID_SIZES,
  ROTATION_STEPS,
  SCALE_STEPS
} from "../domain/snap"
import { annotationsOf } from "../domain/structure"
import {
  pickGridSize,
  preferSnap,
  resetSnapToDefaults,
  saveSnapDefaults,
  setSnapTargets,
  snapIsDefault,
  snapPreferenceOf,
  toggleSnapping,
  updateSnap,
  updateSnapTarget
} from "../editor/actions"
import { snapConfigOf, useEditor } from "../editor/store"
import { SectionTitle } from "./SectionTitle"
import { SnapAdvanced, TARGET_WORDS } from "./SnapAdvanced"
import { DisclosureChevron, Row, RowValue, Segmented, SliderField, StepRow, SwitchRow } from "./SnapParameters"
import { noFocus, SEGMENT } from "./viewControlStyle"
import { ViewTip } from "./ViewTip"

const PREFERENCES = { grid: "Grid", pieces: "Pieces" } as const

/** A block of the menu: its rows flush, blocks 8px apart. */
const BLOCK = "flex flex-col"

/**
 * The snap menu (docs/SNAPPING.md § The snap menu): the magnet, the three steps, what it snaps to in the user's words,
 * which wins, how close is close, then Advanced for the rest and the defaults. The steps have switches of their own;
 * what it snaps to and which wins stay working but dimmed while the magnet is off.
 */
function SnapMenuContent() {
  const config = useEditor(snapConfigOf)
  const units = useEditor((s) => s.settings.general.units)
  const planes = useEditor((s) => annotationsOf(s.doc.structure).construction.length > 0)
  const isDefault = useEditor(snapIsDefault)
  const { alignment, connectors, construction, grid, mesh, tracking } = config.targets
  const dimmed = !config.magnet
  const preference = snapPreferenceOf(config)
  return (
    // The padding is the scroller's own, so a switch's wider hit area stays inside it and the scrollbar sits at the edge.
    <div
      className="flex max-h-[min(80vh,calc(var(--available-height)-0.5rem))] flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-2 [scrollbar-color:color-mix(in_oklch,var(--foreground)_25%,transparent)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
      data-snap-menu
    >
      <SwitchRow
        strong
        label="Snapping"
        help="Snaps to the pieces: their ends, faces and guides. Grid, Angle and Scale factor have switches of their own. Hold Ctrl while dragging to snap to nothing, for that drag."
        checked={config.magnet}
        onChange={(magnet) => updateSnap({ magnet })}
      />
      <div className={BLOCK}>
        <StepRow
          label="Grid"
          help="World moves land on grid lines; local moves travel in grid increments. At 50 cm, a world position of 137 snaps to 150; a local move advances by 50."
          step={{
            label: "Grid step",
            value: config.gridSize,
            options: GRID_SIZES,
            format: (size) => formatGridSize(size, units),
            unit: "cm",
            onChange: pickGridSize
          }}
          enabled={grid.enabled}
          onEnabled={(enabled) => updateSnapTarget("grid", { enabled })}
        />
        <SwitchRow
          label="Snap size to grid"
          dimmed={!grid.enabled}
          help="Inspector and handles resize to multiples of the grid size along the piece's own axes. Requires Grid."
          checked={config.scaleToGrid}
          onChange={(scaleToGrid) => updateSnap({ scaleToGrid })}
        />
        <StepRow
          label="Angle"
          help="Turns go round in steps of this angle, and still stop where the piece meets another. Example: at 15°, a quarter turn is six steps."
          step={{
            label: "Angle step",
            value: config.rotationStep,
            options: ROTATION_STEPS,
            format: formatRotationStep,
            unit: "°",
            onChange: (rotationStep) => updateSnap({ rotationEnabled: true, rotationStep })
          }}
          enabled={config.rotationEnabled}
          onEnabled={(rotationEnabled) => updateSnap({ rotationEnabled })}
        />
        <StepRow
          label="Scale factor"
          help="Absolute scale multiples. Used when size snapping is off or dimensions are unknown. At 10%, scales land on 100%, 110%, 120%."
          step={{
            label: "Scale step",
            value: config.scaleStep,
            options: SCALE_STEPS,
            format: formatScaleStep,
            unit: "%",
            onChange: (scaleStep) => updateSnap({ scaleEnabled: true, scaleStep })
          }}
          enabled={config.scaleEnabled}
          onEnabled={(scaleEnabled) => updateSnap({ scaleEnabled })}
        />
      </div>
      <div className={BLOCK}>
        <div className="flex min-h-7 items-center">
          <SectionTitle>Snaps to</SectionTitle>
        </div>
        <SwitchRow
          {...TARGET_WORDS.connectors}
          dimmed={dimmed}
          checked={connectors.enabled}
          onChange={(enabled) => updateSnapTarget("connectors", { enabled })}
        />
        <SwitchRow
          {...TARGET_WORDS.mesh}
          dimmed={dimmed}
          checked={mesh.enabled}
          onChange={(enabled) => updateSnapTarget("mesh", { enabled })}
        />
        <SwitchRow
          label="Guides"
          help="Lines up with pieces nearby, and draws a guide while it does. Example: a kicker set level with a landing."
          dimmed={dimmed}
          checked={alignment.enabled && tracking.enabled}
          onChange={(on) => setSnapTargets(["alignment", "tracking"], on)}
        />
        {planes && (
          <SwitchRow
            {...TARGET_WORDS.construction}
            dimmed={dimmed}
            checked={construction.enabled}
            onChange={(enabled) => updateSnapTarget("construction", { enabled })}
          />
        )}
      </div>
      <div className={BLOCK}>
        <Row
          label="Prefer"
          help="Which wins when the grid and a piece are both near. Example: Pieces joins an end even on a grid line."
          dimmed={dimmed}
        >
          {preference === null && <span className="text-caption text-fg-tertiary">Custom</span>}
          <Segmented label="Prefer" value={preference} items={PREFERENCES} onChange={preferSnap} />
        </Row>
        <Row
          label="Snap distance"
          help="How close the pointer has to get, in pixels on screen, before something snaps."
        >
          <RowValue>{config.threshold} px</RowValue>
        </Row>
        <SliderField
          label="Snap distance"
          min={2}
          max={40}
          step={1}
          value={config.threshold}
          onChange={(threshold) => updateSnap({ threshold })}
        />
      </div>
      <Collapsible>
        <CollapsibleTrigger className="group/disclosure -mx-1 flex min-h-7 w-[calc(100%+0.5rem)] cursor-pointer items-center gap-1 rounded-control px-1 text-left focus-ring hover:bg-hover">
          <DisclosureChevron />
          <span className="text-body-strong">Advanced</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1">
          <SnapAdvanced />
        </CollapsibleContent>
      </Collapsible>
      <div className="flex flex-wrap justify-end gap-1 border-t pt-2">
        <Button variant="ghost" disabled={isDefault} onClick={resetSnapToDefaults}>Reset to defaults</Button>
        <Button
          variant="outline"
          disabled={isDefault}
          title="New maps start with these settings."
          onClick={() => void saveSnapDefaults()}
        >
          Save as defaults
        </Button>
      </div>
    </div>
  )
}

/**
 * Snapping as a whole, in the view bar between the gizmo's axes and the grid pill: the magnet turns it on and off
 * (`snapToggle`) and is pressed while it is on, and the chevron beside it opens the snap menu. Pointer-only, as the
 * view bar's controls are, so Space after a click still flies.
 */
export function SnapMagnet({ disabled }: { readonly disabled: boolean }) {
  const enabled = useEditor((s) => snapConfigOf(s).magnet)
  return (
    <>
      <ViewTip
        label={`Snapping: ${enabled ? "on" : "off"}`}
        action="snapToggle"
        render={
          <Toggle
            pressed={enabled}
            onPressedChange={toggleSnapping}
            disabled={disabled}
            aria-label="Snapping"
            className={cn(SEGMENT, "aria-pressed:bg-primary/12 aria-pressed:text-foreground")}
            {...noFocus}
          />
        }
      >
        <IconMagnet />
      </ViewTip>
      <Popover>
        <ViewTip
          label="Snap menu"
          render={
            <PopoverTrigger
              disabled={disabled}
              render={
                <button type="button" aria-label="Snap menu" className={cn(SEGMENT, "min-w-5 px-1")} {...noFocus} />
              }
            />
          }
        >
          <IconChevronDown className="size-3" />
        </ViewTip>
        <PopoverContent
          align="end"
          initialFocus={false}
          finalFocus={false}
          className="w-[22rem] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
        >
          <SnapMenuContent />
        </PopoverContent>
      </Popover>
    </>
  )
}
