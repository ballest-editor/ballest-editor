/**
 * Tracking's acquired points on items (docs/SNAPPING.md § Tracking): one acquired on an item is held in the item's local
 * frame, by way of `editTransform` as the snap targets are, so it can be put back wherever the document has the item.
 */
import type { Vec3 } from "./coords"
import { editTransform } from "./editTransform"
import { localToWorld, worldToLocal } from "./pivot"
import type { TrackedPoint } from "./snapFrame"
import { type Doc, indexOfKey } from "./structure"
import { vecLength, vecSub } from "./ueMath"

/** Two points closer than this are one: going through an item's frame and back moves one by a rounding error. */
const SAME_POINT_CM = 0.001

export const isSamePoint = (a: Vec3, b: Vec3) => vecLength(vecSub(a, b)) < SAME_POINT_CM

const itemOf = (doc: Doc, key: string) => doc.map.items[indexOfKey(doc.ids, key)]

/** `point` as one of the item `key`; as it was when `doc` has no such item. */
export const trackedOn = (doc: Doc, point: TrackedPoint, key: string): TrackedPoint => {
  const item = itemOf(doc, key)
  if (item === undefined) return point
  return { ...point, on: { item: key, local: worldToLocal(editTransform(item), point.at) } }
}

/** `tracked` where `doc` has their items, less any whose item it lacks; `tracked` itself when none of that changes it. */
export const trackedIn = (doc: Doc, tracked: ReadonlyArray<TrackedPoint>): ReadonlyArray<TrackedPoint> => {
  const placed = tracked.flatMap((point): ReadonlyArray<TrackedPoint> => {
    if (point.on === undefined) return [point]
    const item = itemOf(doc, point.on.item)
    if (item === undefined) return []
    const at = localToWorld(editTransform(item), point.on.local)
    return [isSamePoint(at, point.at) ? point : { ...point, at }]
  })
  return placed.length === tracked.length && placed.every((point, i) => point === tracked[i]) ? tracked : placed
}
