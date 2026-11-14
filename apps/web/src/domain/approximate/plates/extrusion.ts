/**
 * Prismatic models as extrusions. A model that is a profile swept along an axis (a barrel, a disk, a beam) is cut
 * into slices across the axis, and runs of slices with the same cross-section become sections (a barrel's body, its
 * raised rings, its ends). Each section's profile is covered with rectangles and ellipses, and each of those, extruded
 * the section's length, is one piece: a box, or a cylinder lying along the axis. A D-shaped profile comes out as about
 * one rectangle and one ellipse, so its curved side is a real cylinder rather than strips.
 *
 * Pieces go where a section's profile has the most left uncovered, measured as volume, until the budget is spent or
 * every section is covered to within `SECTION_DONE`; finishing well under the budget is fine.
 */
import type { Vec3 } from "../../coords"
import { quatFromFrame, vecAdd, vecCross, vecDot, vecNormalize, vecScale } from "../../ueMath"
import { at, type Box3, gridOver, trianglesBox, type VoxelGrid, voxelize } from "../grid/voxelize"
import { eigen } from "../parts/thinParts"
import type { Placement } from "../shapes"

/** A face within this many degrees of square to an axis runs along it; within it of the axis, it is an end. */
const SWEEP_DEGREES = 10

/** The share of the surface that must run along an axis or lie in its flat ends for the model to be swept along it. */
export const SWEEP_SHARE = 0.85

/** Two likely sweep axes within this many degrees of each other are one. */
const SAME_AXIS_DEGREES = 5

/** Pixels across the profile's wider side. */
const PROFILE_PIXELS = 96

/** Most slices along the axis. */
const MOST_SLICES = 400

/** A slice whose profile differs from its section's first by more than this share of the larger starts a new one. */
const SECTION_CHANGE = 0.06

/** How far, in pixels, a shape may reach past the profile: the face tolerance. */
const REACH = 1

/** A section is covered once less than this share of its profile is left. */
const SECTION_DONE = 0.01

/**
 * The least share of its section's profile a piece must newly cover, one cover for each: past the first, small pieces
 * fill slivers at the edge and scallop the outline, so each model gets the choice.
 */
const LEAST_GAINS = [0, 0.02, 0.04, 0.08]

/** What a newly covered pixel on the profile's edge counts over one inside: shapes that follow the outline win. */
const EDGE_WEIGHT = 4

/** What a pixel past the profile, within reach, costs against one newly covered: it only breaks ties. */
const PAST_COST = 0.1

/** Shapes started per step, from the deepest uncovered pixels. */
const SEEDS = 8

/** The steps a shape is moved by, in pixels, largest first, and the most rounds of moves at each. */
const MOVE_STEPS = [8, 4, 2, 1, 0.5]
const MOVE_ROUNDS = 60

/** Turn per pixel of a move's step, radians. */
const TURN_STEP = Math.PI / 90

/** Pixels a shape gives back on each side for the surface slices' width. */
const TRIM = 0.5

const radians = (degrees: number) => degrees * Math.PI / 180

/** What one axis scores on the sweep test. */
export interface SweepTest {
  readonly axis: Vec3
  /** The share of the surface whose faces run along the axis. */
  readonly along: number
  /** The share in faces square to it: the ends and the steps between sections. */
  readonly ends: number
}

export const sweepShare = (test: SweepTest): number => test.along + test.ends

type Matrix = Array<Array<number>>

const zeroMatrix = (): Matrix => [[0, 0, 0], [0, 0, 0], [0, 0, 0]]

/** Adds `weight` times the outer product of `e` with itself to the 3 × 3 matrix `m`. */
const addOuter = (m: Matrix, e: Vec3, weight: number) => {
  const parts = [e.x, e.y, e.z]
  m.forEach((row, i) => {
    for (let j = 0; j < 3; j++) row[j] = (row[j] ?? 0) + weight * (parts[i] ?? 0) * (parts[j] ?? 0)
  })
}

