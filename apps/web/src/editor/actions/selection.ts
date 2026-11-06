/** Selection edits: each is one undo step, however many items it touches. */
import type { UeTransform, Vec3 } from "../../domain/coords"
import { editTransform } from "../../domain/editTransform"
import { selectableKeys, soleGroupOf } from "../../domain/groupSelection"
import {
  applyGroupDelta,
  type Axis,
  type AxisEdit,
  clampScale,
  type GroupDelta,
  readField,
  scaleAbout,
  selectionAxisEdit,
  type TransformField,
  writeField,
  writeFieldAbout
} from "../../domain/groupTransform"
import type { PropertyChange } from "../../domain/itemProperties"
import type { FlipAxis } from "../../domain/mirror"
import { type PivotChoice, pivotFor } from "../../domain/pivot"
import { quatConjugate, quatMul, quatNormalize, vecSub } from "../../domain/ueMath"
import { applyUnitEdit, pivotUnitOf, type Unit, type UnitEdit } from "../../domain/units"
import {
  editedKeys,
  fitTransforms,
  pivotOf,
  selectionPivot,
  type SlotPaint,
  type TransformOptions,
  useEditor
} from "../store"

export const transformSelection = (transforms: ReadonlyMap<string, UeTransform>, options?: TransformOptions): boolean =>
  useEditor.getState().transformItems(transforms, options)

/** Sets material slots (one undo step); see `EditorState.paintSlots`. */
export const paintSlots = (edits: ReadonlyArray<SlotPaint>): boolean => useEditor.getState().paintSlots(edits)

/** Sets item properties on every selected item. */
export const setSelectionProperties = (changes: ReadonlyArray<PropertyChange>): boolean =>
  useEditor.getState().setSelectionProperties(changes)

/** Flips the selected items on one axis (one undo step); see `EditorState.flipSelection`. */
export const flipSelection = (axis: FlipAxis) => useEditor.getState().flipSelection(axis)

export const deleteSelection = () => useEditor.getState().deleteSelection()

export const duplicateSelection = () => useEditor.getState().duplicateSelection()

/** Selects every item a click could reach from here: the map's, or the entered group's. */
export const selectAll = () => {
  const { doc, enteredGroupId, select } = useEditor.getState()
  select(selectableKeys(doc.structure.tree, enteredGroupId))
}

/** An item's edit transform in the document: never the live preview. */
const docTransform = (id: string): UeTransform | undefined => {
  const { doc } = useEditor.getState()
  const item = doc.map.items[doc.ids.indexOf(id)]
  return item === undefined ? undefined : editTransform(item)
}

/** An item's own pivot, local and unscaled. */
const localPivotOf = (id: string): Vec3 => pivotOf(useEditor.getState(), id).localPosition

/** The selected items' document transforms, each put through `edit` (with the item's own pivot). */
const withSelectionEdit = (
  edit: (t: UeTransform, localPivot: Vec3) => UeTransform
): ReadonlyMap<string, UeTransform> =>
  fitTransforms(
    useEditor.getState(),
    new Map(
      useEditor.getState().selectedIds.flatMap((id) => {
        const t = docTransform(id)
        return t === undefined ? [] : [[id, edit(t, localPivotOf(id))] as const]
      })
    )
  )

/**
 * The document transforms through an edit of the selection's units, applied by the pivot setting like a gizmo drag:
 * Together takes every item through the active unit's edit about its pivot; Each takes each unit through its own.
 * `edit` gets the active unit (the active item, or a whole group's frame) to measure the change on.
 */
const withUnitEdit = (edit: (active: Unit) => UnitEdit): ReadonlyMap<string, UeTransform> => {
  const s = useEditor.getState()
  const target = selectionPivot(s, docTransform)
  if (target === undefined) return new Map()
  // inside an entered chain the links after a selected one come along
  const transforms = new Map(
    editedKeys(s).flatMap((id) => {
      const t = docTransform(id)
      return t === undefined ? [] : [[id, t] as const]
    })
  )
  const active = pivotUnitOf(target.selection, s.pivotMode)
  return fitTransforms(s, applyUnitEdit(target.selection, s.pivotMode, transforms, edit(active)))
}

