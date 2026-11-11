/** What a drag of the selection starts from, for snapping: what it acts on, and what leads it. */
import { endsOf, type WorldEnd } from "../../domain/connectors"
import type { UeTransform } from "../../domain/coords"
import { type Box, placedBoxOf } from "../../domain/itemBounds"
import { targetOn } from "../../domain/snapConfig"
import { indexOfKey } from "../../domain/structure"
import { sceneRegistry } from "../sceneRegistry"
import {
  editedKeys,
  type EditorState,
  type SelectionPivot,
  selectionPivot,
  shownTransform,
  snapConfigOf
} from "../store"

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
    const item = doc.map.items[indexOfKey(doc.ids, key)]
    const transform = transforms.get(key)
    return item === undefined || transform === undefined ? [] : [{ key, item, transform }]
  })
  return {
    box: placedBoxOf(placed, catalogIndex) ?? NOTHING,
    ends: placed.flatMap(({ item, key, transform }) =>
      endsOf(key, item, transform, catalogIndex, doc.structure.items.get(key)?.connectAt)
    )
  }
}

/**
 * Whether a press on the selection's body drags it (docs/SNAPPING.md § What a drag looks like): by default only to join
 * ends, so with snapping and Connectors on and an end among what it carries; else the press is a click as ever.
 */
export const bodyDrags = (s: EditorState): boolean => {
  const config = snapConfigOf(s)
  const { bodyDrag } = s.settings.snapPrefs
  if (bodyDrag === "never") return false
  const target = dragTargetOf(s)
  if (target === undefined) return false
  if (bodyDrag === "always") return true
  if (!targetOn(config, "connectors")) return false
  return selectionSnapStart(s, target.transforms, [...target.transforms.keys()]).ends.length > 0
}
