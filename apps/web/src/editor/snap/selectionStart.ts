/** What a drag of the selection starts from, for snapping: what it acts on, and what leads it. */
import { endsOf, type WorldEnd } from "../../domain/connectors"
import type { UeTransform, Vec3 } from "../../domain/coords"
import { type Box, placedBoxOf } from "../../domain/itemBounds"
import { findGroup } from "../../domain/structure"
import type { Unit } from "../../domain/units"
import { sceneRegistry } from "../sceneRegistry"
import {
  editedKeys,
  type EditorState,
  pivotOf,
  type SelectionPivot,
  selectionPivot,
  shownTransform,
  snapConfigOf
} from "../store"
import { faceNormalOf } from "./turnScale"

export interface SelectionSnapStart {
  readonly box: Box
  readonly ends: ReadonlyArray<WorldEnd>
}

/** What a drag acts on: every item it reaches that is in the scene, as they show now, at the selection's pivot. */
export interface DragTarget extends SelectionPivot {
  /** Their shown transforms (live preview, else the document); inside an entered chain, the links it carries too. */
  readonly transforms: ReadonlyMap<string, UeTransform>
}

export const dragTargetOf = (s: EditorState): DragTarget | undefined => {
  const transforms = new Map(
    editedKeys(s).flatMap((id) => {
      const t = shownTransform(s, id)
      return t === undefined || !sceneRegistry.objects.has(id) ? [] : [[id, t] as const]
    })
  )
  const target = selectionPivot(s, (id) => transforms.get(id))
  return target === undefined ? undefined : { ...target, transforms }
}

const NOTHING: Box = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }

/** The box and ends of `keys`, as `transforms` has them. */
export const selectionSnapStart = (
  { catalogIndex, doc }: Pick<EditorState, "catalogIndex" | "doc">,
  transforms: ReadonlyMap<string, UeTransform>,
  keys: ReadonlyArray<string>
): SelectionSnapStart => {
  const placed = keys.flatMap((key) => {
    const item = doc.map.items[doc.ids.indexOf(key)]
    const transform = transforms.get(key)
    return item === undefined || transform === undefined ? [] : [{ key, item, transform }]
  })
  return {
    box: placedBoxOf(placed, catalogIndex) ?? NOTHING,
    ends: placed.flatMap(({ item, key, transform }) => endsOf(key, item, transform, catalogIndex))
  }
}

/**
 * Whether a press on the selection's body drags it (docs/SNAPPING.md § What a drag looks like): by default only to join
 * ends, so with snapping and Connectors on and an end among what it carries; else the press is a click as ever.
 */
export const bodyDrags = (s: EditorState): boolean => {
  const config = snapConfigOf(s)
  if (config.bodyDrag === "never") return false
  const target = dragTargetOf(s)
  if (target === undefined) return false
  if (config.bodyDrag === "always") return true
  if (!config.enabled || !config.targets.connectors.enabled) return false
  return selectionSnapStart(s, target.transforms, [...target.transforms.keys()]).ends.length > 0
}

/**
 * The way out of the face `unit` pivots on, which a turn brings flush (docs/SNAPPING.md § Affect): an item's own pivot, a
 * group's choice, or what that choice names. Undefined when the pivot isn't on a face.
 */
export const baseFaceOf = (s: EditorState, unit: Unit): Vec3 | undefined => {
  const group = findGroup(s.doc.structure.tree, unit.id)
  if (group === undefined) return faceNormalOf(pivotOf(s, unit.id).choice, unit.transform.rotation)
  const root = unit.links?.[0]
  if (root !== undefined) return baseFaceOf(s, root)
  const { pivot } = group
  if (pivot === undefined) return undefined
  const choice = pivot.choice !== "item"
    ? pivot.choice
    : unit.keys.includes(pivot.key)
    ? pivotOf(s, pivot.key).choice
    : ""
  return faceNormalOf(choice, unit.transform.rotation)
}
