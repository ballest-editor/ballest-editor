/**
 * A model's symmetries, read off its surface, and the moves that keep a set of pieces symmetric. Every catalog
 * primitive is mirror-symmetric in its own frame (flipping its local x maps it onto itself, shapes.ts), so the mirror
 * image of a placement is another placement: a reflected centre and a reflected turn, the same half sizes.
 *
 * Detection samples the surface by area, then reflects or turns the samples and measures how far they land from the
 * surface (`Surface.nearest`), as a share of the model's radius. Candidate planes and axes come from the surface's
 * principal axes, the world axes and a spread of directions round them, through the centroid or the middle of the
 * box. The best are refined a step at a time against a loss capped per sample, so a part that breaks the symmetry
 * (a fox's legs in a walking pose) weighs no more than a miss and the rest still finds its plane. Each symmetry says
 * how well it holds: overall, per separate part of the mesh, and per sample, so a caller can tie pieces only where it
 * holds.
 */
import type { Vec3 } from "../../coords"
import {
  quatBetween,
  quatDot,
  quatFromAxisAngle,
  quatFromFrame,
  quatMul,
  rotateVec,
  squareTo,
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub
} from "../../ueMath"
import { rotationMatrix } from "../grid/raster"
import { at, pointAt } from "../grid/voxelize"
import { viewFrameOf } from "../look/views"
import { welded } from "../mesh/mesh"
import { Surface } from "../mesh/surface"
import type { Placement } from "../shapes"
import { componentsOf } from "./meshParts"
import { eigen } from "./thinParts"

/** The points p with `normal` · p = `offset`; `normal` unit length. */
export interface Plane {
  readonly normal: Vec3
  readonly offset: number
}

/** The line through `through` along the unit vector `direction`. */
export interface Axis {
  readonly direction: Vec3
  readonly through: Vec3
}

/** Where a symmetry holds, sample by sample. */
export interface Holding {
  /** The surface samples, x, y, z each, cm. */
  readonly points: Float64Array
  /** Per sample, 1 where its image lands on the surface. */
  readonly mask: Uint8Array
  /** Per sample, which separate part of the mesh it lies on (`componentsOf` order). */
  readonly partOf: Uint16Array
  /** Per separate part, the share of its samples that hold. */
  readonly parts: ReadonlyArray<number>
}

interface Measured {
  /** The mean distance from a sample's image to the surface, each capped at `CAP` radii, as a share of the radius. */
  readonly residual: number
  /** The share of the samples whose image lands within `NEAR` radii of the surface. */
  readonly holds: number
  /** The share whose image lands within a quarter of that: exact rather than roughly alike. */
  readonly exact: number
  readonly where: Holding
}

export interface MirrorSymmetry extends Measured {
  readonly kind: "mirror"
  readonly plane: Plane
}

/** A turn of a whole number of `1 / order` turns about `axis`; `round` when it holds for any turn. */
export interface TurnSymmetry extends Measured {
  readonly kind: "turn"
  readonly axis: Axis
  readonly order: number
  readonly round: boolean
}

export type Symmetry = MirrorSymmetry | TurnSymmetry

export interface SymmetryReport {
  /** Half the diagonal of the model's box, cm: what residuals are shares of. */
  readonly radius: number
  /** Best holding first. */
  readonly symmetries: ReadonlyArray<Symmetry>
}

const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 }
const Y_AXIS: Vec3 = { x: 0, y: 1, z: 0 }
const Z_AXIS: Vec3 = { x: 0, y: 0, z: 1 }

// --- motions ------------------------------------------------------------------------------------------------------

/** A rigid motion p ↦ `matrix` p + `shift`, `matrix` row-major orthogonal; `flips` when it reflects. */
export interface Motion {
  readonly matrix: Float64Array
  readonly shift: Vec3
  readonly flips: boolean
}

export const IDENTITY_MOTION: Motion = {
  matrix: Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1),
  shift: { x: 0, y: 0, z: 0 },
  flips: false
}

const applyMatrix = (m: Float64Array, v: Vec3): Vec3 => ({
  x: at(m, 0) * v.x + at(m, 1) * v.y + at(m, 2) * v.z,
  y: at(m, 3) * v.x + at(m, 4) * v.y + at(m, 5) * v.z,
  z: at(m, 6) * v.x + at(m, 7) * v.y + at(m, 8) * v.z
})

const movedPoint = (motion: Motion, point: Vec3): Vec3 => vecAdd(applyMatrix(motion.matrix, point), motion.shift)

/** `a` after `b`. */
const composed = (a: Motion, b: Motion): Motion => {
  const matrix = new Float64Array(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      matrix[3 * r + c] = at(a.matrix, 3 * r) * at(b.matrix, c) + at(a.matrix, 3 * r + 1) * at(b.matrix, 3 + c) +
        at(a.matrix, 3 * r + 2) * at(b.matrix, 6 + c)
    }
  }
  return { matrix, shift: movedPoint(a, b.shift), flips: a.flips !== b.flips }
}

export const mirrorMotion = ({ normal: n, offset }: Plane): Motion => ({
  matrix: Float64Array.of(
    1 - 2 * n.x * n.x,
    -2 * n.x * n.y,
    -2 * n.x * n.z,
    -2 * n.y * n.x,
    1 - 2 * n.y * n.y,
    -2 * n.y * n.z,
    -2 * n.z * n.x,
    -2 * n.z * n.y,
    1 - 2 * n.z * n.z
  ),
  shift: vecScale(n, 2 * offset),
  flips: true
})

export const turnMotion = ({ direction, through }: Axis, angle: number): Motion => {
  const matrix = Float64Array.from(rotationMatrix(quatFromAxisAngle(direction, angle)))
  return { matrix, shift: vecSub(through, applyMatrix(matrix, through)), flips: false }
}

/** One step of a turn of `order` about `axis`. */
const stepMotion = (axis: Axis, order: number): Motion => turnMotion(axis, 2 * Math.PI / order)

