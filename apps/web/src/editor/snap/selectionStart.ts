/** What a drag of the selection starts from, for snapping: what it acts on, and what leads it. */
import { endsOf, type WorldEnd } from "../../domain/connectors"
import type { UeTransform } from "../../domain/coords"
import { type Box, placedBoxOf } from "../../domain/itemBounds"
import { sceneRegistry } from "../sceneRegistry"
import { editedKeys, type EditorState, type SelectionPivot, selectionPivot, shownTransform } from "../store"

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