/**
 * Calls `each` on every triangle with the cross product of two of its edges, which lies along its normal, and that
 * vector's length, twice the triangle's area: 0 for a triangle with no area.
 */
export const forEachFace = (triangles: Float32Array, each: (cross: Vec3, length: number) => void): void => {
  for (let t = 0; t + 8 < triangles.length; t += 9) {
    const a = { x: at(triangles, t), y: at(triangles, t + 1), z: at(triangles, t + 2) }
    const cross = vecCross(
      { x: at(triangles, t + 3) - a.x, y: at(triangles, t + 4) - a.y, z: at(triangles, t + 5) - a.z },
      { x: at(triangles, t + 6) - a.x, y: at(triangles, t + 7) - a.y, z: at(triangles, t + 8) - a.z }
    )
    each(cross, Math.hypot(cross.x, cross.y, cross.z))
  }
}

interface Face {
  readonly normal: Vec3
  readonly area: number
}

/** The model's faces that have an area. */
const facesOf = (triangles: Float32Array): Array<Face> => {
  const faces: Array<Face> = []
  forEachFace(triangles, (cross, length) => {
    const area = length / 2
    if (area !== 0) faces.push({ normal: vecScale(cross, 0.5 / area), area })
  })
  return faces
}

/**
 * The axes a model may be swept along: the principal directions of its faces' normals, the one most face area is
 * square to first, and then the model's own three axes, less the ones close to an earlier one.
 */
