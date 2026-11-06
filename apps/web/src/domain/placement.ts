import { type Bounds, type CatalogPiece, DEFAULT_BOUNDS } from "./Catalog"
import type { Quat4, Vec3 } from "./coords"
import { placementTransform } from "./factory"
import type { Box } from "./itemBounds"
import { dot } from "./orthoView"
import { ORIGIN, rotateVec } from "./ueMath"

/**
 * The default for how far from the camera a new piece may land, in cm, before its size is
 * considered (Settings > Editor > Placement distance): 20 m, a second of flying at the
 * default 20 m/s, so the piece is in plain view at the default FOV.
 */
export const PLACE_DISTANCE = 2000

/** The share of the narrower view angle a big piece's footprint may cover. */
const FOOTPRINT_FILL = 0.6

/**
 * A placed piece's footprint, in cm: the longer horizontal side (UE X or Y) of its bounds
 * once the transform's rotation and scale are applied. Height is left out, so a tall piece
 * (Bevel_T Ring hangs ~70 m below its ring) may overflow the screen vertically while the
 * ring itself still fits.
 */
export const footprintOf = (
  bounds: Bounds,
  transform: { readonly rotation: Quat4; readonly scale3D: Vec3 }
): number => {
  const s = transform.scale3D
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    rotateVec(transform.rotation, {
      x: (i & 1 ? bounds.max[0] : bounds.min[0]) * s.x,
      y: (i & 2 ? bounds.max[1] : bounds.min[1]) * s.y,
      z: (i & 4 ? bounds.max[2] : bounds.min[2]) * s.z
    })
  )
  const extent = (axis: (v: Vec3) => number) => Math.max(...corners.map(axis)) - Math.min(...corners.map(axis))
  return Math.max(extent((v) => v.x), extent((v) => v.y))
}

/** The footprint of `piece` as a palette placement orients and scales it. */
export const pieceFootprint = (piece: CatalogPiece): number =>
  footprintOf(piece.bounds ?? DEFAULT_BOUNDS, placementTransform(piece, ORIGIN))

/**
 * The placement cap for a piece with this footprint: `base`, or further when the footprint
 * would cover more than `FOOTPRINT_FILL` of the view angle `fov` (radians, the narrower of
 * the viewport's horizontal and vertical angles).
 */
export const placeDistanceFor = (footprint: number, fov: number, base = PLACE_DISTANCE): number =>
  Math.max(base, footprint / 2 / Math.tan(fov / 2) / FOOTPRINT_FILL)

/** Whole centimetres, never -0. */
const cm = (v: number): number => Math.round(v) + 0

/**
 * Where a new piece goes, in UE cm: where the view ray from `origin` along `direction`
 * meets the floor (z = `floor`, see `floorHeightOf`), or the point `maxDistance` along the
 * ray when the floor is further away or never hit. Either way the piece sits on the
 * screen centre.
 */
export const placementPoint = (origin: Vec3, direction: Vec3, floor: number, maxDistance: number): Vec3 => {
  const length = Math.hypot(direction.x, direction.y, direction.z)
  const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length }
  const hit = d.z === 0 ? Infinity : (floor - origin.z) / d.z
  const t = hit >= 0 && hit <= maxDistance ? hit : maxDistance
  return {
    x: cm(origin.x + d.x * t),
    y: cm(origin.y + d.y * t),
    z: hit === t ? cm(floor) : cm(origin.z + d.z * t)
  }
}

/**
 * Where a drop along a pointer's ray goes, in UE cm: on the floor when the ray meets it within `floorReach`, however far
 * from the camera that is. A ray that doesn't, above the horizon say, stops `airDistance` along.
 */
export const dropPoint = (
  origin: Vec3,
  direction: Vec3,
  floor: number,
  floorReach: number,
  airDistance: number
): Vec3 => {
  const length = Math.hypot(direction.x, direction.y, direction.z)
  const hit = direction.z === 0 ? Infinity : (floor - origin.z) * length / direction.z
  return placementPoint(origin, direction, floor, hit >= 0 && hit <= floorReach ? floorReach : airDistance)
}

/** `point` in whole centimetres. */
export const wholeCm = ({ x, y, z }: Vec3): Vec3 => ({ x: cm(x), y: cm(y), z: cm(z) })

/** The space a run of placements leaves between its pieces, in cm. */
export const PLACEMENT_GAP = 100

/** How many pieces a row of a run holds: three default cubes still fit a 16:9 view at the default distance. */
export const PLACEMENT_COLUMNS = 3

/** How many of a run's slots a placement tries for a free one: eight rows, by when a piece is well up the screen. */
const PLACEMENT_SLOTS = PLACEMENT_COLUMNS * 8

/** How many grid steps from the aim point a placement looks, once the run's own slots are spent. */
const PLACEMENT_RINGS = 8