/**
 * `placement` moved by `motion`. A reflection would make the piece's frame left-handed; flipping its local x, which
 * every primitive is symmetric in, makes it a turn again, so the half sizes stay as they are.
 */
export const movedPlacement = (motion: Motion, placement: Placement): Placement => {
  if (motion === IDENTITY_MOTION) return placement
  const forward = applyMatrix(motion.matrix, rotateVec(placement.rotation, X_AXIS))
  const up = applyMatrix(motion.matrix, rotateVec(placement.rotation, Z_AXIS))
  return {
    ...placement,
    center: movedPoint(motion, placement.center),
    rotation: quatFromFrame(motion.flips ? vecScale(forward, -1) : forward, up)
  }
}

export const mirrorPoint = (point: Vec3, plane: Plane): Vec3 => movedPoint(mirrorMotion(plane), point)

export const mirrorPlacement = (placement: Placement, plane: Plane): Placement =>
  movedPlacement(mirrorMotion(plane), placement)

// --- sampling the surface -----------------------------------------------------------------------------------------

/** A sample's image within this share of the radius of the surface holds: about a cell of a 64-cell grid. */
const NEAR = 0.02
/** A sample's distance counts at most this share of the radius, so a part that breaks the symmetry costs a miss. */
const CAP = 0.06
const SAMPLES = 1024
const COARSE_SAMPLES = 64
const REFINE_SAMPLES = 192

interface Samples {
  readonly points: Float64Array
  readonly partOf: Uint16Array
  readonly parts: number
}

/** A seeded generator, so a model is always sampled at the same points. */
const randomFrom = (seed: number): () => number => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** The area of each face up to and with itself: the last entry is the whole area. */
const runningAreas = (part: Float32Array): Float64Array => {
  const running = new Float64Array(part.length / 9)
  let sum = 0
  for (let f = 0; f < running.length; f++) {
    const o = 9 * f
    const ux = at(part, o + 3) - at(part, o),
      uy = at(part, o + 4) - at(part, o + 1),
      uz = at(part, o + 5) - at(part, o + 2)
    const vx = at(part, o + 6) - at(part, o),
      vy = at(part, o + 7) - at(part, o + 1),
      vz = at(part, o + 8) - at(part, o + 2)
    sum += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    running[f] = sum
  }
  return running
}

/** The first face whose running area reaches `target`. */
const faceAt = (running: Float64Array, target: number): number => {
  let low = 0, high = running.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (at(running, middle) < target) low = middle + 1
    else high = middle
  }
  return low
}

/** About `count` points on `triangles` spread by area, each part of the mesh at least one. */
const surfaceSamples = (triangles: Float32Array, count: number): Samples => {
  const parts = componentsOf(triangles)
  const running = parts.map(runningAreas)
  const total = running.reduce((sum, list) => sum + at(list, list.length - 1), 0) || 1
  const random = randomFrom(7)
  const points: Array<number> = [], partOf: Array<number> = []
  parts.forEach((part, k) => {
    const list = running[k] ?? new Float64Array()
    const area = at(list, list.length - 1)
    const n = Math.max(1, Math.round(count * area / total))
    // One point in each of `n` equal stretches of the part's area.
    for (let j = 0; j < n; j++) {
      const o = 9 * faceAt(list, (j + random()) / n * area)
      let u = random(), v = random()
      if (u + v > 1) {
        u = 1 - u
        v = 1 - v
      }
      for (let axis = 0; axis < 3; axis++) {
        const a = at(part, o + axis)
        points.push(a + u * (at(part, o + 3 + axis) - a) + v * (at(part, o + 6 + axis) - a))
      }
      partOf.push(k)
    }
  })
  return { points: Float64Array.from(points), partOf: Uint16Array.from(partOf), parts: parts.length }
}

/** Up to `n` of `count` sample indices, evenly spaced. */
const evenly = (count: number, n: number): Array<number> => {
  const step = Math.max(1, Math.floor(count / n))
  const out: Array<number> = []
  for (let i = 0; i < count && out.length < n; i += step) out.push(i)
  return out
}

// --- how well a motion holds --------------------------------------------------------------------------------------

/** The model's surface and samples of it, to try motions against. */
interface Probe {
  readonly radius: number
  readonly samples: Samples
  /** The mean of the samples. */
  readonly centroid: Vec3
  /** Sample indices to rank candidates by, and more to refine them by. */
  readonly coarse: ReadonlyArray<number>
  readonly fine: ReadonlyArray<number>
  /** The mean capped gap over the samples `which`; once it must pass `bound`, something past it. */
  readonly lossOf: (motion: Motion, which: ReadonlyArray<number>, bound?: number) => number
  /** How well every one of `motions` holds, sample by sample: a sample holds when all its images land. */
  readonly measure: (...motions: ReadonlyArray<Motion>) => Measured
}

