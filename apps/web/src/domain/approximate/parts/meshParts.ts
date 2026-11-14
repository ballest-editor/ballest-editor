/**
 * A model's separate parts: the pieces of its mesh that share no vertex (a ship's masts, spars and cannon, the balls on
 * a star's points). One grid over the whole model reads the small ones as a cell or two, and one low-poly mesh spends
 * its faces evenly. So each small, long or thin part gets one catalog primitive of its own (`componentPiece`), and the
 * rest, the body, is fitted alone on a grid of its own.
 */
import type { Vec3 } from "../../coords"
import { quatFromAxisAngle, quatFromFrame, quatMul, quatNormalize, rotateVec, vecAdd, vecScale } from "../../ueMath"
import { at, pointAt } from "../grid/voxelize"
import { edgesOf, lookOf, type ModelViews, picturesOf, trianglesOfPlacement, viewFrameOf } from "../look/views"
import { welded } from "../mesh/mesh"
import type { Placement, ShapeKind } from "../shapes"
import { eigen } from "./thinParts"

// --- splitting a mesh into parts ----------------------------------------------------------------------------------

/** The triangles of each connected part of the welded mesh, parts joined wherever two faces share a vertex. */
export const componentsOf = (triangles: Float32Array): Array<Float32Array> => {
  const { indices, positions } = welded(triangles)
  const parent = Int32Array.from({ length: positions.length / 3 }, (_, i) => i)
  const rootOf = (vertex: number): number => {
    let root = vertex
    while (at(parent, root) !== root) root = at(parent, root)
    for (let v = vertex; v !== root;) {
      const next = at(parent, v)
      parent[v] = root
      v = next
    }
    return root
  }
  for (let f = 0; f < indices.length; f += 3) {
    const root = rootOf(at(indices, f))
    parent[rootOf(at(indices, f + 1))] = root
    parent[rootOf(at(indices, f + 2))] = root
  }
  // Parts come out in the order of their first face.
  const facesOf = new Map<number, Array<number>>()
  for (let f = 0; f < indices.length; f += 3) {
    const root = rootOf(at(indices, f))
    const faces = facesOf.get(root)
    if (faces === undefined) facesOf.set(root, [f])
    else faces.push(f)
  }
  return Array.from(facesOf.values(), (faces) => {
    const out = new Float32Array(faces.length * 9)
    faces.forEach((f, k) => {
      for (let corner = 0; corner < 3; corner++) {
        const from = 3 * at(indices, f + corner)
        out.set(positions.subarray(from, from + 3), 9 * k + 3 * corner)
      }
    })
    return out
  })
}

/** `sets` end to end, as one array. */
export const joined = (sets: ReadonlyArray<Float32Array>): Float32Array => {
  const out = new Float32Array(sets.reduce((n, set) => n + set.length, 0))
  let offset = 0
  for (const set of sets) {
    out.set(set, offset)
    offset += set.length
  }
  return out
}

// --- measuring a part ---------------------------------------------------------------------------------------------

export interface Component {
  readonly triangles: Float32Array
  readonly area: number
  /** The middle of its extents along its own axes. */
  readonly centre: Vec3
  /** Its principal axes, longest extent first, and half its extent along each, in cm. */
  readonly axes: readonly [Vec3, Vec3, Vec3]
  readonly half: readonly [number, number, number]
}

interface SurfaceMass {
  /** Each face's area, a hair over zero so a collapsed face still weighs something. */
  readonly areas: Float64Array
  readonly area: number
  readonly centroid: Vec3
}

const surfaceMass = (triangles: Float32Array): SurfaceMass => {
  const areas = new Float64Array(triangles.length / 9)
  let area = 0, sum: Vec3 = { x: 0, y: 0, z: 0 }
  for (let f = 0; f < areas.length; f++) {
    const a = pointAt(triangles, 3 * f), b = pointAt(triangles, 3 * f + 1), c = pointAt(triangles, 3 * f + 2)
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
    const size = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) + 1e-9
    areas[f] = size
    area += size
    sum = vecAdd(sum, vecScale(vecAdd(vecAdd(a, b), c), size / 3))
  }
  return { areas, area, centroid: vecScale(sum, 1 / Math.max(area, 1e-12)) }
}

/**
 * The surface's own second moments about its centroid, row by row. Each triangle's are integrated over its area (a
 * twelfth of its area times its corners' squares and their sum's): the corners alone would weigh a quad's split
 * diagonal twice and tilt a plain box's axes.
 */
