import { type Bounds, type CatalogPiece, DEFAULT_BOUNDS } from "./Catalog"
import type { Quat4, Vec3 } from "./coords"
import { placementTransform } from "./factory"
import { rotateVec } from "./ueMath"

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
  footprintOf(piece.bounds ?? DEFAULT_BOUNDS, placementTransform(piece, { x: 0, y: 0, z: 0 }))

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