/** The slots around the aim point, nearest first, as grid steps along the view's right and up its rows. */
const SLOTS_AROUND = Array.from({ length: (2 * PLACEMENT_RINGS + 1) ** 2 }, (_, i) => ({
  column: i % (2 * PLACEMENT_RINGS + 1) - PLACEMENT_RINGS,
  row: PLACEMENT_RINGS - Math.floor(i / (2 * PLACEMENT_RINGS + 1))
})).sort((a, b) => Math.hypot(a.column, a.row) - Math.hypot(b.column, b.row))

/** How far from the view's centre a slot may be, as a share of the way to its edge: clear of the pane's toolbars. */
const VIEW_REACH = 0.8

/** A view whose up has less horizontal in it than this is level: there is no floor ahead to lay rows along. */
const LEVEL_UP = 0.1

/** Where a pane looks from and how it is turned, in UE cm and unit axes. */
export interface PlacementView {
  readonly position: Vec3
  readonly right: Vec3
  readonly up: Vec3
  /** Where the pane shows `point`: x and y run -1 to 1 across the view, and z leaves -1 to 1 past its depth or behind it. */
  readonly project: (point: Vec3) => Vec3
}

/**
 * Pieces placed one after another under one view, laid out from where the first went: rightward along the view, then in
 * a new row further up the screen. `along` and `across` are the latest piece's distance from `start` in cm.
 */
export interface PlacementRun {
  readonly start: Vec3
  readonly column: number
  readonly along: number
  readonly across: number
  /** The deepest piece so far in the current row, which sets how far the next row stands off. */
  readonly depth: number
}

export const startPlacementRun = (start: Vec3): PlacementRun => ({ start, column: 0, along: 0, across: 0, depth: 0 })

/** The way rows of a run advance: up the screen, kept on the floor unless the view is level. */
const rowAxisOf = ({ up }: PlacementView): Vec3 => {
  const flat = Math.hypot(up.x, up.y)
  return flat < LEVEL_UP ? up : { x: up.x / flat, y: up.y / flat, z: 0 }
}

/** Whether `view` shows `point`, clear of its edges. */
const inView = (point: Vec3, view: PlacementView): boolean => {
  const { x, y, z } = view.project(point)
  return Math.abs(x) <= VIEW_REACH && Math.abs(y) <= VIEW_REACH && Math.abs(z) <= 1
}

/** Whether `view` shows all of the footprint `width` across around `point`, right to its edges. */
const footprintInView = ({ x, y, z }: Vec3, width: number, view: PlacementView): boolean =>
  [-1, 1].every((sideX) =>
    [-1, 1].every((sideY) => {
      const corner = view.project({ x: x + sideX * width / 2, y: y + sideY * width / 2, z })
      return Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1 && Math.abs(corner.z) <= 1
    })
  )

/** A step that clears `size` and the gap, rounded up to `gridSize` so it never closes the gap. */
const stepOver = (size: number, gridSize: number): number => Math.ceil((size + PLACEMENT_GAP) / gridSize) * gridSize

/** The stretch of `axis` that `box` covers. */
const spanOf = ({ max, min }: Box, axis: Vec3): { readonly from: number; readonly to: number } => {
  const ends = (["x", "y", "z"] as const).map((k) => [min[k] * axis[k], max[k] * axis[k]] as const)
  return {
    from: ends.reduce((sum, [lo, hi]) => sum + Math.min(lo, hi), 0),
    to: ends.reduce((sum, [lo, hi]) => sum + Math.max(lo, hi), 0)
  }
}

const lengthOf = (box: Box, axis: Vec3): number => {
  const { from, to } = spanOf(box, axis)
  return to - from
}

/**
 * Whether a piece `width` across, placed at `point`, would land on `box` as `view` sees it. The view's depth is left out,
 * so a piece that lands behind another at the same screen spot counts.
 */
export const wouldLandOn = (point: Vec3, width: number, box: Box, view: PlacementView): boolean =>
  [view.right, rowAxisOf(view)].every((axis) => {
    const { from, to } = spanOf(box, axis)
    const at = dot(point, axis)
    return at >= from - width / 2 && at <= to + width / 2
  })

/**
 * The run with one more piece, `width` across, after the piece at `last`. A step clears the wider of the two whatever
 * their pivots, plus the gap, and rounds up to `gridSize` so it never closes the gap.
 */
export const nextInRun = (
  run: PlacementRun,
  last: Box,
  width: number,
  view: PlacementView,
  gridSize: number
): PlacementRun => {
  const depth = Math.max(run.depth, lengthOf(last, rowAxisOf(view)), width)
  const along = run.along + stepOver(Math.max(lengthOf(last, view.right), width), gridSize)
  return run.column + 1 < PLACEMENT_COLUMNS
    ? { ...run, column: run.column + 1, along, depth }
    : { ...run, column: 0, along: 0, across: run.across + stepOver(depth, gridSize), depth: 0 }
}