const surfaceSpread = (triangles: Float32Array, { areas, centroid }: SurfaceMass): Array<Array<number>> => {
  const spread = new Float64Array(9), d = new Float64Array(3), total = new Float64Array(3)
  const add = (v: Float64Array, weight: number) => {
    for (let r = 0; r < 3; r++) {
      for (let s = 0; s < 3; s++) spread[3 * r + s] = at(spread, 3 * r + s) + weight * at(v, r) * at(v, s)
    }
  }
  for (let f = 0; f < areas.length; f++) {
    const weight = at(areas, f) / 12
    total.fill(0)
    for (let corner = 0; corner < 3; corner++) {
      const p = pointAt(triangles, 3 * f + corner)
      d[0] = p.x - centroid.x
      d[1] = p.y - centroid.y
      d[2] = p.z - centroid.z
      add(d, weight)
      for (let k = 0; k < 3; k++) total[k] = at(total, k) + at(d, k)
    }
    add(total, weight)
  }
  return [0, 3, 6].map((row) => Array.from(spread.subarray(row, row + 3)))
}

/** Where the corners reach along `axis` from `from`: the middle of their extent, and half of it. */
const extentAlong = (triangles: Float32Array, from: Vec3, axis: Vec3) => {
  let low = Infinity, high = -Infinity
  for (let v = 0; v < triangles.length / 3; v++) {
    const p = pointAt(triangles, v)
    const d = (p.x - from.x) * axis.x + (p.y - from.y) * axis.y + (p.z - from.z) * axis.z
    low = Math.min(low, d)
    high = Math.max(high, d)
  }
  return { axis, middle: (low + high) / 2, half: (high - low) / 2 }
}

/** A part's size and lie: the principal axes of its surface, and its extent along each. */
export const measured = (triangles: Float32Array): Component => {
  const mass = surfaceMass(triangles)
  const { area, centroid } = mass
  const extents = eigen(surfaceSpread(triangles, mass)).vectors
    .map((axis) => extentAlong(triangles, centroid, axis))
    .sort((a, b) => b.half - a.half)
  const [long, mid, thin] = extents
  // `eigen` always gives three axes; this is for the type.
  if (long === undefined || mid === undefined || thin === undefined) {
    return {
      triangles,
      area,
      centre: centroid,
      axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
      half: [0, 0, 0]
    }
  }
  return {
    triangles,
    area,
    centre: extents.reduce((p, { axis, middle }) => vecAdd(p, vecScale(axis, middle)), centroid),
    axes: [long.axis, mid.axis, thin.axis],
    half: [long.half, mid.half, thin.half]
  }
}

// --- one primitive for a part -------------------------------------------------------------------------------------

/** The side of a part's own views, in pixels: enough to tell a cone from a cylinder. */
const PART_VIEW = 96
const CLIMB_STEPS = 48

interface ComponentFit {
  /** The catalog shape, laid along the part's own axes, that looks most like the part in the part's own views. */
  readonly piece: Placement
  /** `piece` nudged while that makes it look more like the part. */
  readonly refined: () => Placement
  /** How like the part a piece looks in the part's own views (views.ts `lookOf`), 0 to 1. */
  readonly judge: (piece: Placement) => number
}

type Judge = ComponentFit["judge"]

const judgeOf = (part: Component): Judge => {
  const frame = viewFrameOf(part.triangles)
  const pictures = picturesOf(frame, [part.triangles], { size: PART_VIEW })
  const views: ModelViews = { frame, pictures, edges: pictures.map((picture) => edgesOf(picture, frame)) }
  return (piece) => lookOf(views, picturesOf(frame, [trianglesOfPlacement(piece)], { size: PART_VIEW })).score
}

/** No side of a part's primitive is under this half size, in cm. */
const leastHalf = (part: Component): number => Math.max(0.25, 0.02 * part.half[0])