const probeOf = (triangles: Float32Array): Probe => {
  const radius = viewFrameOf(triangles).radius
  const surface = new Surface(welded(triangles))
  const samples = surfaceSamples(triangles, SAMPLES)
  const { partOf, points } = samples
  const count = partOf.length
  /** How far sample `i` moved by `motion` lands from the surface, as a share of the radius. */
  const gapOf = (motion: Motion, i: number) =>
    Math.sqrt(surface.nearest(movedPoint(motion, pointAt(points, i))).squared) / radius
  const lossOf: Probe["lossOf"] = (motion, which, bound = Infinity) => {
    let sum = 0
    const most = bound * which.length
    for (const i of which) {
      sum += Math.min(CAP, gapOf(motion, i))
      if (sum > most) break
    }
    return sum / which.length
  }
  const measure: Probe["measure"] = (...motions) => {
    const mask = new Uint8Array(count)
    let sum = 0, held = 0, exact = 0
    const partHeld = new Float64Array(samples.parts), partAll = new Float64Array(samples.parts)
    for (let i = 0; i < count; i++) {
      let gap = -Infinity
      for (const motion of motions) gap = Math.max(gap, gapOf(motion, i))
      sum += Math.min(CAP, gap)
      const part = at(partOf, i)
      partAll[part] = at(partAll, part) + 1
      if (gap <= NEAR / 4) exact++
      if (gap <= NEAR) {
        mask[i] = 1
        held++
        partHeld[part] = at(partHeld, part) + 1
      }
    }
    const all = Math.max(1, count)
    return {
      residual: sum / all,
      holds: held / all,
      exact: exact / all,
      where: { points, mask, partOf, parts: Array.from(partAll, (n, k) => n === 0 ? 0 : at(partHeld, k) / n) }
    }
  }
  let sum: Vec3 = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < count; i++) sum = vecAdd(sum, pointAt(points, i))
  const centroid = vecScale(sum, 1 / Math.max(1, count))
  return {
    radius,
    samples,
    centroid,
    coarse: evenly(count, COARSE_SAMPLES),
    fine: evenly(count, REFINE_SAMPLES),
    lossOf,
    measure
  }
}

// --- candidate directions -----------------------------------------------------------------------------------------

/** The principal axes of the samples about their centroid, widest spread first. */
const principalAxes = ({ centroid, samples: { partOf, points } }: Probe): Array<Vec3> => {
  const spread = new Float64Array(9)
  for (let i = 0; i < partOf.length; i++) {
    const d = vecSub(pointAt(points, i), centroid), e = [d.x, d.y, d.z]
    e.forEach((a, r) => e.forEach((b, c) => (spread[3 * r + c] = at(spread, 3 * r + c) + a * b)))
  }
  return eigen([0, 3, 6].map((row) => Array.from(spread.subarray(row, row + 3)))).vectors
}

/** Evenly spread unit directions over a half sphere (the other half are the same planes and axes). */
const halfSphere = (count: number): Array<Vec3> =>
  Array.from({ length: count }, (_, i) => {
    const z = 1 - (i + 0.5) / count, r = Math.sqrt(1 - z * z), phi = i * Math.PI * (3 - Math.sqrt(5))
    return { x: r * Math.cos(phi), y: r * Math.sin(phi), z }
  })

/** Two unit directions square to `u` and to each other. */
const sidesOf = (u: Vec3): readonly [Vec3, Vec3] => {
  const a = squareTo(u)
  return [a, vecCross(u, a)]
}

/** Unit directions square to `u`, `count` of them over half a turn. */
const around = (u: Vec3, count: number): Array<Vec3> => {
  const [a, b] = sidesOf(u)
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI * i / count
    return vecAdd(vecScale(a, Math.cos(angle)), vecScale(b, Math.sin(angle)))
  })
}

/** `u` turned by `angle` toward each of the two directions square to it, either way. */
const tilted = (u: Vec3, angle: number): Array<Vec3> =>
  sidesOf(u).flatMap((side) =>
    [-1, 1].map((sign) => vecNormalize(vecAdd(vecScale(u, Math.cos(angle)), vecScale(side, sign * Math.sin(angle)))))
  )

/** `directions` without those within `within` radians of an earlier one, or of its opposite. */
const distinct = (directions: ReadonlyArray<Vec3>, within: number): Array<Vec3> => {
  const out: Array<Vec3> = []
  for (const d of directions) if (out.every((o) => Math.abs(vecDot(o, d)) < Math.cos(within))) out.push(d)
  return out
}

/** `offsets` without those within a hundredth of the radius of an earlier one. */
const distinctOffsets = (offsets: ReadonlyArray<number>, radius: number): Array<number> => {
  const out: Array<number> = []
  for (const o of offsets) if (out.every((k) => Math.abs(k - o) > 0.01 * radius)) out.push(o)
  return out
}

/** Where candidate planes and axes lie. */
interface Candidates {
  /** The principal and world axes. */
  readonly main: ReadonlyArray<Vec3>
  /** Those, and a spread over the half sphere. */
  readonly directions: ReadonlyArray<Vec3>
  /** Points a plane or axis may pass through: the centroid, and the middle of the model's box. */
  readonly middles: ReadonlyArray<Vec3>
}

const candidatesOf = (triangles: Float32Array, probe: Probe): Candidates => {
  const [x, y, z] = viewFrameOf(triangles).centre
  const main = distinct([...principalAxes(probe), X_AXIS, Y_AXIS, Z_AXIS], 0.02)
  return { main, directions: distinct([...main, ...halfSphere(48)], 0.05), middles: [probe.centroid, { x, y, z }] }
}

// --- detection ----------------------------------------------------------------------------------------------------

/** Candidate planes and axes refined, of each kind. */
const REFINED = 6
/** Turn orders tried. */
const ORDERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
/** Turns that hold for all of these orders, which no finite symmetry below their product has, are round. */
const ROUND_ORDERS = [7, 11, 13] as const
/** The order a round symmetry ties pieces by. */
const ROUND_ORDER = 12
/** A symmetry is reported when at least this share of the surface holds. */
const REPORTED = 0.3

interface Ranked<A> {
  readonly shape: A
  readonly loss: number
}

/** The `n` of `candidates` with the least loss, none the `same` as one before it. Sorts `candidates`. */
const strongest = <A>(candidates: Array<Ranked<A>>, same: (a: A, b: A) => boolean, n: number): Array<A> => {
  candidates.sort((a, b) => a.loss - b.loss)
  const out: Array<A> = []
  for (const { loss, shape } of candidates) {
    // Past half the cap, most samples miss: nothing to refine.
    if (out.length >= n || loss > CAP / 2) break
    if (out.every((o) => !same(o, shape))) out.push(shape)
  }
  return out
}

/**
 * `start` after coordinate descent: of the `moves` of the shape by an angle and a shift, the one whose loss over the
 * finer samples is least is taken while one lowers it, and the angle and shift halve when none does.
 */