const likelyAxes = (faces: ReadonlyArray<Face>): Array<Vec3> => {
  const m = zeroMatrix()
  for (const { area, normal } of faces) addOuter(m, normal, area)
  const same = Math.cos(radians(SAME_AXIS_DEGREES))
  const axes: Array<Vec3> = []
  for (
    const axis of [...eigen(m).vectors.toReversed(), { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
  ) {
    if (!axes.some((other) => Math.abs(vecDot(other, axis)) > same)) axes.push(vecNormalize(axis))
  }
  return axes
}

/** The sweep test on each likely axis, best first. */
export const sweepTests = (triangles: Float32Array): Array<SweepTest> => {
  const faces = facesOf(triangles)
  const total = Math.max(1e-9, faces.reduce((sum, face) => sum + face.area, 0))
  const side = Math.sin(radians(SWEEP_DEGREES)), end = Math.cos(radians(SWEEP_DEGREES))
  return likelyAxes(faces).map((axis): SweepTest => {
    let along = 0, ends = 0
    for (const { area, normal } of faces) {
      const dot = Math.abs(vecDot(normal, axis))
      if (dot < side) along += area
      else if (dot > end) ends += area
    }
    return { axis, along: along / total, ends: ends / total }
  }).sort((a, b) => sweepShare(b) - sweepShare(a))
}

/**
 * A rectangle or an ellipse in pixel units (pixel p spans [p, p + 1)): its centre, its half extents along its own axes,
 * and its turn from the profile's u axis, radians.
 */
export interface Shape {
  readonly kind: "rectangle" | "ellipse"
  readonly cu: number
  readonly cv: number
  readonly ru: number
  readonly rv: number
  readonly angle: number
}

/** Called with a row `v` and how far the shape reaches in it either side of its centre, in pixels. */
type EachRow = (v: number, low: number, high: number) => void

/** An ellipse's rows from `first` to `last`: each is the root interval of A dx² + B dx + C <= 0. */
const ellipseRows = ({ angle, cv, ru, rv }: Shape, first: number, last: number, each: EachRow) => {
  const c = Math.cos(angle), s = Math.sin(angle)
  const a2 = c * c / (ru * ru) + s * s / (rv * rv), b1 = 2 * c * s * (1 / (ru * ru) - 1 / (rv * rv))
  const c0 = s * s / (ru * ru) + c * c / (rv * rv)
  for (let v = first; v <= last; v++) {
    const dy = v + 0.5 - cv
    const b = b1 * dy, disc = b * b - 4 * a2 * (c0 * dy * dy - 1)
    if (disc >= 0) each(v, (-b - Math.sqrt(disc)) / (2 * a2), (-b + Math.sqrt(disc)) / (2 * a2))
  }
}

/** The offsets dx with |a dx + b| <= h, as [low, high]; empty when low > high. */
const band = (a: number, b: number, h: number): readonly [number, number] => {
  if (Math.abs(a) < 1e-9) return Math.abs(b) <= h ? [-Infinity, Infinity] : [1, -1]
  const x = (-h - b) / a, y = (h - b) / a
  return x < y ? [x, y] : [y, x]
}

/** A rectangle's rows from `first` to `last`: each is where the bands between its two pairs of sides overlap. */
const rectangleRows = ({ angle, cv, ru, rv }: Shape, first: number, last: number, each: EachRow) => {
  const c = Math.cos(angle), s = Math.sin(angle)
  for (let v = first; v <= last; v++) {
    const dy = v + 0.5 - cv
    const [x0, x1] = band(c, dy * s, ru), [y0, y1] = band(-s, dy * c, rv)
    each(v, Math.max(x0, y0), Math.min(x1, y1))
  }
}

/** The pixels `shape` covers in each row it reaches, as inclusive [from, to] spans, clipped to `width` × `height`. */
export const spansOf = (
  shape: Shape,
  width: number,
  height: number,
  each: (v: number, from: number, to: number) => void
) => {
  const { cu, cv, ru, rv } = shape
  const reach = shape.kind === "ellipse" ? Math.max(ru, rv) : Math.hypot(ru, rv)
  const first = Math.max(0, Math.ceil(cv - reach - 0.5)), last = Math.min(height - 1, Math.floor(cv + reach - 0.5))
  // A pixel is covered when its middle is.
  const clipped: EachRow = (v, low, high) => {
    const from = Math.max(0, Math.ceil(cu + low - 0.5)), to = Math.min(width - 1, Math.floor(cu + high - 0.5))
    if (from <= to) each(v, from, to)
  }
  if (shape.kind === "ellipse") ellipseRows(shape, first, last, clipped)
  else rectangleRows(shape, first, last, clipped)
}

/** Whether all of `shape` lies on the grid: `spansOf` clips what doesn't, which would hide it. */
export const withinGrid = (shape: Shape, width: number, height: number): boolean => {
  const c = Math.abs(Math.cos(shape.angle)), s = Math.abs(Math.sin(shape.angle))
  const [eu, ev] = shape.kind === "ellipse" ?
    [Math.hypot(shape.ru * c, shape.rv * s), Math.hypot(shape.ru * s, shape.rv * c)] :
    [shape.ru * c + shape.rv * s, shape.ru * s + shape.rv * c]
  return shape.cu - eu >= 0 && shape.cu + eu <= width && shape.cv - ev >= 0 && shape.cv + ev <= height
}

/** The chamfer's costs of a step to a side and to a corner: 3 to a pixel. */
const SIDE = 3, CORNER = 4

/** Per pixel, the distance to the nearest pixel not in `marks` (two passes of a 3-4 chamfer), in pixels. */
export const depthIn = (marks: Uint8Array, width: number, height: number): Float32Array => {
  const d = new Float32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = at(marks, i) === 1 ? 1e9 : 0
  /** The distance at (u, v) by way of the pixel (du, dv) from it: off the grid nothing is in `marks`. */
  const by = (u: number, v: number, du: number, dv: number, cost: number) => {
    const nu = u + du, nv = v + dv
    return nu < 0 || nv < 0 || nu >= width || nv >= height ? cost : at(d, nu + nv * width) + cost
  }
  /** One pass: every pixel takes the least of its own distance and those by way of the pixels the pass has done. */
  const pass = (step: 1 | -1) => {
    const end = d.length
    for (let i = step === 1 ? 0 : end - 1; i >= 0 && i < end; i += step) {
      const u = i % width, v = (i - u) / width
      d[i] = Math.min(
        at(d, i),
        by(u, v, -step, 0, SIDE),
        by(u, v, 0, -step, SIDE),
        by(u, v, -step, -step, CORNER),
        by(u, v, step, -step, CORNER)
      )
    }
  }
  pass(1)
  pass(-1)
  for (let i = 0; i < d.length; i++) d[i] = at(d, i) / SIDE
  return d
}

/** The pixels of `marks` with a four-neighbour outside it. */
const edgeOf = (marks: Uint8Array, width: number, height: number): Uint8Array =>
  marks.map((mark, i) => {
    if (mark === 0) return 0
    const u = i % width, v = Math.floor(i / width)
    const outside = (du: number, dv: number) =>
      u + du < 0 || v + dv < 0 || u + du >= width || v + dv >= height || at(marks, i + du + dv * width) === 0
    return outside(1, 0) || outside(-1, 0) || outside(0, 1) || outside(0, -1) ? 1 : 0
  })

/** The pixels within `by` of one of `marks`, along both axes. */
const grown = (marks: Uint8Array, width: number, height: number, by: number): Uint8Array => {
  const out = new Uint8Array(marks.length)
  marks.forEach((mark, i) => {
    if (mark === 0) return
    const u = i % width, v = Math.floor(i / width)
    for (let q = Math.max(0, v - by); q <= Math.min(height - 1, v + by); q++) {
      for (let p = Math.max(0, u - by); p <= Math.min(width - 1, u + by); p++) out[p + q * width] = 1
    }
  })
  return out
}

/** Per row, running sums of `marks`, one longer than the row, for counting any span at once. */
const rowSums = (marks: Uint8Array, width: number, height: number): Int32Array => {
  const sums = new Int32Array((width + 1) * height)
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      sums[v * (width + 1) + u + 1] = at(sums, v * (width + 1) + u) + at(marks, u + v * width)
    }
  }
  return sums
}

