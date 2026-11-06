import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useShallow } from "zustand/react/shallow"
import type { Vec3 } from "../domain/coords"
import { soleGroupOf } from "../domain/groupSelection"
import type { Axis } from "../domain/groupTransform"
import { PIVOT_CHOICES, pivotBoundsOf } from "../domain/pivot"
import { editSelectionAxis, previewSelectionAxis, setSelectionPivot } from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import { pivotOf, shownPivotPoint, useEditor } from "../editor/store"
import { InfoHint } from "./InfoHint"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"

/** A toggle that's on for only part of a mixed selection (`data-in-use`): a step lighter than its track, short of pressed. */
export const IN_USE_CLASSES = "data-[in-use]:bg-foreground/10 data-[in-use]:text-foreground"

const AXES: ReadonlyArray<Axis> = ["x", "y", "z"]

/**
 * Where the pivot is in the world, which is what the game's Location field shows: the Transform section's Location stays
 * the piece's origin, as the map stores it, so a scale moves that one and holds this one. An edit moves the selection by
 * what it takes to bring the pivot there, in one step like a scrubbed Location.
 */
function PivotPosition({ point }: { readonly point: Vec3 }) {
  const units = useEditor((s) => s.settings.general.units)
  const snapping = useEditor((s) => s.settings.snapping)
  // Display units only; the map always stores centimetres.
  const perUnit = units === "m" ? 100 : 1
  const offset = (v: number, from: number) => ({ kind: "offset", by: (v - from) * perUnit }) as const
  return (
    <div className="flex @container flex-col gap-0.5">
      <div className="flex h-5 items-center">
        <Tooltip>
          <TooltipTrigger render={<span className="text-body text-fg-secondary" />}>
            Position <span className="text-caption text-fg-tertiary">{units}</span>
          </TooltipTrigger>
          <TooltipContent side="left">Where the pivot is: the gizmo's point, and the game's Location</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-3 gap-1 @max-[16rem]:grid-cols-1">
        {AXES.map((axis) => {
          const value = point[axis] / perUnit
          return (
            <NumberField
              key={axis}
              label={`Pivot ${axis.toUpperCase()}`}
              value={value}
              onCommit={(v) => editSelectionAxis("translation", axis, offset(v, value))}
              onScrub={(v, from) => previewSelectionAxis("translation", axis, v === null ? null : offset(v, from))}
              onScrubCommit={(v, from) => editSelectionAxis("translation", axis, offset(v, from))}
              step={units === "m" ? 0.01 : 1}
              snap={snapping.enabled ? snapping.gridSize / perUnit : undefined}
              digits={units === "m" ? 3 : 1}
              handleClassName={AXIS_BG_CLASSES[axis]}
              handleText={axis.toUpperCase()}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * The selection's pivot: the game's choices as one segmented control, four to a row, and where
 * it is once it's off the origin. A click sets the choice on every selected item. When their
 * pivots differ, nothing is pressed and the choices in use are tinted. Choices other than
 * Default need the piece's bounds, so they're off for pieces without them. A whole group takes
 * no pivot.
 */
export function PivotSection() {
  const choices = useEditor(useShallow((s) => s.selectedIds.map((id) => pivotOf(s, id).choice)))
  const allBounded = useEditor((s) =>
    s.selectedIds.every((id) => {
      const item = s.doc.map.items[s.doc.ids.indexOf(id)]
      return item !== undefined && pivotBoundsOf(item, s.catalogIndex) !== undefined
    })
  )
  const isGroup = useEditor((s) => soleGroupOf(s.doc.structure.tree, s.selectedIds, s.enteredGroupId) !== undefined)
  const point = useEditor(useShallow(shownPivotPoint))
  const used = new Set(choices)
  const mixed = used.size > 1
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Pivot</SectionTitle>
        {mixed && <div className="text-caption text-fg-tertiary">Mixed</div>}
        {isGroup
          ? (
            <InfoHint>
              A group turns and scales about its own frame. Select one ungrouped item to set its pivot.
            </InfoHint>
          )
          : !allBounded && <InfoHint>This piece's bounds are unknown, so only Default is available.</InfoHint>}
      </div>
      <ToggleGroup
        aria-label="Pivot"
        value={mixed ? [] : choices.slice(0, 1)}
        onValueChange={(value) => {
          const next = PIVOT_CHOICES.find((c) => value.includes(c))
          if (next !== undefined) setSelectionPivot(next) // clicking the pressed choice keeps it
        }}
        className="grid w-full grid-cols-4"
      >
        {PIVOT_CHOICES.map((choice) => (
          <ToggleGroupItem
            key={choice}
            value={choice}
            disabled={isGroup || (choice !== "Default" && !allBounded)}
            data-in-use={mixed && used.has(choice) ? "" : undefined}
            className={cn("min-w-0 px-1", IN_USE_CLASSES)}
          >
            {choice}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {point !== undefined && <PivotPosition point={point} />}
    </div>
  )
}