const refined = <A>(
  probe: Probe,
  start: A,
  motionOf: (shape: A) => Motion,
  moves: (shape: A, angle: number, shift: number) => Array<A>
): A => {
  let shape = start, loss = probe.lossOf(motionOf(start), probe.fine)
  let angle = 0.03, shift = 0.015 * probe.radius
  while (angle > 0.004) {
    let best: A | undefined
    for (const trial of moves(shape, angle, shift)) {
      const found = probe.lossOf(motionOf(trial), probe.fine, loss)
      if (found < loss - 1e-6) {
        loss = found
        best = trial
      }
    }
    if (best === undefined) {
      angle /= 2
      shift /= 2
    } else {
      shape = best
    }
  }
  return shape
}

/** The model's mirror planes: every candidate normal through either middle, the strongest refined. */
const mirrorsOf = (probe: Probe, { directions, main, middles }: Candidates): Array<MirrorSymmetry> => {
  const { centroid, radius } = probe
  const normals = distinct([...directions, ...main.flatMap((u) => around(u, 30))], 0.03)
  const planes: Array<Ranked<Plane>> = normals.flatMap((normal) =>
    distinctOffsets(middles.map((m) => vecDot(normal, m)), radius).map((offset) => {
      const plane = { normal, offset }
      return { shape: plane, loss: probe.lossOf(mirrorMotion(plane), probe.coarse, CAP / 2) }
    })
  )
  const samePlane = (a: Plane, b: Plane) =>
    Math.abs(vecDot(a.normal, b.normal)) > Math.cos(0.08) &&
    Math.abs(a.offset - Math.sign(vecDot(a.normal, b.normal)) * b.offset) < 0.05 * radius
  // A plane tilts about the point of it nearest the centroid, and shifts along its normal.
  const movesOf = (plane: Plane, angle: number, shift: number): Array<Plane> => {
    const pivot = vecSub(centroid, vecScale(plane.normal, vecDot(plane.normal, centroid) - plane.offset))
    return [
      ...tilted(plane.normal, angle).map((normal) => ({ normal, offset: vecDot(normal, pivot) })),
      { normal: plane.normal, offset: plane.offset + shift },
      { normal: plane.normal, offset: plane.offset - shift }
    ]
  }
  const mirrors: Array<MirrorSymmetry> = []
  for (const start of strongest(planes, samePlane, REFINED)) {
    const plane = refined(probe, start, mirrorMotion, movesOf)
    if (mirrors.some((m) => samePlane(m.plane, plane))) continue
    mirrors.push({ kind: "mirror", plane, ...probe.measure(mirrorMotion(plane)) })
  }
  return mirrors
}

interface Turn {
  readonly axis: Axis
  readonly order: number
}

/** The order that holds best about `axis` on the coarse samples. */
const bestOrder = (probe: Probe, axis: Axis): Ranked<Turn> | undefined => {
  let best: Ranked<Turn> | undefined
  for (const order of ORDERS) {
    const loss = probe.lossOf(stepMotion(axis, order), probe.coarse, Math.min(CAP / 2, best?.loss ?? Infinity))
    if (best === undefined || loss < best.loss) best = { shape: { axis, order }, loss }
  }
  return best
}

/** An axis tilts either way, and shifts either way across itself. */
const turnMoves = ({ axis, order }: Turn, angle: number, shift: number): Array<Turn> => [
  ...tilted(axis.direction, angle).map((direction) => ({ axis: { ...axis, direction }, order })),
  ...sidesOf(axis.direction).flatMap((side) =>
    [-1, 1].map((sign) => ({ axis: { ...axis, through: vecAdd(axis.through, vecScale(side, sign * shift)) }, order }))
  )
]

/**
 * The turn symmetries about a refined `axis`: the one of the order that holds best, or the largest order that holds
 * as well, so a five-fold star is not two-fold. Where that isn't round, a second one for the part of the model that
 * is round about the same axis (a mushroom's cap over its feet), if enough of it is.
 */
const turnsAbout = (probe: Probe, axis: Axis): Array<TurnSymmetry> => {
  const losses = new Map<number, number>(
    [...ORDERS, ...ROUND_ORDERS].map((order) => [order, probe.lossOf(stepMotion(axis, order), probe.fine)])
  )
  const least = Math.min(...ORDERS.map((order) => losses.get(order) ?? Infinity))
  const good = (order: number) => (losses.get(order) ?? Infinity) <= Math.max(1.25 * least, least + 0.002)
  const round = ROUND_ORDERS.every(good)
  const order = round ? ROUND_ORDER : Math.max(...ORDERS.filter(good))
  const whole: TurnSymmetry = { kind: "turn", axis, order, round, ...probe.measure(stepMotion(axis, order)) }
  if (round) return [whole]
  const roundPart = probe.measure(...ROUND_ORDERS.map((n) => stepMotion(axis, n)))
  return roundPart.holds < REPORTED
    ? [whole]
    : [whole, { kind: "turn", axis, order: ROUND_ORDER, round: true, ...roundPart }]
}

/** The model's turn symmetries: every candidate axis through either middle at its best order, the strongest refined. */
const turnsOf = (probe: Probe, { directions, middles }: Candidates): Array<TurnSymmetry> => {
  const candidates = directions.flatMap((direction) =>
    middles.flatMap((through) => bestOrder(probe, { direction, through }) ?? [])
  )
  const sameAxis = (a: Axis, b: Axis) => {
    if (Math.abs(vecDot(a.direction, b.direction)) < Math.cos(0.08)) return false
    const d = vecSub(a.through, b.through)
    return vecLength(vecSub(d, vecScale(a.direction, vecDot(d, a.direction)))) < 0.05 * probe.radius
  }
  const turns: Array<TurnSymmetry> = []
  for (const start of strongest(candidates, (a, b) => sameAxis(a.axis, b.axis), REFINED)) {
    const { axis } = refined(probe, start, (turn) => stepMotion(turn.axis, turn.order), turnMoves)
    if (turns.some((t) => sameAxis(t.axis, axis))) continue
    turns.push(...turnsAbout(probe, axis))
  }
  return turns
}