/** How many marks `sums` holds in row `v` from pixel `from` to `to`. */
const countIn = (sums: Int32Array, width: number, v: number, from: number, to: number) =>
  at(sums, v * (width + 1) + to + 1) - at(sums, v * (width + 1) + from)

/** The profile's width and height, in pixels. */
interface Size {
  readonly width: number
  readonly height: number
}

/** One run of slices with the same cross-section. */
interface Profile {
  /** The first and last slice, and how many there are. */
  readonly k0: number
  readonly k1: number
  readonly slices: number
  /** The pixels at least half the slices hold, and how many there are. */
  readonly marks: Uint8Array
  readonly area: number
  /** Row sums of the pixels a shape may not touch, farther than `REACH` from the profile, and of those outside it. */
  readonly tooFar: Int32Array
  readonly outside: Int32Array
  /** Per pixel, how deep it is inside the profile. */
  readonly depth: Float32Array
  /** The profile's own edge: its pixels next to one outside it. */
  readonly edge: Uint8Array
}

const inverse = (marks: Uint8Array): Uint8Array => marks.map((mark) => 1 - mark)

const countOf = (marks: Uint8Array) => marks.reduce((sum, mark) => sum + mark, 0)

const profileOf = (k0: number, k1: number, marks: Uint8Array, { height, width }: Size): Profile => ({
  k0,
  k1,
  slices: k1 - k0 + 1,
  marks,
  area: countOf(marks),
  tooFar: rowSums(inverse(grown(marks, width, height, REACH)), width, height),
  outside: rowSums(inverse(marks), width, height),
  depth: depthIn(marks, width, height),
  edge: edgeOf(marks, width, height)
})

/** A profile and how far its cover has got. */
interface Section extends Profile {
  /** The profile's pixels no shape covers yet, how many there are, and row sums of them and of those on the edge. */
  readonly uncovered: Uint8Array
  left: number
  leftSums: Int32Array
  edgeSums: Int32Array
  /** No shape fits what is left. */
  stuck: boolean
}

const edgeLeft = (section: Pick<Section, "uncovered" | "edge">) =>
  section.uncovered.map((mark, i) => mark & at(section.edge, i))

/** `profile` with nothing of it covered. */
const sectionOf = (profile: Profile, { height, width }: Size): Section => ({
  ...profile,
  uncovered: profile.marks.slice(),
  left: profile.area,
  leftSums: rowSums(profile.marks, width, height),
  edgeSums: rowSums(profile.edge, width, height),
  stuck: false
})

