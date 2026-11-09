import {
  IconArrowRight,
  IconCircleDot,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconSpacingHorizontal,
  IconSpacingVertical
} from "@tabler/icons-react"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { memo, type ReactElement, useEffect, useMemo } from "react"
import type { Vec3 } from "../domain/coords"
import type { KeybindAction } from "../domain/Keybinds"
import type { ArrangeOp, BoxAxis, BoxSide, Distribution } from "../domain/snapTools"
import { vecDot } from "../domain/ueMath"
import {
  type ArrangePlan,
  arrangePlanOf,
  arrangeSelection,
  screenAlignNow,
  type ScreenDirection,
  setArrangeHover,
  setArrangeSpacing
} from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import type { PaneCamera } from "../editor/paneCameras"
import { useEditor } from "../editor/store"
import { usePaneReading } from "../editor/usePaneReading"
import { FIELD_LABEL, FieldRow, Section } from "./InspectorLayout"
import { KeyChip } from "./KeyChip"
import { NumberField } from "./NumberField"

/**
 * Align and Distribute in the Inspector (docs/SNAPPING.md § Align and distribute): a row per axis, Min, Centre and Max
 * lining the selection up on the active item, then Gaps and Centres spreading it. Pointing at a button previews it in
 * the panes; the button does it. The axes are the world's, or the active item's with the gizmo in Local.
 */

const AXES: ReadonlyArray<BoxAxis> = ["x", "y", "z"]
const SIDES: ReadonlyArray<BoxSide> = ["min", "centre", "max"]
const DISTRIBUTIONS: ReadonlyArray<Distribution> = ["gaps", "centres"]

const SCREEN_KEYS: ReadonlyArray<readonly [ScreenDirection, KeybindAction]> = [
  ["left", "alignLeft"],
  ["right", "alignRight"],
  ["up", "alignUp"],
  ["down", "alignDown"]
]

const keyOf = (op: ArrangeOp) => op.kind === "align" ? `align-${op.axis}-${op.side}` : `distribute-${op.axis}-${op.by}`

const opsOf = (axis: BoxAxis): ReadonlyArray<ArrangeOp> => [
  ...SIDES.map((side): ArrangeOp => ({ kind: "align", axis, side, to: "active" })),
  ...DISTRIBUTIONS.map((by): ArrangeOp => ({ kind: "distribute", axis, by }))
]

/** What a button does, in words: its title, and what it would do to this selection. */
const describe = (op: ArrangeOp, plan: ArrangePlan | undefined, fixed: boolean): {
  readonly title: string
  readonly detail: string
} => {
  const axis = op.axis.toUpperCase()
  const title = op.kind === "align"
    ? op.side === "centre" ? `Align centres on ${axis}` : `Align ${op.side === "min" ? "−" : "+"}${axis} sides`
    : `Distribute on ${axis}, equal ${op.by === "gaps" ? "gaps" : "centre steps"}`
  const moving = plan?.moving ?? 0
  const count = `${moving} item${moving === 1 ? "" : "s"}`
  if (op.kind === "align") {
    return {
      title,
      detail: moving === 0 ? `Already level with the active item on ${axis}.` : `To the active item. Moves ${count}.`
    }
  }
  if (plan === undefined) return { title, detail: "Select two or more items." }
  if (!fixed && plan.boxes.length < 3) return { title, detail: "Takes three or more, or a fixed Spacing." }
  return {
    title,
    detail: moving === 0
      ? `Already evenly spread on ${axis}.`
      : `${fixed ? "Out from the active item" : "The two ends stay"}. Moves ${count}.`
  }
}

/** Each button's icon: Tabler's, in the text colour (docs/design/ui-system.md § Icons). Z runs up the screen. */
const ALIGN_ICONS: Readonly<Record<"across" | "up", Readonly<Record<BoxSide, ReactElement>>>> = {
  across: { min: <IconLayoutAlignLeft />, centre: <IconLayoutAlignCenter />, max: <IconLayoutAlignRight /> },
  up: { min: <IconLayoutAlignBottom />, centre: <IconLayoutAlignMiddle />, max: <IconLayoutAlignTop /> }
}