/** The model's mirror planes and turn symmetries. */
export const symmetriesOf = (triangles: Float32Array): SymmetryReport => {
  const probe = probeOf(triangles)
  const candidates = candidatesOf(triangles, probe)
  const symmetries = [...mirrorsOf(probe, candidates), ...turnsOf(probe, candidates)]
    .filter((s) => s.holds >= REPORTED)
    .sort((a, b) => b.holds - a.holds || a.residual - b.residual)
  return { radius: probe.radius, symmetries }
}

/** A symmetry ties pieces when at least this share of the surface holds, and at least half of that exactly. */
const TIES = 0.85
const TIES_EXACT = 0.5
/** A turn of higher order is preferred to one holding at most this share more. */
const TURN_WITHIN = 0.05

/**
 * The symmetries worth tying pieces by, in the order `tyingOf` takes them: the turn of highest order among those that
 * hold about as well as the best turn, then the mirrors, best holding first.
 */
export const chosenSymmetries = (report: SymmetryReport): Array<Symmetry> => {
  const strong = report.symmetries.filter((s) => s.holds >= TIES && s.exact >= TIES_EXACT * s.holds)
  const turns = strong.filter((s) => s.kind === "turn")
  const best = Math.max(...turns.map((t) => t.holds))
  const turn =
    turns.filter((t) => t.holds >= best - TURN_WITHIN).sort((a, b) => b.order - a.order || b.holds - a.holds)[0]
  const mirrors = strong.filter((s) => s.kind === "mirror")
  return turn === undefined ? mirrors : [turn, ...mirrors]
}

// --- groups of motions --------------------------------------------------------------------------------------------

/** The most motions a group may have. */
const MAX_GROUP = 48

const sameMotion = (a: Motion, b: Motion, scale: number): boolean => {
  if (a.flips !== b.flips) return false
  for (let k = 0; k < 9; k++) if (Math.abs(at(a.matrix, k) - at(b.matrix, k)) > 1e-6) return false
  return vecLength(vecSub(a.shift, b.shift)) <= 1e-6 * scale
}

/** Every motion `generators` make, the identity first; undefined past `MAX_GROUP`. */
const closure = (generators: ReadonlyArray<Motion>, scale: number): Array<Motion> | undefined => {
  const out: Array<Motion> = [IDENTITY_MOTION]
  // `out` grows as it is walked: each new motion is composed with the generators in its turn.
  for (const made of out) {
    for (const generator of generators) {
      const next = composed(generator, made)
      if (out.some((m) => sameMotion(m, next, scale))) continue
      out.push(next)
      if (out.length > MAX_GROUP) return undefined
    }
  }
  return out
}

/** A generator kept for a group: its motion, and where it holds. */
interface Generator {
  readonly motion: Motion
  readonly where: Holding
}

/** A mirror within this angle of lying along a turn's axis, or across it, or square to another mirror, is made so. */
const NEARLY = 0.15

/**
 * `plane` made to agree with a turn about `axis`: one nearly across the axis is put exactly across it, one nearly
 * holding the axis is put exactly through it. `normals` are those of the mirrors kept; one of each sort is enough,
 * and a plane at any other angle makes no finite group with the turn, so those are undefined.
 */
const planeBesideTurn = (plane: Plane, { direction, through }: Axis, normals: ReadonlyArray<Vec3>) => {
  const along = vecDot(plane.normal, direction)
  if (Math.abs(along) > Math.cos(NEARLY)) {
    const normal = vecScale(direction, Math.sign(along))
    return normals.some((n) => Math.abs(vecDot(n, normal)) > 0.5) ? undefined : { normal, offset: plane.offset }
  }
  if (Math.abs(along) < Math.sin(NEARLY)) {
    const normal = vecNormalize(vecSub(plane.normal, vecScale(direction, along)))
    return normals.some((n) => Math.abs(vecDot(n, direction)) < 0.5)
      ? undefined
      : { normal, offset: vecDot(normal, through) }
  }
  return undefined
}

/** `plane` made exactly square to the mirrors kept, by their `normals`; undefined unless it nearly is. */
const planeBesideMirrors = (plane: Plane, normals: ReadonlyArray<Vec3>): Plane | undefined => {
  if (normals.some((n) => Math.abs(vecDot(n, plane.normal)) > Math.sin(NEARLY))) return undefined
  // Gram-Schmidt.
  const normal = normals.reduce((v, n) => vecNormalize(vecSub(v, vecScale(n, vecDot(v, n)))), plane.normal)
  return { normal, offset: plane.offset }
}

/**
 * `symmetries` made to agree with each other, so together they make a finite group: the first turn is kept; a mirror
 * nearly along or across its axis is made exactly so; mirrors without a turn are kept when nearly square to each other.
 * Others are left out. The best holding should come first.
 */
const generatorsOf = (symmetries: ReadonlyArray<Symmetry>, scale: number): Array<Generator> => {
  const turn = symmetries.find((s) => s.kind === "turn")
  const out: Array<Generator> = turn === undefined
    ? []
    : [{ motion: stepMotion(turn.axis, turn.order), where: turn.where }]
  const normals: Array<Vec3> = []
  for (const s of symmetries) {
    if (s.kind !== "mirror") continue
    const plane = turn === undefined
      ? planeBesideMirrors(s.plane, normals)
      : planeBesideTurn(s.plane, turn.axis, normals)
    if (plane === undefined) continue
    const candidate = { motion: mirrorMotion(plane), where: s.where }
    if (closure([...out, candidate].map((g) => g.motion), scale) === undefined) continue
    normals.push(plane.normal)
    out.push(candidate)
  }
  return out
}