/** Takes the pixels of `shape` out of what the section has left to cover. */
const coverWith = (section: Section, shape: Shape, size: Size): void => {
  const { uncovered } = section
  spansOf(shape, size.width, size.height, (v, from, to) => {
    for (let i = from + v * size.width; i <= to + v * size.width; i++) {
      section.left -= at(uncovered, i)
      uncovered[i] = 0
    }
  })
  section.leftSums = rowSums(uncovered, size.width, size.height)
  section.edgeSums = rowSums(edgeLeft(section), size.width, size.height)
}

/** What the section still has to cover, as volume: nothing once it is done or stuck. */
const errorOf = (section: Section): number =>
  section.stuck || section.left <= SECTION_DONE * section.area ? 0 : section.left * section.slices

/** What `shape` adds in `section`, by volume, or -Infinity where it reaches a pixel it may not touch. */
const gainIn = (section: Section, shape: Shape, { height, width }: Size): number => {
  // The grid's own margin is past the profile's reach, so a shape that leaves the grid reaches too far.
  if (!withinGrid(shape, width, height)) return -Infinity
  let gain = 0, tooFar = 0, outside = 0
  spansOf(shape, width, height, (v, from, to) => {
    tooFar += countIn(section.tooFar, width, v, from, to)
    outside += countIn(section.outside, width, v, from, to)
    gain += countIn(section.leftSums, width, v, from, to) + EDGE_WEIGHT * countIn(section.edgeSums, width, v, from, to)
  })
  return tooFar > 0 ? -Infinity : (gain - PAST_COST * outside) * section.slices
}

/** A shape and the run of sections, first to last, it is extruded through. */
interface Run {
  readonly shape: Shape
  readonly a: number
  readonly b: number
}

interface ScoredRun extends Run {
  readonly score: number
}

/**
 * `shape` in section `s`, run on each way through the sections next to it along the axis for as long as it fits in
 * them and covers more there: a barrel's core is one long piece and a ring only a short wider one.
 */
const runThrough = (sections: ReadonlyArray<Section>, s: number, shape: Shape, size: Size): ScoredRun => {
  const gain = (j: number) => {
    const section = sections[j]
    return section === undefined ? -Infinity : gainIn(section, shape, size)
  }
  /** Whether the section `step` on from `j` starts where `j` ends. */
  const joins = (j: number, step: -1 | 1) => {
    const here = sections[j], there = sections[j + step]
    if (here === undefined || there === undefined) return false
    return step === 1 ? there.k0 === here.k1 + 1 : there.k1 + 1 === here.k0
  }
  let score = gain(s), a = s, b = s
  if (score === -Infinity) return { shape, score, a, b }
  for (const step of [-1, 1] as const) {
    for (let j = s; joins(j, step); j += step) {
      const more = gain(j + step)
      if (!(more > 0)) break
      score += more
      if (step === 1) b = j + 1
      else a = j - 1
    }
  }
  return { shape, score, a, b }
}

/** Small changes to `shape`: moved, turned, stretched about its centre, or one side out or in, by `step` pixels. */
const movesOf = (shape: Shape, step: number): Array<Shape> => {
  const c = Math.cos(shape.angle), s = Math.sin(shape.angle)
  const out: Array<Shape> = []
  for (const d of [step, -step]) {
    out.push(
      { ...shape, cu: shape.cu + d },
      { ...shape, cv: shape.cv + d },
      { ...shape, angle: shape.angle + d * TURN_STEP },
      { ...shape, ru: shape.ru + d },
      { ...shape, rv: shape.rv + d },
      { ...shape, ru: shape.ru + d, rv: shape.rv + d }
    )
    for (const side of [1, -1]) {
      out.push({ ...shape, ru: shape.ru + d / 2, cu: shape.cu + side * c * d / 2, cv: shape.cv + side * s * d / 2 })
      out.push({ ...shape, rv: shape.rv + d / 2, cu: shape.cu - side * s * d / 2, cv: shape.cv + side * c * d / 2 })
    }
  }
  return out.filter((moved) => moved.ru >= 0.5 && moved.rv >= 0.5)
}