const DISTRIBUTE_ICONS: Readonly<Record<"across" | "up", Readonly<Record<Distribution, ReactElement>>>> = {
  across: { gaps: <IconSpacingHorizontal />, centres: <IconLayoutDistributeVertical /> },
  up: { gaps: <IconSpacingVertical />, centres: <IconLayoutDistributeHorizontal /> }
}

const iconOf = (op: ArrangeOp): ReactElement => {
  const way = op.axis === "z" ? "up" : "across"
  return op.kind === "align" ? ALIGN_ICONS[way][op.side] : DISTRIBUTE_ICONS[way][op.by]
}

/** The keys that run `op` from this pane's view: the screen directions whose Align it is. */
function ScreenKeys({ op }: { readonly op: ArrangeOp }) {
  const keybinds = useEditor((s) => s.keybinds)
  if (op.kind !== "align") return null
  const bindings = SCREEN_KEYS.flatMap(([direction, action]) => {
    const that = screenAlignNow(direction)
    return that.kind === "align" && that.axis === op.axis && that.side === op.side ? keybinds[action] : []
  })
  return bindings.map((binding) => <KeyChip key={binding} binding={binding} />)
}

/** A segmented control's item, as `ToggleGroupItem` draws one, for buttons that run rather than toggle. */
const BUTTON =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)-2px)] text-fg-secondary transition-colors focus-ring hover:bg-hover hover:text-foreground active:bg-pressed disabled:pointer-events-none disabled:text-fg-disabled [&_svg]:size-4"

/** A segmented control's track. */
const TRACK = "flex w-fit items-center gap-0.5 rounded-control bg-muted p-0.5"