// --- how far apart two pieces are ---------------------------------------------------------------------------------

type Kind = Placement["kind"]

const halfOf = (p: Placement): number => Math.max(p.half.x, p.half.y, p.half.z)

/** Pieces that point one way along their own z: the rest are symmetric across their middle in z. */
const pointsUp = (kind: Kind): boolean => kind === "cone" || kind === "pyramid" || kind === "hemisphere"

/** Whether the piece looks the same however it is turned about its own z. */
const roundAboutZ = (p: Placement): boolean =>
  (p.kind === "cylinder" || p.kind === "cone" || p.kind === "sphere" || p.kind === "hemisphere" ||
    p.kind === "capsule") &&
  Math.abs(p.half.x - p.half.y) <= 1e-9 * Math.max(1, halfOf(p))

/** A tip at the top and four points round the base. */
const POINTED: ReadonlyArray<Vec3> = [
  Z_AXIS,
  { x: 1, y: 0, z: -1 },
  { x: -1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: 0, y: -1, z: -1 }
]

/** Points of each unit shape, in its own box, that are where they are only when the shape is. */
const KEY_POINTS: Readonly<Record<Kind, ReadonlyArray<Vec3>>> = {
  box: Array.from({ length: 8 }, (_, i) => ({ x: i & 1 ? 1 : -1, y: i & 2 ? 1 : -1, z: i & 4 ? 1 : -1 })),
  sphere: [X_AXIS, { x: -1, y: 0, z: 0 }, Y_AXIS, { x: 0, y: -1, z: 0 }, Z_AXIS, { x: 0, y: 0, z: -1 }],
  cylinder: [-1, 1].flatMap((z) => [{ x: 1, y: 0, z }, { x: -1, y: 0, z }, { x: 0, y: 1, z }, { x: 0, y: -1, z }]),
  cone: POINTED,
  pyramid: POINTED,
  hemisphere: POINTED,
  capsule: [Z_AXIS, { x: 0, y: 0, z: -1 }, ...[-0.5, 0.5].flatMap((z) => [{ x: 1, y: 0, z }, { x: 0, y: 1, z }])]
}

const keyPoints = (p: Placement): Array<Vec3> =>
  KEY_POINTS[p.kind].map((k) =>
    vecAdd(p.center, rotateVec(p.rotation, { x: k.x * p.half.x, y: k.y * p.half.y, z: k.z * p.half.z }))
  )

/** How far apart two placements' shapes are, in cm: zero when they cover the same space. */
export const shapeGap = (a: Placement, b: Placement): number => {
  if (a.kind !== b.kind) return Infinity
  const halves = Math.max(
    Math.abs(a.half.x - b.half.x),
    Math.abs(a.half.y - b.half.y),
    Math.abs(a.half.z - b.half.z)
  )
  if (roundAboutZ(a) && roundAboutZ(b)) {
    // Round pieces cover the same space whatever their turn about z: only where z points counts, or nothing for a ball.
    const centres = vecLength(vecSub(a.center, b.center))
    if (a.kind === "sphere" && Math.abs(a.half.z - a.half.x) <= 1e-9 * Math.max(1, halfOf(a))) {
      return Math.max(halves, centres)
    }
    const za = rotateVec(a.rotation, Z_AXIS), zb = rotateVec(b.rotation, Z_AXIS)
    const tilt = pointsUp(a.kind)
      ? vecLength(vecSub(za, zb))
      : Math.min(vecLength(vecSub(za, zb)), vecLength(vecAdd(za, zb)))
    return Math.max(halves, centres, tilt * Math.max(a.half.z, a.half.x))
  }
  const pb = keyPoints(b)
  let gap = halves
  for (const p of keyPoints(a)) gap = Math.max(gap, Math.min(...pb.map((q) => vecLength(vecSub(p, q)))))
  return gap
}

// --- a piece that stays put ---------------------------------------------------------------------------------------

/** A motion's kind: a reflection in a plane, a turn by `angle` about a direction, or something else. */
type Classified =
  | { readonly kind: "mirror"; readonly normal: Vec3 }
  | { readonly kind: "turn"; readonly direction: Vec3; readonly angle: number }
  | { readonly kind: "other" }

/** The longest column of (1 + `sign` · m) / 2, unit length: u, where that matrix is u uᵀ. */
const longestColumn = (m: Float64Array, sign: number): Vec3 => {
  let best: Vec3 = X_AXIS, length = -1
  for (let c = 0; c < 3; c++) {
    const v = {
      x: ((c === 0 ? 1 : 0) + sign * at(m, c)) / 2,
      y: ((c === 1 ? 1 : 0) + sign * at(m, 3 + c)) / 2,
      z: ((c === 2 ? 1 : 0) + sign * at(m, 6 + c)) / 2
    }
    if (vecLength(v) > length) {
      length = vecLength(v)
      best = v
    }
  }
  return vecNormalize(best)
}

const classified = ({ flips, matrix: m }: Motion): Classified => {
  const trace = at(m, 0) + at(m, 4) + at(m, 8)
  if (flips) return Math.abs(trace - 1) < 1e-6 ? { kind: "mirror", normal: longestColumn(m, -1) } : { kind: "other" }
  const angle = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)))
  if (angle < 1e-6) return { kind: "other" }
  // A half turn's matrix is symmetric, so its axis can't be read off the matrix's skew part.
  const direction = Math.sin(angle) > 1e-4
    ? vecNormalize({ x: at(m, 7) - at(m, 5), y: at(m, 2) - at(m, 6), z: at(m, 3) - at(m, 1) })
    : longestColumn(m, 1)
  return { kind: "turn", direction, angle }
}

/** The least k with k turns of `angle` a whole number of turns; 0 when there is none up to `MAX_GROUP`. */
const orderOf = (angle: number): number => {
  for (let k = 2; k <= MAX_GROUP; k++) {
    const turns = k * angle / (2 * Math.PI)
    if (Math.abs(turns - Math.round(turns)) < 1e-6) return k
  }
  return 0
}

