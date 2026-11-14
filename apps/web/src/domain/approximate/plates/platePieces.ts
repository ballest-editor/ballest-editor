/** The pieces a plate is made of: flattened pyramids as triangles, and thin cubes as rectangles. */
import type { Vec3 } from "../../coords"
import {
  quatFromFrame,
  rotateVec,
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub
} from "../../ueMath"
import type { Placement } from "../shapes"
import type { PatchPlane, Rect } from "./patchPlane"

/** The shortest side, in cm, a triangle or a lens may have and still get a piece. */
const SHORTEST = 0.5

/**
 * A lens: a pyramid flattened to `thickness` at most, whose middle slice is the isosceles triangle with `apex` over
 * the middle of `q`–`r`. Undefined for a triangle under `SHORTEST` wide or tall.
 */
const lens = (apex: Vec3, q: Vec3, r: Vec3, thickness: number): Placement | undefined => {
  const base = vecSub(r, q), middle = vecScale(vecAdd(q, r), 0.5)
  const rise = vecSub(apex, middle)
  const width = vecLength(base), height = vecLength(rise)
  if (width < SHORTEST || height < SHORTEST) return undefined
  const y = vecScale(base, 1 / width), z = vecScale(rise, 1 / height)
  const x = vecCross(y, z)
  // The triangle is the pyramid's middle slice, so its edges meet the neighbours' exactly. The pyramid is thickest
  // along its middle line, and kept thin enough there that the ridge it makes on the face stays shallow.
  const half = Math.max(0.25, Math.min(thickness / 2, 0.002 * Math.min(width / 2, height)))
  return {
    kind: "pyramid",
    center: vecScale(vecAdd(middle, apex), 0.5),
    half: { x: half, y: width / 2, z: height / 2 },
    rotation: quatFromFrame(x, z)
  }
}

const defined = (list: ReadonlyArray<Placement | undefined>): Array<Placement> =>
  list.filter((piece): piece is Placement => piece !== undefined)

/** Two sides from a corner count as equal when they differ by under this share of the triangle's shortest side. */
const ISOSCELES = 0.03

/**
 * Lenses that cover the triangle exactly: one where it is isosceles to within `ISOSCELES`, its apex moved onto the
 * base's bisector, and otherwise two that overlap in its plane. Nothing for a triangle with a side under `SHORTEST`
 * or with no area.
 */
export const trianglePieces = (a: Vec3, b: Vec3, c: Vec3, thickness: number): Array<Placement> => {
  const corners = [a, b, c]
  const corner = (i: number) => corners[i % 3] ?? a
  // Each corner's opposite side.
  const lengths = [0, 1, 2].map((i) => vecLength(vecSub(corner(i + 1), corner(i + 2))))
  const shortest = Math.min(...lengths)
  if (shortest < SHORTEST || vecLength(vecCross(vecSub(b, a), vecSub(c, a))) < 1e-8) return []

  // Any corner may be the apex of an isosceles face, including a small angle opposite the shortest side.
  for (let k = 0; k < 3; k++) {
    const apex = corner(k), left = corner(k + 1), right = corner(k + 2)
    if (Math.abs(vecLength(vecSub(apex, left)) - vecLength(vecSub(apex, right))) > ISOSCELES * shortest) continue
    const base = vecSub(right, left), middle = vecScale(vecAdd(left, right), 0.5)
    const onBisector = vecSub(apex, vecScale(base, vecDot(vecSub(apex, middle), base) / vecDot(base, base)))
    return defined([lens(onBisector, left, right, thickness)])
  }

  // `p` is the widest corner, opposite the longest side `q`–`r`, with `q` the nearer end.
  const widest = lengths.indexOf(Math.max(...lengths))
  const p = corner(widest)
  let q = corner(widest + 1), r = corner(widest + 2)
  if (vecLength(vecSub(p, q)) > vecLength(vecSub(p, r))) [q, r] = [r, q]
  const pr = vecLength(vecSub(r, p)), qr = vecSub(r, q)
  // One lens stands on the longest side, from `q` to its image in the foot of `p`'s altitude; the other has its apex
  // at `r` and its base from `p` to the point of the longest side as far from `r` as `p` is.
  const foot = vecAdd(q, vecScale(qr, vecDot(vecSub(p, q), qr) / vecDot(qr, qr)))
  const imageOfQ = vecSub(vecScale(foot, 2), q)
  const asFarAsP = vecAdd(r, vecScale(vecSub(q, r), pr / vecLength(qr)))
  return defined([lens(p, q, imageOfQ, thickness), lens(r, p, asFarAsP, thickness)])
}

/** How lenses tuck under their neighbours: grown this share in their plane, and sunk as far as their edges moved. */
const LENS_GROWTH = 0.04

/**
 * `piece`, a lens, grown about its triangle's centroid and sunk along `inward` by as far as its edges moved out, so
 * its zero-thickness edges tuck under the neighbours' instead of meeting them edge to edge, where a seam can open.
 */
