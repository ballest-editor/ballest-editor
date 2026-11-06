/**
 * A map's thumbnail in the Project panel's row: the top-down picture `thumbnails.ts` draws, at a row's size and framed
 * to the bulk of the map.
 *
 * `mainBounds` is unit-tested.
 */
import type { CatalogIndex } from "../domain/Catalog"
import type { Item } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import type { Surfaces } from "../domain/surface"
import { type Bounds, type MapShot, mapThumbnailFor } from "./thumbnails"

/** The share of items at each end of the ground the frame leaves out, so one far from the rest can't shrink them away. */
const OUTLIERS = 0.02

/**
 * What a map's items cover, each given by its bounds (scene frame, y up), less the outermost `OUTLIERS` across the
 * ground: at 32 px a goal far from the track would leave the track a speck. The height is all of it, so nothing that is
 * still in the frame stands above the camera.
 */
export const mainBounds = (boxes: ReadonlyArray<Bounds>): Bounds => {
  const left = Math.floor(boxes.length * OUTLIERS)
  const extent = (axis: 0 | 1 | 2, skipped: number) => {
    const mins = boxes.map(([min]) => min[axis]).sort((a, b) => a - b)
    const maxes = boxes.map(([, max]) => max[axis]).sort((a, b) => b - a)
    return [mins[skipped] ?? 0, maxes[skipped] ?? 0] as const
  }
  const [minX, maxX] = extent(0, left)
  const [minY, maxY] = extent(1, 0)
  const [minZ, maxZ] = extent(2, left)
  return [[minX, minY, minZ], [maxX, maxY, maxZ]]
}

/** A row shows it at 32 px: this is that at twice the pixel density. */
const ROW_SHOT: MapShot = { size: 64, frame: mainBounds }

/**
 * A rendered thumbnail (PNG data URL) of the map in the file with this hash, or undefined when it has nothing to draw or
 * rendering failed.
 */
export const mapRowThumbnailFor = (
  hash: string,
  items: ReadonlyArray<Item>,
  index: CatalogIndex | null,
  table: MaterialTable | null,
  surfaces: Surfaces
): Promise<string | undefined> =>
  index === null
    ? Promise.resolve(undefined)
    : mapThumbnailFor(`row:${hash}`, items, index, table, surfaces, ROW_SHOT)