/**
 * `start` moved while that scores more, by smaller and smaller steps; undefined when it reaches a pixel it may not
 * touch as it stands, or ends up covering nothing new.
 */
const climbed = (start: Shape, runOf: (shape: Shape) => ScoredRun): ScoredRun | undefined => {
  let best = runOf(start)
  if (best.score === -Infinity) return undefined
  for (const step of MOVE_STEPS) {
    for (let round = 0; round < MOVE_ROUNDS; round++) {
      // A round's moves are all of the shape it began with, each taken when it beats the best so far.
      const before = best
      for (const candidate of movesOf(before.shape, step)) {
        const tried = runOf(candidate)
        if (tried.score > best.score) best = tried
      }
      if (best === before) break
    }
  }
  return best.score > 0 ? best : undefined
}

/** The section's uncovered pixels, deepest first. */
const deepestLeft = (section: Section): Array<number> => {
  const pixels: Array<number> = []
  section.uncovered.forEach((mark, i) => {
    if (mark === 1) pixels.push(i)
  })
  return pixels.sort((a, b) => at(section.depth, b) - at(section.depth, a))
}

/**
 * The shapes to try next in a section whose uncovered pixels are `pixels`, deepest first. Each of the deepest that
 * stand clear of each other grows a rectangle and an ellipse; one more rectangle starts over all that is left, so
 * pieces of it apart (a D's two corners beside its round) can be one piece across what is already covered.
 */
const startsOf = (section: Section, pixels: ReadonlyArray<number>, width: number): Array<Shape> => {
  const seeds: Array<{ readonly u: number; readonly v: number; readonly depth: number }> = []
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (const i of pixels) {
    const u = i % width, v = Math.floor(i / width), depth = at(section.depth, i)
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u + 1)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v + 1)
    const clear = !seeds.some((seed) => Math.hypot(seed.u - u, seed.v - v) < Math.max(2, seed.depth))
    if (clear && seeds.length < SEEDS) seeds.push({ u, v, depth })
  }
  const starts = seeds.flatMap((seed): Array<Shape> => {
    const r = Math.max(0.5, seed.depth - 1), cu = seed.u + 0.5, cv = seed.v + 0.5
    return [
      { kind: "rectangle", cu, cv, ru: r / Math.SQRT2, rv: r / Math.SQRT2, angle: 0 },
      { kind: "ellipse", cu, cv, ru: r, rv: r, angle: 0 }
    ]
  })
  if (pixels.length === 0) return starts
  return [
    ...starts,
    { kind: "rectangle", cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, ru: (u1 - u0) / 2, rv: (v1 - v0) / 2, angle: 0 }
  ]
}

/**
 * The best next shape for section `s`: its starts are grown and moved while they cover more of what is left without
 * touching a pixel past the profile's reach. What is covered counts by volume, through every section the shape runs
 * on into.
 */
const nextRun = (sections: ReadonlyArray<Section>, s: number, size: Size): ScoredRun | undefined => {
  const section = sections[s]
  if (section === undefined) return undefined
  let best: ScoredRun | undefined
  for (const start of startsOf(section, deepestLeft(section), size.width)) {
    const found = climbed(start, (shape) => runThrough(sections, s, shape, size))
    if (found !== undefined && (best === undefined || found.score > best.score)) best = found
  }
  return best
}

/** The section with the most left to cover, by volume, the first of equals; -1 when none has any. */
const worstOf = (sections: ReadonlyArray<Section>): number => {
  let worst = -1, most = 0
  sections.forEach((section, j) => {
    if (errorOf(section) > most) {
      worst = j
      most = errorOf(section)
    }
  })
  return worst
}

/**
 * Covers `sections` with at most `budget` shapes, each where the most is left, and gives the shapes. A section whose
 * best shape covers less than `leastGain` of its profile is left as it is.
 */
