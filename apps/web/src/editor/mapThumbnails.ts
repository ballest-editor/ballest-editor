/**
 * A map's thumbnail: the Project panel's row, a top-down view framed to the map's items, on a transparent background
 * like a piece's (`thumbnails.ts`, whose stage and queue it shares). The Top pane's orientation, so the two agree.
 *
 * `mainBounds` and `topDownFraming` are unit-tested; the WebGL part is a thin wrapper.
 */
import * as THREE from "three"
import type { CatalogIndex } from "../domain/Catalog"
import { type Tuple3, ueToThreeVector } from "../domain/coords"
import type { Item } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { ORTHO_AXES } from "../domain/orthoView"
import type { Surfaces } from "../domain/surface"
import {
  buildItem,
  SerialQueue,
  snapshot,
  stageQueue,
  TEXTURE_WAIT_MS,
  texturesOf,
  whenTexturesReady
} from "./thumbnails"

/** A row shows it at 32 px: this is that at twice the pixel density. */
const MAP_THUMBNAIL_SIZE = 64
/** The room left around the items. */
const MARGIN = 1.06
/** The share of items at each end of the ground the frame leaves out, so one far from the rest can't shrink them away. */
const OUTLIERS = 0.02
/** Items built between one yield to the page and the next, so a large map never stalls it. */
const ITEMS_PER_TASK = 250
/** How far above the top of the map the camera stands, and below its bottom it sees (cm). */
const STANDOFF = 100

type Bounds = readonly [min: Tuple3, max: Tuple3]

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

export interface TopDownFraming {
  /** Over the box's centre, above its top. */
  readonly position: Tuple3
  /** Half the frame's side: the box's longer side across the view, with the margin. */
  readonly halfSide: number
  /** How far the camera sees: down through the box. */
  readonly far: number
}

/** Where an orthographic camera looking straight down (scene frame, y up) stands to fit the box in a square frame. */
export const topDownFraming = (min: Tuple3, max: Tuple3): TopDownFraming => ({
  position: [(min[0] + max[0]) / 2, max[1] + STANDOFF, (min[2] + max[2]) / 2],
  halfSide: Math.max(1, (MARGIN * Math.max(max[0] - min[0], max[2] - min[2])) / 2),
  far: max[1] - min[1] + 2 * STANDOFF
})

/** The map's items as the viewport draws them; what has no mesh, or didn't load, is left out. */
const buildMap = async (
  items: ReadonlyArray<Item>,
  index: CatalogIndex,
  table: MaterialTable | null,
  surfaces: Surfaces
): Promise<THREE.Group> => {
  const root = new THREE.Group()
  const turns = new SerialQueue()
  const starts = Array.from({ length: Math.ceil(items.length / ITEMS_PER_TASK) }, (_, turn) => turn * ITEMS_PER_TASK)
  await Promise.all(starts.map((from) =>
    turns.run(async () => {
      const built = await Promise.all(
        items.slice(from, from + ITEMS_PER_TASK).map((item) => buildItem(item, index, table, surfaces))
      )
      for (const object of built) if (object !== undefined) root.add(object)
      await new Promise((resolve) => setTimeout(resolve))
    })
  ))
  return root
}

const render = async (
  items: ReadonlyArray<Item>,
  index: CatalogIndex,
  table: MaterialTable | null,
  surfaces: Surfaces
): Promise<string | undefined> => {
  const root = await buildMap(items, index, table, surfaces)
  if (root.children.length === 0) return undefined
  await whenTexturesReady(texturesOf(root), TEXTURE_WAIT_MS)
  root.updateMatrixWorld(true)
  const boxes = root.children.map((item) => new THREE.Box3().setFromObject(item)).filter((box) => !box.isEmpty())
  const [min, max] = mainBounds(boxes.map((box) => [box.min.toArray(), box.max.toArray()]))
  const { position, halfSide, far } = topDownFraming(min, max)
  const camera = new THREE.OrthographicCamera(-halfSide, halfSide, halfSide, -halfSide, 0.1, far)
  const { x, y, z } = ueToThreeVector(ORTHO_AXES.top.up)
  camera.up.set(x, y, z)
  camera.position.set(...position)
  camera.lookAt(position[0], min[1], position[2])
  camera.updateProjectionMatrix()
  return snapshot(root, camera, MAP_THUMBNAIL_SIZE)
}

/** A rendered thumbnail of a map (PNG data URL), or undefined when it has nothing to draw or rendering failed. */
export const mapThumbnailFor = (
  items: ReadonlyArray<Item>,
  index: CatalogIndex | null,
  table: MaterialTable | null,
  surfaces: Surfaces
): Promise<string | undefined> => {
  if (index === null) return Promise.resolve(undefined)
  return stageQueue.run(() => render(items, index, table, surfaces)).catch((error: unknown) => {
    console.warn("Couldn't render a map's thumbnail.", error)
    return undefined
  })
}