/** Every catalog shape laid along the part's axes, each way round that looks different. */
const startsOf = (part: Component): readonly [Placement, ...Array<Placement>] => {
  const [long, mid, thin] = part.axes
  const least = leastHalf(part)
  const a = Math.max(part.half[0], least), b = Math.max(part.half[1], least), c = Math.max(part.half[2], least)
  const back = vecScale(long, -1), side = vecScale(mid, -1), under = vecScale(thin, -1)
  const piece = (kind: ShapeKind, forward: Vec3, up: Vec3, x: number, y: number, z: number): Placement => ({
    kind,
    center: part.centre,
    half: { x, y, z },
    rotation: quatFromFrame(forward, up)
  })
  return [
    piece("box", long, thin, a, b, c),
    piece("sphere", long, thin, a, b, c),
    // A cylinder along the part, and a disc across it.
    piece("cylinder", mid, long, b, c, a),
    piece("cylinder", long, thin, a, b, c),
    ...[long, back].flatMap((up) => [piece("cone", mid, up, b, c, a), piece("pyramid", mid, up, b, c, a)]),
    // A flat triangle pointing along the part's width.
    ...[mid, side].map((up) => piece("pyramid", long, up, a, c, b)),
    piece("capsule", mid, long, b, c, a),
    // A dome on the part's broad face, either side, and one at either end of it.
    ...[thin, under].map((up) => piece("hemisphere", long, up, a, b, c)),
    ...[long, back].map((up) => piece("hemisphere", mid, up, b, c, a))
  ]
}

interface Judged {
  readonly piece: Placement
  readonly look: number
}

/** The first of `starts` that looks most like the part. */
const bestStart = ([first, ...rest]: readonly [Placement, ...Array<Placement>], judge: Judge): Judged => {
  let best: Judged = { piece: first, look: -Infinity }
  for (const piece of [first, ...rest]) {
    const look = judge(piece)
    if (look > best.look) best = { piece, look }
  }
  return best
}

const AXIS_KEYS = ["x", "y", "z"] as const

/**
 * `start` after `CLIMB_STEPS` random nudges, each kept when the piece then looks more like the part: a move along one
 * of its own axes, a stretch along one, or a turn about one. The nudges shrink while they stop helping. The draws
 * are seeded, so a part always climbs the same way.
 */
const climbed = (start: Judged, judge: Judge, least: number): Placement => {
  let { look, piece } = start
  let seed = 1, step = 0.15
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let k = 0; k < CLIMB_STEPS; k++) {
    const axis = Math.floor(random() * 3), sign = random() < 0.5 ? -1 : 1, move = Math.floor(random() * 3)
    const key = AXIS_KEYS[axis] ?? "x"
    const along = rotateVec(piece.rotation, { x: axis === 0 ? 1 : 0, y: axis === 1 ? 1 : 0, z: axis === 2 ? 1 : 0 })
    const next: Placement = move === 0
      ? { ...piece, center: vecAdd(piece.center, vecScale(along, sign * step * piece.half[key])) }
      : move === 1
      ? { ...piece, half: { ...piece.half, [key]: Math.max(least, piece.half[key] * (1 + sign * step)) } }
      : { ...piece, rotation: quatNormalize(quatMul(quatFromAxisAngle(along, sign * step * 0.5), piece.rotation)) }
    const found = judge(next)
    if (found > look) {
      piece = next
      look = found
    } else if (k % 16 === 15) step = Math.max(0.02, step * 0.7)
  }
  return piece
}

const fitted = (part: Component): ComponentFit => {
  const judge = judgeOf(part)
  const start = bestStart(startsOf(part), judge)
  let kept: Placement | undefined
  return { piece: start.piece, refined: () => kept ??= climbed(start, judge, leastHalf(part)), judge }
}

const fits = new WeakMap<Component, ComponentFit>()

/** One primitive for `part`, fitted once however often it is asked for. */
export const componentPiece = (part: Component): ComponentFit => {
  const known = fits.get(part)
  if (known !== undefined) return known
  const fit = fitted(part)
  fits.set(part, fit)
  return fit
}

/** A part one primitive looks at least this like, in the part's own views, is that primitive. */
const WHOLE_LOOK = 0.75
/** The unrefined primitive must look at least this like the part for the refinement to be worth trying. */
const WHOLE_START = 0.6
/** Only a part with at least this share of the model's surface is tried, and none with as much as `WHOLE_MOST`. */
const WHOLE_LEAST = 0.01
const WHOLE_MOST = 0.25

/** The primitive `part` looks like, if one looks enough like it. */
const onePrimitive = (part: Component): Placement | undefined => {
  const fit = componentPiece(part)
  if (fit.judge(fit.piece) < WHOLE_START) return undefined
  const piece = fit.refined()
  return fit.judge(piece) >= WHOLE_LOOK ? piece : undefined
}