function ArrangeButton({ op, plan, fixed }: {
  readonly op: ArrangeOp
  readonly plan: ArrangePlan | undefined
  readonly fixed: boolean
}) {
  const { detail, title } = describe(op, plan, fixed)
  const off = plan === undefined || plan.moving === 0
  const show = () => setArrangeHover(op)
  const hide = () => setArrangeHover(null)
  return (
    <Tooltip>
      {/* The trigger is out here because a disabled button takes no pointer events. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <button
          type="button"
          aria-label={title}
          disabled={off}
          className={BUTTON}
          onPointerEnter={show}
          onPointerLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={() => arrangeSelection(op)}
        >
          {iconOf(op)}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 flex-col items-start gap-0.5">
        <span className="flex items-center gap-1 text-body-strong">
          {title}
          <ScreenKeys op={op} />
        </span>
        <span className="text-fg-tertiary">{detail}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/** Where an axis points on the active pane's screen, to the nearest 15°; null when it points at or away from the eye. */
type ScreenAngle = number | null

const STEP = Math.PI / 12
/** Shorter than this on screen, an axis is taken to point along the view. */
const ALONG_VIEW = 0.2

const screenAnglesOf = (pane: PaneCamera, directions: ReadonlyArray<Vec3>): ReadonlyArray<ScreenAngle> => {
  const { right, up } = pane.screenAxes()
  return directions.map((direction) => {
    const x = vecDot(direction, right)
    const y = vecDot(direction, up)
    return Math.hypot(x, y) < ALONG_VIEW ? null : Math.round(Math.atan2(-y, x) / STEP) * STEP
  })
}

const sameAngles = (a: ReadonlyArray<ScreenAngle>, b: ReadonlyArray<ScreenAngle>) =>
  a.length === b.length && a.every((angle, i) => angle === b[i])

/** The way an axis's positive end points on screen, so the row says which side its Min and Max are. */
function ScreenArrow({ angle }: { readonly angle: ScreenAngle }) {
  if (angle === null) return <IconCircleDot aria-hidden className="size-3.5 text-fg-tertiary" />
  return (
    <IconArrowRight
      aria-hidden
      className="size-3.5 text-fg-tertiary"
      style={{ transform: `rotate(${(angle * 180) / Math.PI}deg)` }}
    />
  )
}

function SpacingRow() {
  const spacing = useEditor((s) => s.arrangeSpacing)
  const units = useEditor((s) => s.settings.general.units)
  const perUnit = units === "m" ? 100 : 1
  return (
    <FieldRow
      label="Spacing"
      hint="Auto keeps the two ends where they are and evens out what's between. Fixed sets every gap, or every step between centres, counted out from the active item; 0 stacks them."
    >
      <ToggleGroup
        aria-label="Spacing"
        value={[spacing === null ? "auto" : "fixed"]}
        onValueChange={(value) => {
          if (value.includes("auto")) setArrangeSpacing(null)
          else if (value.includes("fixed")) setArrangeSpacing(spacing ?? 0)
        }}
      >
        <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
        <ToggleGroupItem value="fixed">Fixed</ToggleGroupItem>
      </ToggleGroup>
      {spacing !== null && (
        <NumberField
          label="Spacing"
          value={spacing / perUnit}
          onCommit={(v) => setArrangeSpacing(v * perUnit)}
          step={units === "m" ? 0.01 : 1}
          digits={units === "m" ? 2 : 0}
          handle={false}
          unit={units}
        />
      )}
    </FieldRow>
  )
}

/** The section, with two or more units selected; nothing otherwise. */
export const AlignSection = memo(function AlignSection() {
  const doc = useEditor((s) => s.doc)
  const selectedIds = useEditor((s) => s.selectedIds)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const space = useEditor((s) => s.gizmoSpace)
  const spacing = useEditor((s) => s.arrangeSpacing)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const activePane = useEditor((s) => s.activePane)
  const plans = useMemo(() => {
    const s = useEditor.getState()
    return new Map(AXES.flatMap(opsOf).map((op) => [keyOf(op), arrangePlanOf(s, op)] as const))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the store values the plans are built from, read inside
  }, [doc, selectedIds, enteredGroupId, space, spacing, catalogIndex])
  const directions = useMemo(
    () =>
      AXES.map((axis) => plans.get(keyOf({ kind: "distribute", axis, by: "gaps" }))?.direction ?? { x: 0, y: 0, z: 0 }),
    [plans]
  )
  const angles = usePaneReading(activePane, (pane) => screenAnglesOf(pane, directions), sameAngles)
  // the preview goes with the section: a button that unmounts under the pointer never says it was left
  useEffect(() => () => setArrangeHover(null), [])

  const [any] = plans.values()
  if (any === undefined) return null
  const fixed = spacing !== null
  return (
    <Section
      id="align"
      title="Align"
      actions={<span>{space === "local" ? "to the active item, its axes" : "to the active item"}</span>}
    >
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <span />
        <span className={FIELD_LABEL}>Align</span>
        <span />
        <span className={FIELD_LABEL}>Distribute</span>
        {AXES.map((axis, i) => (
          <div key={axis} className="contents">
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  "flex h-6 w-4 items-center justify-center rounded-[calc(var(--radius-control)-2px)] text-caption text-black uppercase select-none",
                  AXIS_BG_CLASSES[axis]
                )}
              >
                {axis}
              </span>
              <ScreenArrow angle={angles[i] ?? null} />
            </span>
            <div className={TRACK}>
              {SIDES.map((side) => {
                const op: ArrangeOp = { kind: "align", axis, side, to: "active" }
                return <ArrangeButton key={side} op={op} plan={plans.get(keyOf(op))} fixed={fixed} />
              })}
            </div>
            <span />
            <div className={TRACK}>
              {DISTRIBUTIONS.map((by) => {
                const op: ArrangeOp = { kind: "distribute", axis, by }
                return <ArrangeButton key={by} op={op} plan={plans.get(keyOf(op))} fixed={fixed} />
              })}
            </div>
          </div>
        ))}
      </div>
      <SpacingRow />
    </Section>
  )
})