const LOCAL = { x: X_AXIS, y: Y_AXIS, z: Z_AXIS } as const

/** `p` turned the least way that takes one of its own axes `which` onto ±`target`: the first of those nearest it. */
const alignedTo = (p: Placement, which: ReadonlyArray<keyof typeof LOCAL>, target: Vec3): Placement => {
  let nearest: Vec3 | undefined, most = -1, toward = 0
  for (const key of which) {
    const axis = rotateVec(p.rotation, LOCAL[key]), d = vecDot(axis, target)
    if (Math.abs(d) <= most) continue
    most = Math.abs(d)
    nearest = axis
    toward = d
  }
  if (nearest === undefined) return p
  return { ...p, rotation: quatMul(quatBetween(nearest, vecScale(target, Math.sign(toward) || 1)), p.rotation) }
}

/** `p` squared to a mirror plane with unit `normal`: an axis it is symmetric across along the normal. */
const squaredTo = (p: Placement, normal: Vec3): Placement => {
  const flat = alignedTo(p, pointsUp(p.kind) ? ["x", "y"] : ["x", "y", "z"], normal)
  if (!roundAboutZ(p)) return flat
  // A round piece may instead lie in the plane, its axis square to the normal: whichever turns it less.
  const z = rotateVec(p.rotation, Z_AXIS), inPlane = vecSub(z, vecScale(normal, vecDot(z, normal)))
  if (vecLength(inPlane) < 1e-9) return flat
  const lying = { ...p, rotation: quatMul(quatBetween(z, vecNormalize(inPlane)), p.rotation) }
  const nearness = (q: Placement) => Math.abs(quatDot(q.rotation, p.rotation))
  return nearness(lying) > nearness(flat) ? lying : flat
}

/** `p` lined up on a turn of order `order` about `direction`, or undefined when its kind can't be. */
const linedUp = (p: Placement, direction: Vec3, order: number): Placement | undefined => {
  if (order === 2) return alignedTo(p, pointsUp(p.kind) ? ["z"] : ["x", "y", "z"], direction)
  // Past a half turn the piece's own z lies along the axis and its sides are equal; a square one takes quarter turns.
  if ((p.kind === "box" || p.kind === "pyramid") && order !== 4) return undefined
  const along = alignedTo(p, ["z"], direction)
  const side = (p.half.x + p.half.y) / 2
  return { ...along, half: { ...along.half, x: side, y: side } }
}

/** `p` squared to or lined up on what `motion` fixes; undefined when its kind can't be. */
const settledUnder = (p: Placement, motion: Motion): Placement | undefined => {
  const found = classified(motion)
  if (found.kind === "mirror") return squaredTo(p, found.normal)
  return found.kind === "turn" ? linedUp(p, found.direction, orderOf(found.angle)) : p
}

/** Passes over a stabilizer's motions, each of which may undo a little of what the one before settled. */
const SNAP_ROUNDS = 4

/**
 * `p` made to stay where it is under every motion of `stabilizer`, a group without its identity: its centre on what
 * they all fix, its axes square to their planes and along their axes, its sides equal where a turn needs them to be.
 * Undefined when its kind can't be (a box on a five-fold axis).
 */
export const snappedTo = (p: Placement, stabilizer: ReadonlyArray<Motion>): Placement | undefined => {
  if (stabilizer.length === 0) return p
  // The mean of the centre's images is fixed by the whole group.
  const sum = stabilizer.reduce((s, m) => vecAdd(s, movedPoint(m, p.center)), p.center)
  let out: Placement = { ...p, center: vecScale(sum, 1 / (stabilizer.length + 1)) }
  for (let round = 0; round < SNAP_ROUNDS; round++) {
    for (const motion of stabilizer) {
      const settled = settledUnder(out, motion)
      if (settled === undefined) return undefined
      out = settled
    }
  }
  const size = Math.max(1e-6, halfOf(out))
  const snapped = out
  return stabilizer.every((m) => shapeGap(movedPlacement(m, snapped), snapped) <= 1e-5 * size) ? snapped : undefined
}

// --- symmetric sets of pieces -------------------------------------------------------------------------------------

/** A piece holds a generator when at least half the surface near it does. */
const HOLDS_AT = 0.5
/** "Near" is within the piece's reach, or the nearest this many samples when fewer are that close. */
const NEAREST = 4

/** The share of `where`'s samples within `reach` of `point` that hold; the nearest few when fewer are that close. */
const holdsNear = ({ mask, points }: Holding, point: Vec3, reach: number): number => {
  let inside = 0, held = 0
  /** The nearest samples so far, nearest first, the earlier of two as near first. */
  const nearest: Array<{ readonly d: number; readonly i: number }> = []
  for (let i = 0; i < mask.length; i++) {
    const d = vecLength(vecSub(pointAt(points, i), point))
    if (d <= reach) {
      inside++
      held += at(mask, i)
    }
    if (nearest.length === NEAREST && !(d < (nearest[NEAREST - 1]?.d ?? Infinity))) continue
    const place = nearest.findIndex((n) => n.d > d)
    nearest.splice(place === -1 ? nearest.length : place, 0, { d, i })
    if (nearest.length > NEAREST) nearest.pop()
  }
  if (inside >= NEAREST) return held / inside
  return nearest.length === 0 ? 0 : nearest.reduce((s, { i }) => s + at(mask, i), 0) / nearest.length
}

/** What `symmetrized` works from, built once per set of symmetries. */
interface Tying {
  /** Every motion the symmetries make together, the identity first. */
  readonly group: ReadonlyArray<Motion>
  /** The model's radius, cm: what counts as the same place is a share of it. */
  readonly scale: number
  /** The group a piece is tied by: that of the generators that hold where it is. */
  readonly groupAt: (p: Placement) => ReadonlyArray<Motion>
}