const coverOf = (sections: ReadonlyArray<Section>, size: Size, budget: number, leastGain: number): Array<Run> => {
  const runs: Array<Run> = []
  while (runs.length < budget) {
    const s = worstOf(sections), section = sections[s]
    if (section === undefined) break
    const found = nextRun(sections, s, size)
    let gain = 0
    if (found !== undefined) {
      spansOf(found.shape, size.width, size.height, (v, from, to) => {
        gain += countIn(section.leftSums, size.width, v, from, to)
      })
    }
    if (found === undefined || gain < leastGain * section.area) {
      section.stuck = true
      continue
    }
    runs.push(found)
    for (const covered of sections.slice(found.a, found.b + 1)) coverWith(covered, found.shape, size)
  }
  return runs
}

/** A model turned so that its sweep axis is z, and cut into slices across it. */
interface Sliced {
  /** The profile's axes and the sweep axis, in the world. */
  readonly u: Vec3
  readonly v: Vec3
  readonly w: Vec3
  /** The turned model's bounds, and its cells: a slice is a layer of them, a pixel a cell of one. */
  readonly box: Box3
  readonly grid: VoxelGrid
}

/**
 * The profile's axes for a sweep along `w`: u along the main direction, across the axis, of the faces' normals (a
 * D's flat side), and v square to both.
 */
const profileAxes = (triangles: Float32Array, w: Vec3): { readonly u: Vec3; readonly v: Vec3 } => {
  const across = (n: Vec3) => vecNormalize(vecAdd(n, vecScale(w, -vecDot(n, w))))
  const m = zeroMatrix()
  forEachFace(triangles, (cross, length) => {
    if (length === 0) return
    const normal = vecScale(cross, 1 / length)
    addOuter(m, vecAdd(normal, vecScale(w, -vecDot(normal, w))), length)
  })
  const main = eigen(m).vectors[0] ?? { x: 1, y: 0, z: 0 }
  // Where the normals have no main direction across the axis, any direction across it does.
  const u = Math.abs(vecDot(main, w)) > 0.9 ? across({ x: w.y, y: w.z, z: w.x }) : across(main)
  return { u, v: vecCross(w, u) }
}

/** `triangles` turned and sliced along `axis`, in slices as thick as a pixel of the profile is wide. */
const slicedAlong = (triangles: Float32Array, axis: Vec3): Sliced => {
  const w = vecNormalize(axis), { u, v } = profileAxes(triangles, w)
  const turned = new Float32Array(triangles.length)
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const p = { x: at(triangles, i), y: at(triangles, i + 1), z: at(triangles, i + 2) }
    turned[i] = vecDot(p, u)
    turned[i + 1] = vecDot(p, v)
    turned[i + 2] = vecDot(p, w)
  }
  const box = trianglesBox(turned)
  const wide = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 1e-6), long = box.max.z - box.min.z
  const pixel = Math.max(wide / PROFILE_PIXELS, long / MOST_SLICES)
  const grid = voxelize(turned, gridOver(box, Math.max(wide, long) / pixel), { surface: true })
  return { u, v, w, box, grid }
}

/** The share of the larger of two slices' profiles that is in one and not the other. */
const changeBetween = (a: Uint8Array, b: Uint8Array): number => {
  let differ = 0
  for (let i = 0; i < a.length; i++) differ += at(a, i) ^ at(b, i)
  return differ / Math.max(1, countOf(a), countOf(b))
}

/** The pixels at least half of the slices `k0` to `k1` hold. */
const sharedMarks = (sliceAt: (k: number) => Uint8Array, k0: number, k1: number): Uint8Array => {
  const votes = new Uint16Array(sliceAt(k0).length)
  for (let k = k0; k <= k1; k++) {
    const slice = sliceAt(k)
    for (let i = 0; i < votes.length; i++) votes[i] = at(votes, i) + at(slice, i)
  }
  return Uint8Array.from(votes, (count) => 2 * count >= k1 - k0 + 1 ? 1 : 0)
}

