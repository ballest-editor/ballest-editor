/** Selection edits: each is one undo step, however many items it touches. */
import type { UeTransform, Vec3 } from "../../domain/coords"
import { editTransform } from "../../domain/editTransform"
import { editThings, type FieldView } from "../../domain/fieldEdit"
import { canSetItemPivots, soleGroupOf } from "../../domain/groupSelection"
import type { Axis } from "../../domain/groupTransform"
import type { PropertyChange } from "../../domain/itemProperties"
import type { FlipAxis } from "../../domain/mirror"
import { type NumberEntry, offsetEntry, setEntry } from "../../domain/numberEntry"
import { type PivotChoice, pivotFor } from "../../domain/pivot"
import type { RepeatOptions } from "../../domain/repeat"
import { indexOfKey } from "../../domain/structure"
import { pickableSelection } from "../../domain/visibility"
import {
  fitTransforms,
  lockRefusalOf,
  pickableOf,
  selectionThings,
  type SlotPaint,
  type TransformOptions,
  useEditor
} from "../store"
import { flipGroupLayout } from "./snapTools"

export const transformSelection = (transforms: ReadonlyMap<string, UeTransform>, options?: TransformOptions): boolean =>
  useEditor.getState().transformItems(transforms, options)

/** Sets material slots (one undo step); see `EditorState.paintSlots`. */
export const paintSlots = (edits: ReadonlyArray<SlotPaint>): boolean => useEditor.getState().paintSlots(edits)

/** Sets item properties on every selected item. */
export const setSelectionProperties = (changes: ReadonlyArray<PropertyChange>): boolean =>
  useEditor.getState().setSelectionProperties(changes)

/**
 * Flips the selection on one axis, as one undo step: a whole group mirrors its layout about its pivot
 * (`flipGroupLayout`), and loose items each flip where they stand (`EditorState.flipSelection`).
 */
export const flipSelection = (axis: FlipAxis) => {
  const s = useEditor.getState()
  if (soleGroupOf(s.doc.structure.tree, s.selectedIds, s.enteredGroupId) !== undefined) flipGroupLayout(axis)
  else s.flipSelection(axis)
}

export const deleteSelection = () => useEditor.getState().deleteSelection()

export const repeatSelection = (options: RepeatOptions) => useEditor.getState().repeatSelection(options)

export const duplicateSelection = () => useEditor.getState().duplicateSelection()

/** Selects everything a click could reach from here, the map's or the entered group's, but what is hidden or locked. */
export const selectAll = () => {
  const s = useEditor.getState()
  s.select(pickableSelection(s.doc.structure.tree, s.enteredGroupId, pickableOf(s)))
}

/**
 * The Outline's "Select all in group": enters group `id` and selects its children, one level down, each one a click
 * could pick whole, as Select all does inside it.
 */
export const selectAllInGroup = (id: string) => {
  const s = useEditor.getState()
  s.enterGroup(id)
  s.select(pickableSelection(s.doc.structure.tree, id, pickableOf(s)))
}

/** An item's edit transform in the document: never the live preview. */
const docTransform = (id: string): UeTransform | undefined => {
  const { doc } = useEditor.getState()
  const item = doc.map.items[indexOfKey(doc.ids, id)]
  return item === undefined ? undefined : editTransform(item)
}

/**
 * The items' transforms once `entries` are worked out for every selected thing in the row `view` (`editThings`), from
 * the document, never a live preview, so a scrub's steps don't compound.
 */
const withFieldEdit = (
  view: FieldView,
  entries: Partial<Readonly<Record<Axis, NumberEntry>>>
): ReadonlyMap<string, UeTransform> => {
  const s = useEditor.getState()
  const things = selectionThings(s, docTransform) ?? []
  const transforms = new Map(things.flatMap(({ unit }) =>
    unit.keys.flatMap((key) => {
      const t = docTransform(key)
      return t === undefined ? [] : [[key, t] as const]
    })
  ))
  return fitTransforms(s, editThings(things, view, entries, transforms))
}

/**
 * Entries for any of the row `view`'s axes, worked out for every selected thing from its own value and taken to each
 * whole: one undo step.
 */
export const editSelectionFields = (view: FieldView, entries: Partial<Readonly<Record<Axis, NumberEntry>>>): boolean =>
  transformSelection(withFieldEdit(view, entries))

/** An entry typed into one field of the row `view` (`editSelectionFields`). */
export const editSelectionField = (view: FieldView, axis: Axis, entry: NumberEntry): boolean =>
  editSelectionFields(view, { [axis]: entry })

/**
 * Shows an entry live (a scrub) without committing it; null ends the preview. The entry is the whole scrub so far, from
 * the document, not a step on top of the last preview.
 */
export const previewSelectionField = (view: FieldView, axis: Axis, entry: NumberEntry | null): void => {
  const s = useEditor.getState()
  // a scrub that would move a locked piece shows nothing; letting go says why
  const locked = lockRefusalOf(s, s.selectedIds) !== undefined
  s.setPreview(entry === null || locked ? null : withFieldEdit(view, { [axis]: entry }))
}

/**
 * A field's scrub over the selection, as `NumberField` takes it: every thing changed by the same amount, live as it
 * goes, then one undo step.
 */
export const scrubSelectionField = (view: FieldView, axis: Axis) => ({
  onScrub: (value: number | null, from: number) =>
    previewSelectionField(view, axis, value === null ? null : offsetEntry(value - from)),
  onScrubCommit: (value: number, from: number) => editSelectionField(view, axis, offsetEntry(value - from))
})

/**
 * A copied row pasted onto the row `view`, in stored units (cm, degrees, factor): the same as typing its three values,
 * so every thing takes them, one undo step.
 */
export const pasteSelectionField = (view: FieldView, stored: Vec3): boolean =>
  editSelectionFields(view, {
    x: setEntry(stored.x / view.perUnit),
    y: setEntry(stored.y / view.perUnit),
    z: setEntry(stored.z / view.perUnit)
  })

/**
 * Sets the pivot `choice` on every selected item, measured on each one's own bounds (one
 * undo step). Items whose bounds are unknown keep their pivot. A whole group has a pivot of
 * its own (`setGroupPivot`), so its items keep theirs, and so do a group's among pieces until it is entered.
 */
export const setSelectionPivot = (choice: PivotChoice): void => {
  const { doc, selectedIds, enteredGroupId, catalogIndex, setItemPivots } = useEditor.getState()
  if (!canSetItemPivots(doc.structure.tree, selectedIds, enteredGroupId)) return
  setItemPivots(
    new Map(selectedIds.flatMap((id) => {
      const item = doc.map.items[indexOfKey(doc.ids, id)]
      const pivot = item === undefined ? undefined : pivotFor(item, catalogIndex, choice)
      return pivot === undefined ? [] : [[id, pivot] as const]
    }))
  )
}