export const tyingOf = (symmetries: ReadonlyArray<Symmetry>, scale: number): Tying => {
  const generators = generatorsOf(symmetries, scale)
  /** The group of each subset of the generators asked for, by the subset's bits. */
  const groups = new Map<number, ReadonlyArray<Motion>>()
  const groupOf = (bits: number): ReadonlyArray<Motion> => {
    const known = groups.get(bits)
    if (known !== undefined) return known
    const made = closure(generators.filter((_, k) => (bits >> k) & 1).map((g) => g.motion), scale) ?? [IDENTITY_MOTION]
    groups.set(bits, made)
    return made
  }
  return {
    group: groupOf((1 << generators.length) - 1),
    scale,
    groupAt: (p) =>
      groupOf(generators.reduce(
        (bits, g, k) => holdsNear(g.where, p.center, halfOf(p)) >= HOLDS_AT ? bits | (1 << k) : bits,
        0
      ))
  }
}

/** Points to keep the pieces round: the most generic piece centre and its images, one per part of the space. */
export const seedsOf = (placements: ReadonlyArray<Placement>, { group, scale }: Tying): Array<Vec3> => {
  const moved = group.slice(1)
  // A centre is generic when its images are far from it, and counts for more on a big piece.
  let seed: Vec3 = { x: 0.1234 * scale, y: 0.3456 * scale, z: 0.5678 * scale }, most = -1
  for (const p of placements) {
    const least = Math.min(...moved.map((m) => vecLength(vecSub(movedPoint(m, p.center), p.center))))
    const generic = least * Math.cbrt(p.half.x * p.half.y * p.half.z)
    if (generic > most) {
      most = generic
      seed = p.center
    }
  }
  return group.map((m) => movedPoint(m, seed))
}

/** A piece and its images: each member is `movedPlacement(motion, piece)`, the identity first. */
export interface Orbit {
  readonly piece: Placement
  readonly motions: ReadonlyArray<Motion>
  /** The motions that leave `piece` where it is (on a mirror plane, on a turn's axis), without the identity. */
  readonly stabilizer: ReadonlyArray<Motion>
}

export const membersOf = (orbit: Orbit): Array<Placement> =>
  orbit.motions.map((motion) => movedPlacement(motion, orbit.piece))

export interface Symmetrized {
  readonly placements: ReadonlyArray<Placement>
  readonly orbits: ReadonlyArray<Orbit>
}

const alone = (piece: Placement): Orbit => ({ piece, motions: [IDENTITY_MOTION], stabilizer: [] })

/** How far a placement's box reaches from its centre along the unit vector `v`. */
const supportAlong = ({ half, rotation }: Placement, v: Vec3): number =>
  Math.abs(vecDot(rotateVec(rotation, X_AXIS), v)) * half.x +
  Math.abs(vecDot(rotateVec(rotation, Y_AXIS), v)) * half.y +
  Math.abs(vecDot(rotateVec(rotation, Z_AXIS), v)) * half.z

/** Whether the piece's image under `motion` overlaps it: it straddles the motion's plane or axis. */
const straddles = (p: Placement, motion: Motion): boolean => {
  const shift = vecSub(movedPoint(motion, p.center), p.center), length = vecLength(shift)
  return length < 1e-9 || length <= supportAlong(p, vecScale(shift, 1 / length))
}

/**
 * `original` snapped onto the planes and axes of `group` it straddles, with the motions that then leave it where it
 * is; as it is, with none, when it straddles nothing. Undefined when it can't be made to stay put.
 */
const settled = (original: Placement, group: ReadonlyArray<Motion>, scale: number) => {
  const straddled = group.slice(1).filter((m) => straddles(original, m))
  if (straddled.length === 0) return { piece: original, stabilizer: [] }
  const stabilizer = closure(straddled, scale)?.slice(1) ?? []
  const piece = snappedTo(original, stabilizer)
  return piece === undefined ? undefined : { piece, stabilizer }
}

/** The motions of `group` that give `piece` images covering different space, the identity first. */
const distinctImages = (piece: Placement, group: ReadonlyArray<Motion>): Array<Motion> => {
  const size = Math.max(1e-6, halfOf(piece))
  const motions: Array<Motion> = [], members: Array<Placement> = []
  for (const motion of group) {
    const image = movedPlacement(motion, piece)
    if (members.some((q) => shapeGap(q, image) <= 1e-5 * size)) continue
    members.push(image)
    motions.push(motion)
  }
  return motions
}

/**
 * The pieces of one part of the space (the half on one side of a mirror, one sector of a turn: the points nearer
 * `seed` than any image of it) with their images; a piece the symmetry nearly leaves in place, straddling a plane or
 * an axis, is snapped onto it instead of doubled. Pieces where the symmetry does not hold stay as they are.
 */
export const symmetrized = (placements: ReadonlyArray<Placement>, tying: Tying, seed?: Vec3): Symmetrized => {
  const { scale } = tying
  const x0 = seed ?? seedsOf(placements, tying)[0] ?? { x: 0, y: 0, z: 0 }
  const orbits: Array<Orbit> = []
  for (const original of placements) {
    const group = tying.groupAt(original)
    const found = group.length === 1 ? undefined : settled(original, group, scale)
    if (found === undefined) {
      // No symmetry holds here, or the piece can't be made to stay put (a box on a five-fold axis): it stays, alone.
      orbits.push(alone(original))
      continue
    }
    const { piece, stabilizer } = found
    const toSeed = vecLength(vecSub(piece.center, x0))
    const inside = group.every((m) => toSeed <= vecLength(vecSub(piece.center, movedPoint(m, x0))) + 1e-6 * scale)
    if (inside) orbits.push({ piece, motions: distinctImages(piece, group), stabilizer })
  }
  return { placements: orbits.flatMap(membersOf), orbits }
}
