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

/** A box's size in metres, the way a group's card gives it: "12.4 × 3.1 × 2.0 m". */
export const formatBoxSize = ({ max, min }: Box): string => {
  const metres = (from: number, to: number) => ((to - from) / 100).toFixed(1)
  return `${metres(min.x, max.x)} × ${metres(min.y, max.y)} × ${metres(min.z, max.z)} m`
}

export const boxCentreOf = ({ max, min }: Box): Vec3 => ({
  x: (min.x + max.x) / 2,
  y: (min.y + max.y) / 2,
  z: (min.z + max.z) / 2
})

/**
 * An item's local bounds' length along each of its own axes (unscaled cm): what a scale of 1 makes its size. Undefined
 * when the bounds are unknown or flat on an axis (a raw light's), where no scale gives a size.
 */
export const extentOf = (item: Item, catalog: CatalogIndex | null): Vec3 | undefined => {
  const bounds = pivotBoundsOf(item, catalog)
  if (bounds === undefined) return undefined
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const extent = { x: x1 - x0, y: y1 - y0, z: z1 - z0 }
  return Math.min(extent.x, extent.y, extent.z) > 0 ? extent : undefined
}

/** The size (cm) an `extent` takes at `scale`, along the item's own axes: a flip doesn't make it negative. */
export const sizeAt = (extent: Vec3, scale: Vec3): Vec3 => ({
  x: extent.x * Math.abs(scale.x),
  y: extent.y * Math.abs(scale.y),
  z: extent.z * Math.abs(scale.z)
})

/** The scale that gives `extent` the `size` (cm), keeping each axis's flip from `scale`. */
export const scaleForSize = (extent: Vec3, scale: Vec3, size: Vec3): Vec3 => {
  const axis = (e: number, s: number, v: number) => (s < 0 ? -1 : 1) * v / e
  return { x: axis(extent.x, scale.x, size.x), y: axis(extent.y, scale.y, size.y), z: axis(extent.z, scale.z, size.z) }
}
