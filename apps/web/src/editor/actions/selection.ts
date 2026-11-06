/** Selection edits: each is one undo step, however many items it touches. */
import type { UeTransform, Vec3 } from "../../domain/coords"
import { editTransform } from "../../domain/editTransform"
import { selectableKeys } from "../../domain/groupSelection"
import {
  type Axis,
  type AxisEdit,
  selectionAxisEdit,
  type TransformField,
  writeFieldAbout
} from "../../domain/groupTransform"
import type { PropertyChange } from "../../domain/itemProperties"
import type { FlipAxis } from "../../domain/mirror"
import { localToWorld, type PivotChoice, pivotFor } from "../../domain/pivot"
import { fitTransforms, pivotOf, type SlotPaint, useEditor } from "../store"

export const transformSelection = (transforms: ReadonlyMap<string, UeTransform>): boolean =>
  useEditor.getState().transformItems(transforms)

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

/** An axis edit made from the document transforms, about the active item's pivot like the gizmo. */
const withAxisEdit = (field: TransformField, axis: Axis, edit: AxisEdit) => {
  // the active item is the last selected one
  const activeId = useEditor.getState().selectedIds.findLast((id) => docTransform(id) !== undefined)
  const active = activeId === undefined ? undefined : docTransform(activeId)
  if (activeId === undefined || active === undefined) return new Map()
  const pivot = localToWorld(active, localPivotOf(activeId))
  return withSelectionEdit(selectionAxisEdit(active, field, axis, edit, pivot))
}

/** Sets all three axes of `field` on every selected item (pasting a copied row), about each one's pivot. */
export const setSelectionField = (field: TransformField, value: Vec3): boolean =>
  transformSelection(withSelectionEdit((t, localPivot) => writeFieldAbout(t, field, value, localPivot)))

/** Applies an axis edit (an inspector field) to every selected item. */
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
 * undo step). Items whose bounds are unknown keep their pivot.
 */
export const setSelectionPivot = (choice: PivotChoice): void => {
  const { doc, selectedIds, catalogIndex, setItemPivots } = useEditor.getState()
  setItemPivots(
    new Map(selectedIds.flatMap((id) => {
      const item = doc.map.items[doc.ids.indexOf(id)]
      const pivot = item === undefined ? undefined : pivotFor(item, catalogIndex, choice)
      return pivot === undefined ? [] : [[id, pivot] as const]
    }))
  )
}
