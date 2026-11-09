import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useShallow } from "zustand/react/shallow"
import type { Vec3 } from "../domain/coords"
import { canSetItemPivots, soleGroupOf } from "../domain/groupSelection"
import type { Axis } from "../domain/groupTransform"
import { GROUP_PIVOT_FACES, type GroupNode, type GroupPivot } from "../domain/MapSidecar"
import { PIVOT_CHOICES, pivotBoundsOf } from "../domain/pivot"
import { snapsGrid } from "../domain/snapConfig"
import { pieceNameOf, treeKeys } from "../domain/structure"
import { vecSub } from "../domain/ueMath"
import { editSelectionAxis, moveSelectionBy, previewSelectionAxis, setSelectionPivot } from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import { pivotOf, shownPivotPoint, snapConfigOf, useEditor } from "../editor/store"
import { InfoHint } from "./InfoHint"
import { FIELD_LABEL, Section } from "./InspectorLayout"
import { NumberField } from "./NumberField"
import { RowClipboard } from "./RowClipboard"

/** A toggle that's on for only part of a mixed selection (`data-in-use`): a step lighter than its track, short of pressed. */
export const IN_USE_CLASSES = "data-[in-use]:bg-foreground/10 data-[in-use]:text-foreground"

const AXES: ReadonlyArray<Axis> = ["x", "y", "z"]

/**
 * Where the pivot is in the world, which is what the game's Location field shows: the Transform section's Location stays
 * the piece's origin, as the map stores it, so a scale moves that one and holds this one. A whole group has no origin,
 * so this is its one position. An edit moves the selection by what it takes to bring the pivot there, in one step like
 * a scrubbed Location.
 */