/** Where the run's latest piece goes, in whole cm. */
export const runPoint = ({ across, along, start }: PlacementRun, view: PlacementView): Vec3 => {
  const row = rowAxisOf(view)
  const at = (axis: "x" | "y" | "z") => cm(start[axis] + view.right[axis] * along + row[axis] * across)
  return { x: at("x"), y: at("y"), z: at("z") }
}

/**
 * Whether a piece `width` across and `height` tall, standing on `point`, would stand in `box`: their footprints meet and
 * their heights do. A box wholly above or below leaves the spot free, so a piece can land on a platform or under one.
 */
export const wouldStandIn = (point: Vec3, width: number, { max, min }: Box, height = 0): boolean =>
  point.x >= min.x - width / 2 && point.x <= max.x + width / 2 &&
  point.y >= min.y - width / 2 && point.y <= max.y + width / 2 &&
  point.z + height >= min.z && point.z <= max.z

/** A box of no size: to `nextInRun`, a step sized by the piece alone. */
export const NO_BOX: Box = { min: ORIGIN, max: ORIGIN }

/** Whether a piece `width` across and `height` tall, at a run's slot, stands clear of `boxes` and in view. */
const freeSlotTest =
  (boxes: ReadonlyArray<Box>, width: number, view: PlacementView, height: number) =>
  (candidate: PlacementRun): boolean => {
    const point = runPoint(candidate, view)
    return inView(point, view) && !boxes.some((box) => wouldStandIn(point, width, box, height))
  }

/** The nearest slot around `aim` that `isFree` allows, on a lattice `step` cm apart, or else `aim` itself. */
const nearestSlot = (aim: Vec3, isFree: (slot: PlacementRun) => boolean, step: number) => {
  const start = startPlacementRun(aim)
  return SLOTS_AROUND.map(({ column, row }) => ({ ...start, along: column * step, across: row * step })).find(isFree) ??
    start
}

/**
 * `run`, moved on from its latest slot to the first where a piece `width` across and `height` tall stands clear of
 * `boxes` and in view, or else to the nearest such slot around the aim point (`run.start`). Slots are sized by the piece,
 * not by what's in the way, so a huge item can't throw it out of sight. With no such slot the piece goes on the aim
 * point: an overlap beats a piece nobody can see.
 */
export const clearOfBoxes = (
  run: PlacementRun,
  boxes: ReadonlyArray<Box>,
  width: number,
  view: PlacementView,
  gridSize: number,
  height = 0
): PlacementRun => {
  const isFree = freeSlotTest(boxes, width, view, height)
  let slot = run
  for (let tried = 0; tried < PLACEMENT_SLOTS; tried++) {
    if (isFree(slot)) return slot
    slot = nextInRun(slot, NO_BOX, width, view, gridSize)
  }
  return nearestSlot(run.start, isFree, stepOver(width, gridSize))
}

/** How far a drop's underside may sink into an item and still be on it, in cm: a mesh's top can sit under its box's. */
const RESTING_SLACK = 5

/**
 * Where a drop on `hit` goes, for a piece with this `room`: on `hit` unless it would stand in one of `boxes`, then on the
 * nearest free slot around it with the whole footprint in view, or on `hit` when there is none. Slots are closer together
 * than a click's, as the pointer said where the piece should be. A piece resting on a box's top isn't in it, so one dropped
 * on a floor of tiles stays put whichever tiles it reaches over.
 */
export const clearDrop = (
  hit: Vec3,
  boxes: ReadonlyArray<Box>,
  { height, width }: { readonly width: number; readonly height: number },
  view: PlacementView,
  gridSize: number
): Vec3 => {
  const solid = boxes.map(({ max, min }) => ({ min, max: { ...max, z: max.z - RESTING_SLACK } }))
  if (!solid.some((box) => wouldStandIn(hit, width, box, height))) return hit
  const isFree = freeSlotTest(solid, width, view, height)
  const isShown = (slot: PlacementRun) => footprintInView(runPoint(slot, view), width, view)
  return runPoint(nearestSlot(hit, (slot) => isFree(slot) && isShown(slot), stepOver(width / 4, gridSize)), view)
}

/** How much room a box takes on the floor. */
export const roomOf = ({ max, min }: Box): { readonly width: number; readonly height: number } => ({
  width: Math.max(max.x - min.x, max.y - min.y),
  height: max.z - min.z
})

/** The frame that stands `box`, held relative to its frame, on `point`: centred over it, with its underside there. */
export const frameStanding = ({ max, min }: Box, point: Vec3): Vec3 => ({
  x: point.x - (min.x + max.x) / 2,
  y: point.y - (min.y + max.y) / 2,
  z: point.z - min.z
})