/** An axis edit: the change it makes to the active unit's axis, which every unit then takes about its own pivot. */
const withAxisEdit = (field: TransformField, axis: Axis, edit: AxisEdit) =>
  withUnitEdit((active) => {
    const from = readField(active.transform, field)[axis]
    const to = edit.kind === "set" ? edit.value : from + edit.by
    // a scale is a ratio of the active unit's value, which every unit takes; a move or turn is the same change
    const forUnit = (unit: Unit): AxisEdit =>
      field === "scale3D" && from !== 0
        ? { kind: "set", value: readField(unit.transform, field)[axis] * to / from }
        : { kind: "offset", by: to - from }
    return (unit) => selectionAxisEdit(unit.transform, field, axis, forUnit(unit), unit.pivot)
  })

/**
 * Takes the active unit's `field` to `value` on all three axes at once, every unit following by the same change
 * about its own pivot (pasting a row onto a group): a move by the difference, the turn from the unit's rotation to
 * the value's, or each axis scaled by its ratio.
 */
export const setSelectionUnitField = (field: TransformField, value: Vec3): boolean =>
  transformSelection(withUnitEdit((active) => {
    switch (field) {
      case "translation": {
        const delta: GroupDelta = { kind: "translate", offset: vecSub(value, active.transform.translation) }
        return (unit) => (t) => applyGroupDelta(t, unit.pivot, delta)
      }
      case "rotation": {
        const to = writeField(active.transform, "rotation", value).rotation
        const delta: GroupDelta = {
          kind: "rotate",
          rotation: quatNormalize(quatMul(to, quatConjugate(active.transform.rotation)))
        }
        return (unit) => (t) => applyGroupDelta(t, unit.pivot, delta)
      }
      case "scale3D": {
        const from = active.transform.scale3D
        const ratio = (axis: Axis) => (from[axis] === 0 ? 1 : value[axis] / from[axis])
        return (unit) => (t) =>
          scaleAbout(t, {
            x: clampScale(t.scale3D.x * ratio("x")),
            y: clampScale(t.scale3D.y * ratio("y")),
            z: clampScale(t.scale3D.z * ratio("z"))
          }, unit.pivot)
      }
    }
  }))

/** Moves the selection by `offset` in the world (pasting a pivot's Position): one undo step. */
export const moveSelectionBy = (offset: Vec3): boolean => {
  const delta: GroupDelta = { kind: "translate", offset }
  return transformSelection(withUnitEdit(() => (unit) => (t) => applyGroupDelta(t, unit.pivot, delta)))
}

/**
 * Sets all three axes of `field` on every selected item (pasting a copied row), about each one's pivot: the one edit
 * that sets items to a value rather than changing them together.
 */
export const setSelectionField = (field: TransformField, value: Vec3): boolean =>
  transformSelection(withSelectionEdit((t, localPivot) => writeFieldAbout(t, field, value, localPivot)))

/** Applies an axis edit (an inspector field) to the selection. */
export const editSelectionAxis = (field: TransformField, axis: Axis, edit: AxisEdit): boolean =>
  transformSelection(withAxisEdit(field, axis, edit))

/**
 * Shows an axis edit live (a scrub) without committing it; null ends the preview. The edit is
 * the whole scrub so far, from the document, not a step on top of the last preview.
 */
export const previewSelectionAxis = (field: TransformField, axis: Axis, edit: AxisEdit | null): void =>
  useEditor.getState().setPreview(edit === null ? null : withAxisEdit(field, axis, edit))

/**
 * Sets the pivot `choice` on every selected item, measured on each one's own bounds (one
 * undo step). Items whose bounds are unknown keep their pivot. A whole group has a pivot of
 * its own (`setGroupPivot`), so its items keep theirs.
 */
export const setSelectionPivot = (choice: PivotChoice): void => {
  const { doc, selectedIds, enteredGroupId, catalogIndex, setItemPivots } = useEditor.getState()
  if (soleGroupOf(doc.structure.tree, selectedIds, enteredGroupId) !== undefined) return
  setItemPivots(
    new Map(selectedIds.flatMap((id) => {
      const item = doc.map.items[doc.ids.indexOf(id)]
      const pivot = item === undefined ? undefined : pivotFor(item, catalogIndex, choice)
      return pivot === undefined ? [] : [[id, pivot] as const]
    }))
  )
}
