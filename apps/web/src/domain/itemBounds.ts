/**
 * The world-aligned box around items, as the game measures it for a group's frame and a prefab's (docs/FORMAT.md
 * § Groups): each item's local bounds (`pivotBoundsOf`), turned and scaled by its transform.
 */
import type { CatalogIndex } from "./Catalog"
import type { UeTransform, Vec3 } from "./coords"
import { editTransform } from "./editTransform"
import type { Item } from "./MapFile"
import { localToWorld, pivotBoundsOf } from "./pivot"

export interface Box {
  readonly min: Vec3
  readonly max: Vec3
}

/** The corners of an item's turned bounds under `transform`, or its origin when its bounds are unknown. */
const cornersOf = (item: Item, transform: UeTransform, catalog: CatalogIndex | null): ReadonlyArray<Vec3> => {
  const bounds = pivotBoundsOf(item, catalog)
  if (bounds === undefined) return [transform.translation]
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  return [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => localToWorld(transform, { x, y, z }))))
}

/** An item and where it stands, which an edit not in the document yet can make other than its own transform. */
export interface PlacedItem {
  readonly item: Item
  readonly transform: UeTransform
}

/**
 * The box around `placed`; undefined with none. A loop, not `Math.min(...corners)`: a group can hold more corners than a
 * call has room for arguments.
 */
export const placedBoxOf = (placed: ReadonlyArray<PlacedItem>, catalog: CatalogIndex | null): Box | undefined => {
  let box: Box | undefined
  for (const { item, transform } of placed) {
    for (const { x, y, z } of cornersOf(item, transform, catalog)) {
      const { max, min } = box ?? { min: { x, y, z }, max: { x, y, z } }
      box = {
        min: { x: Math.min(min.x, x), y: Math.min(min.y, y), z: Math.min(min.z, z) },
        max: { x: Math.max(max.x, x), y: Math.max(max.y, y), z: Math.max(max.z, z) }
      }
    }
  }
  return box
}

/** The box around `items` where the document has them. */
export const itemsBoxOf = (items: ReadonlyArray<Item>, catalog: CatalogIndex | null): Box | undefined =>
  placedBoxOf(items.map((item) => ({ item, transform: editTransform(item) })), catalog)

/** The middle of `box`. */
export const boxCentreOf = ({ max, min }: Box): Vec3 => ({
  x: (min.x + max.x) / 2,
  y: (min.y + max.y) / 2,
  z: (min.z + max.z) / 2
})