/** The profiles of `grid`: runs of slices that aren't empty and stay within `SECTION_CHANGE` of the run's first. */
const profilesOf = (grid: VoxelGrid, size: Size): Array<Profile> => {
  const plane = size.width * size.height, slices = grid.n[2]
  const sliceAt = (k: number) => grid.cells.subarray(k * plane, (k + 1) * plane)
  const profiles: Array<Profile> = []
  let first = -1
  const close = (last: number) => {
    profiles.push(profileOf(first, last, sharedMarks(sliceAt, first, last), size))
    first = -1
  }
  for (let k = 0; k < slices; k++) {
    const slice = sliceAt(k), empty = countOf(slice) === 0
    if (first >= 0 && (empty || changeBetween(sliceAt(first), slice) > SECTION_CHANGE)) close(k - 1)
    if (first < 0 && !empty) first = k
  }
  if (first >= 0) close(slices - 1)
  return profiles
}

/** The piece `run` stands for: its shape, extruded from its first section's start to its last one's end. */
const pieceOf = (run: Run, sections: ReadonlyArray<Section>, { box, grid, u, v, w }: Sliced): Placement => {
  const { shape } = run
  // Pixel units back to the world: the grid's origin is in the turned frame.
  const world = (pu: number, pv: number, pw: number): Vec3 => {
    const a = grid.origin.x + pu * grid.voxel, b = grid.origin.y + pv * grid.voxel, c = grid.origin.z + pw * grid.voxel
    return vecAdd(vecAdd(vecScale(u, a), vecScale(v, b)), vecScale(w, c))
  }
  // A slice the surface passes through counts as full, so the profile reads half a pixel wide all round and the
  // end slices run past the model's faces: shapes give that half pixel back, and the ends stop at the faces.
  const k0 = sections[run.a]?.k0 ?? 0, k1 = sections[run.b]?.k1 ?? 0
  const from = Math.max(k0, (box.min.z - grid.origin.z) / grid.voxel),
    to = Math.min(k1 + 1, (box.max.z - grid.origin.z) / grid.voxel)
  const sideways = vecAdd(vecScale(u, Math.cos(shape.angle)), vecScale(v, Math.sin(shape.angle)))
  return {
    kind: shape.kind === "rectangle" ? "box" : "cylinder",
    center: world(shape.cu, shape.cv, (from + to) / 2),
    half: {
      x: Math.max(0.5, shape.ru - TRIM) * grid.voxel,
      y: Math.max(0.5, shape.rv - TRIM) * grid.voxel,
      z: (to - from) * grid.voxel / 2
    },
    rotation: quatFromFrame(sideways, w)
  }
}

/** An extrusion along one axis: its pieces, and the sections they cover. */
export interface Extrusion {
  /** The least share of a section's profile each piece covered. */
  readonly leastGain: number
  readonly placements: ReadonlyArray<Placement>
  readonly sections: number
  /** The share of the sections' profile volume left uncovered. */
  readonly uncovered: number
}

/**
 * `triangles` as extrusions along `axis` in at most `budget` pieces, one for each of `LEAST_GAINS`: sliced, grouped
 * into sections, and each section's profile covered by rectangles and ellipses where the most volume is left
 * uncovered. None for a model with no slices.
 */
export const extrusionsOf = (triangles: Float32Array, axis: Vec3, budget: number): Array<Extrusion> => {
  const sliced = slicedAlong(triangles, axis)
  const size: Size = { width: sliced.grid.n[0], height: sliced.grid.n[1] }
  const profiles = profilesOf(sliced.grid, size)
  if (profiles.length === 0) return []
  return LEAST_GAINS.map((leastGain): Extrusion => {
    const sections = profiles.map((profile) => sectionOf(profile, size))
    const runs = coverOf(sections, size, budget, leastGain)
    let total = 0, left = 0
    for (const section of sections) {
      total += section.area * section.slices
      left += section.left * section.slices
    }
    return {
      leastGain,
      placements: runs.map((run) => pieceOf(run, sections, sliced)),
      sections: sections.length,
      uncovered: left / Math.max(1, total)
    }
  })
}