/**
 * The one primitive `part` is, if it is one: a foot that is a squashed ball, a ball on a star's point. On the sample
 * models' parts a primitive looks 0.77 to 0.84 like those and at most 0.73 like any part the eye wouldn't call one.
 * A part with a quarter of the surface or more is left to be fitted in detail. `total` is the model's surface area.
 */
export const wholePiece = (part: Component, total: number): Placement | undefined => {
  const share = part.area / total
  return share < WHOLE_LEAST || share >= WHOLE_MOST ? undefined : onePrimitive(part)
}

// --- sorting the parts --------------------------------------------------------------------------------------------

/** A rod is at least this many times longer than wide, and at least `ROD_ROUND` as thick as wide. */
const ROD_LONG = 3
const ROD_ROUND = 0.4
/** A sheet is thinner than this share of its width, and under `SHEET_CELLS` cells of the model's grid through. */
const SHEET_FLAT = 0.25
const SHEET_CELLS = 1.5
/** A part under this many cells long is small. */
export const SMALL_CELLS = 6
/** A sheet with at least this share of the model's surface stays in the body: a sail, a deck. */
const BIG_SHEET = 0.02

/** Whether `part` takes one primitive: a rod, a small part, a sheet that isn't a sail, or one that looks like one. */
const isLimb = (part: Component, total: number, voxel: number): boolean => {
  const [long, mid, thin] = part.half
  const width = Math.max(mid, 1e-6)
  const rod = long / width >= ROD_LONG && thin / width >= ROD_ROUND
  const sheet = thin / width < SHEET_FLAT && 2 * thin < SHEET_CELLS * voxel
  const small = 2 * long < SMALL_CELLS * voxel
  return rod || (sheet ? part.area < BIG_SHEET * total : small) || wholePiece(part, total) !== undefined
}

interface Split {
  /** What is fitted as one solid: the largest part, and every other that is neither small, long nor thin. */
  readonly body: Float32Array
  /** The parts that each take one primitive, largest first. */
  readonly limbs: ReadonlyArray<Component>
}

/**
 * The model's parts, sorted into a body and limbs; `voxel` is the size of a cell of the model's grid, in cm. Unless
 * `bodyFirst`, the largest part may be a limb too and the body may be empty: what a model's profiles leave (plates.ts).
 * Undefined when there are no limbs.
 */
export const splitComponents = (triangles: Float32Array, voxel: number, bodyFirst = true): Split | undefined => {
  const parts = componentsOf(triangles)
  if (parts.length < (bodyFirst ? 2 : 1)) return undefined
  const all = parts.map(measured).sort((a, b) => b.area - a.area)
  const total = all.reduce((sum, part) => sum + part.area, 0)
  const body: Array<Float32Array> = [], limbs: Array<Component> = []
  all.forEach((part, rank) => {
    if ((rank > 0 || !bodyFirst) && isLimb(part, total, voxel)) limbs.push(part)
    else body.push(part.triangles)
  })
  return limbs.length === 0 ? undefined : { body: joined(body), limbs }
}

interface BigParts {
  /** One primitive for each part that was given one. */
  readonly pieces: ReadonlyArray<Placement>
  /** The triangles of every other part. */
  readonly rest: Float32Array
}

/**
 * The primitive `pieceOf` gives each of `parts` (the model's separate parts) that it gives one, from the part and the
 * whole surface's area, and the triangles of the others; undefined when it gives none.
 */
export const primitiveParts = (
  parts: ReadonlyArray<Float32Array>,
  pieceOf: (part: Component, total: number) => Placement | undefined
): BigParts | undefined => {
  const all = parts.map(measured)
  const total = all.reduce((sum, part) => sum + part.area, 0)
  const pieces: Array<Placement> = [], left: Array<Float32Array> = []
  for (const part of all) {
    const piece = pieceOf(part, total)
    if (piece === undefined) left.push(part.triangles)
    else pieces.push(piece)
  }
  return pieces.length === 0 ? undefined : { pieces, rest: joined(left) }
}

/**
 * The model's large parts (`WHOLE_MOST` of the surface or more) that each look like one primitive, and what is left:
 * the two halves of a capsule-shaped tower. `wholePiece` leaves these to be fitted in detail, which is usually right;
 * a caller that has the detailed fit can try this beside it and keep whichever looks more like the model.
 */
export const bigParts = (triangles: Float32Array): BigParts | undefined =>
  primitiveParts(
    componentsOf(triangles),
    (part, total) => part.area / total >= WHOLE_MOST ? onePrimitive(part) : undefined
  )