export const tucked = (piece: Placement, inward: Vec3): Placement => {
  // The middle slice is apex (0, 0, 1) and base (0, ±1, -1) of the normalised box: its centroid is at z = -1/3, and its
  // inradius is height · width / (width + 2 · side) in cm.
  const width = 2 * piece.half.y, height = 2 * piece.half.z
  const inradius = width * height / (width + 2 * Math.hypot(width / 2, height))
  const centroid = vecAdd(piece.center, rotateVec(piece.rotation, { x: 0, y: 0, z: -piece.half.z / 3 }))
  const grown = vecAdd(centroid, vecScale(vecSub(piece.center, centroid), 1 + LENS_GROWTH))
  return {
    ...piece,
    center: vecAdd(grown, vecScale(vecNormalize(inward), LENS_GROWTH * inradius)),
    half: { x: piece.half.x, y: piece.half.y * (1 + LENS_GROWTH), z: piece.half.z * (1 + LENS_GROWTH) }
  }
}

/** `piece` moved `by` cm along `direction`. */
export const shifted = (piece: Placement, direction: Vec3, by: number): Placement => ({
  ...piece,
  center: vecAdd(piece.center, vecScale(vecNormalize(direction), by))
})

/** Where points of a piece's normalised box, -1 to 1 along each of its axes, are in the world. */
export const pieceWorld = (piece: Placement) => (x: number, y: number, z: number): Vec3 =>
  vecAdd(piece.center, rotateVec(piece.rotation, { x: x * piece.half.x, y: y * piece.half.y, z: z * piece.half.z }))

/** How far a rectangle's plate reaches past each side, so it tucks under its neighbours: 15% of its thickness, and of a voxel at most. */
export const plateOverlap = (thickness: number, voxel: number): number => Math.min(thickness * 0.15, voxel * 0.15)

/** A plate over `rect` of `plane`, its outer face on the plane, `overlap` past each side. */
const plateOver = (plane: PatchPlane, rect: Rect, thickness: number, overlap: number): Placement => {
  const n = plane.patch.normal
  const centre = vecSub(plane.world((rect.s0 + rect.s1) / 2, (rect.t0 + rect.t1) / 2), vecScale(n, thickness / 2))
  return {
    kind: "box",
    center: centre,
    half: { x: (rect.s1 - rect.s0) / 2 + overlap, y: (rect.t1 - rect.t0) / 2 + overlap, z: thickness / 2 },
    rotation: quatFromFrame(plane.s, n)
  }
}

/** Where a rectangle's outline is tested against the container, as shares of its sides: corners and middles. */
const OUTLINE = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]] as const

/** A plate's corners in its own axes. */
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const

/** A plate is thinned at most this many times, and no further once it is under 1 cm thick. */
const HALVINGS = 6

/**
 * The plate over `rect`: as thick as `thicknessAt` allows behind five points of it, then halved (which sinks its
 * inner face only) until its inner corners are inside the container, `halved` times. `outside` is how far a point is
 * outside the container, and the tolerance is 5% of the rectangle's shorter side.
 *
 * `onSurface` is whether the rectangle itself, not the overlap past it that tucks under the neighbours, lies on the
 * container's surface: one stretched past the patch's outline shows as a lip. A plate that doesn't is 0.5 cm thick and
 * not thinned.
 */
export const rectanglePlate = (
  plane: PatchPlane,
  rect: Rect,
  thicknessAt: (points: ReadonlyArray<Vec3>) => number,
  overlap: number,
  outside: (p: Vec3) => number
): { readonly plate: Placement; readonly onSurface: boolean; readonly halved: number } => {
  const along = (f: number, g: number) =>
    plane.world(rect.s0 + (rect.s1 - rect.s0) * f, rect.t0 + (rect.t1 - rect.t0) * g)
  const tolerance = 0.05 * Math.min(rect.s1 - rect.s0, rect.t1 - rect.t0)
  const onSurface = OUTLINE.every(([f, g]) => outside(along(f, g)) <= tolerance)
  if (!onSurface) return { plate: plateOver(plane, rect, 0.5, overlap), onSurface, halved: 0 }
  const samples = [along(0.15, 0.15), along(0.85, 0.15), along(0.15, 0.85), along(0.85, 0.85)]
  samples.push(plane.world((rect.s0 + rect.s1) / 2, (rect.t0 + rect.t1) / 2))
  let plate = plateOver(plane, rect, thicknessAt(samples), overlap)
  let halved = 0
  for (; halved < HALVINGS; halved++) {
    // A plate's own z is the patch's outward normal, so its inner face is z = -1.
    const world = pieceWorld(plate)
    if (plate.half.z < 0.5 || CORNERS.every(([x, y]) => outside(world(x * 0.9, y * 0.9, -1)) <= tolerance)) break
    plate = shifted({ ...plate, half: { ...plate.half, z: plate.half.z / 2 } }, plane.patch.normal, plate.half.z / 2)
  }
  return { plate, onSurface, halved }
}