function PivotPosition({ point }: { readonly point: Vec3 }) {
  const units = useEditor((s) => s.settings.general.units)
  const snapping = useEditor(snapConfigOf)
  // Display units only; the map always stores centimetres.
  const perUnit = units === "m" ? 100 : 1
  const offset = (v: number, from: number) => ({ kind: "offset", by: (v - from) * perUnit }) as const
  return (
    <div className="flex @container flex-col gap-0.5">
      <div className="flex h-6 items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className={FIELD_LABEL} />}>
            Position <span className="text-caption text-fg-tertiary">{units}</span>
          </TooltipTrigger>
          <TooltipContent side="left">Where the pivot is: the gizmo's point, and the game's Location</TooltipContent>
        </Tooltip>
        {/* a pasted position moves the selection so the pivot lands there */}
        <RowClipboard
          clipKey="pivot"
          label="Position"
          value={point}
          onPaste={(v) => moveSelectionBy(vecSub(v, point))}
        />
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
              snap={snapsGrid(snapping) ? snapping.gridSize / perUnit : undefined}
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

/** A fixed pivot still has an editable world position, which moves the selection. */
function FixedPivotSection({ point, reason }: { readonly point: Vec3 | undefined; readonly reason: string }) {
  return (
    <Section id="pivot" title="Pivot" className="gap-1.5">
      <p className="text-body text-fg-tertiary">{reason}</p>
      {point !== undefined && <PivotPosition point={point} />}
    </Section>
  )
}

/** A group's pivot choices, in the order of a piece's: the centre of its items' box, a face of it, a member, a frozen point. */
const GROUP_CHOICES = ["Center", ...GROUP_PIVOT_FACES, "Item", "Point"] as const
type GroupChoice = (typeof GROUP_CHOICES)[number]

const groupChoiceOf = (pivot: GroupPivot | undefined): GroupChoice =>
  pivot === undefined ? "Center" : pivot.choice === "item" ? "Item" : pivot.choice === "point" ? "Point" : pivot.choice

/**
 * Where a whole group pivots (docs/design/pivot-modes-and-chains.md § Group pivot): the centre of the box around its
 * items, as Ctrl+G makes, a face of that box, one member's own pivot, or a point frozen where the pivot is now, which
 * is what the game's frame is and what the `.balledit` gets. A prefab instance pivots on its origin and gets no
 * choice; a chain pivots on its first link.
 */
function GroupPivotSection({ group }: { readonly group: GroupNode }) {
  const setGroupPivot = useEditor((s) => s.setGroupPivot)
  const freezeGroupPivot = useEditor((s) => s.freezeGroupPivot)
  const names = useEditor((s) => s.doc.structure.items)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const members = useEditor(useShallow((s) => treeKeys([group]).filter((key) => s.doc.ids.includes(key))))
  const memberLabels = useEditor(useShallow((s) =>
    Object.fromEntries(members.map((key) => {
      const item = s.doc.map.items[s.doc.ids.indexOf(key)]
      return [key, names.get(key)?.name ?? (item === undefined ? key : pieceNameOf(item, catalogIndex))]
    }))
  ))
  const point = useEditor(useShallow(shownPivotPoint))
  const choice = groupChoiceOf(group.pivot)
  const pick = (next: GroupChoice) => {
    if (next === "Center") setGroupPivot(group.id, undefined)
    else if (next === "Item") {
      setGroupPivot(group.id, {
        choice: "item",
        key: group.pivot?.choice === "item" ? group.pivot.key : members[0] ?? ""
      })
    } else if (next === "Point") freezeGroupPivot(group.id)
    else setGroupPivot(group.id, { choice: next })
  }
  if (group.prefab !== undefined || group.chain === true) {
    return (
      <FixedPivotSection
        point={point}
        reason={group.prefab !== undefined
          ? "An instance pivots on its definition's origin, so it stays a placement of its prefab."
          : "A chain pivots on its first link."}
      />
    )
  }
  return (
    <Section
      id="pivot"
      title="Pivot"
      actions={
        <InfoHint>
          Where the group turns and scales, and where the gizmo sits in the game. Point freezes it where it is now, so a
          turn no longer moves it.
        </InfoHint>
      }
      className="gap-1.5"
    >
      <ToggleGroup
        aria-label="Group pivot"
        value={[choice]}
        onValueChange={(value) => {
          const next = GROUP_CHOICES.find((c) => value.includes(c))
          if (next !== undefined && (next !== choice || next === "Point")) pick(next)
        }}
        className="grid w-full grid-cols-3"
      >
        {GROUP_CHOICES.map((c) => (
          <ToggleGroupItem key={c} value={c} className="min-w-0 px-1">
            {c === "Point" ? "Set here" : c}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {group.pivot?.choice === "item" && (
        <Select
          value={group.pivot.key}
          items={memberLabels}
          onValueChange={(key) => key !== null && setGroupPivot(group.id, { choice: "item", key })}
        >
          <SelectTrigger className="w-full" aria-label="Pivot item">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {members.map((key) => <SelectItem key={key} value={key}>{memberLabels[key]}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {group.pivot?.choice === "point" && (
        <p className="text-caption text-fg-tertiary">
          Frozen here. It moves with the group and stays put through turns.
        </p>
      )}
      {point !== undefined && <PivotPosition point={point} />}
    </Section>
  )
}

/**
 * The selection's pivot: the game's choices as one segmented control, four to a row, and where
 * it is once it's off the origin. A click sets the choice on every selected item. When their
 * pivots differ, nothing is pressed and the choices in use are tinted. Choices other than
 * Default need the piece's bounds, so they're off for pieces without them. A whole group has
 * choices of its own (`GroupPivotSection`).
 */
export function PivotSection() {
  const choices = useEditor(useShallow((s) => s.selectedIds.map((id) => pivotOf(s, id).choice)))
  const allBounded = useEditor((s) =>
    s.selectedIds.every((id) => {
      const item = s.doc.map.items[s.doc.ids.indexOf(id)]
      return item !== undefined && pivotBoundsOf(item, s.catalogIndex) !== undefined
    })
  )
  const group = useEditor((s) => soleGroupOf(s.doc.structure.tree, s.selectedIds, s.enteredGroupId))
  const point = useEditor(useShallow(shownPivotPoint))
  const canSet = useEditor((s) => canSetItemPivots(s.doc.structure.tree, s.selectedIds, s.enteredGroupId))
  const used = new Set(choices)
  const mixed = used.size > 1
  if (group !== undefined) return <GroupPivotSection group={group} />
  if (!canSet) {
    return (
      <FixedPivotSection
        point={point}
        reason="Enter a group to change its members' pivot presets. Position moves the selection's gizmo pivot."
      />
    )
  }

  return (
    <Section
      id="pivot"
      title="Pivot"
      actions={mixed || !allBounded
        ? (
          <>
            {mixed && <span className="text-caption text-fg-tertiary">Mixed</span>}
            {!allBounded && <InfoHint>This piece's bounds are unknown, so only Default is available.</InfoHint>}
          </>
        )
        : undefined}
      className="gap-1.5"
    >
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
            disabled={choice !== "Default" && !allBounded}
            data-in-use={mixed && used.has(choice) ? "" : undefined}
            className={cn("min-w-0 px-1", IN_USE_CLASSES)}
          >
            {choice}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {point !== undefined && <PivotPosition point={point} />}
    </Section>
  )
}
