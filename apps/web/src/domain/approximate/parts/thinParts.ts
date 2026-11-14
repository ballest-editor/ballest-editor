/**
 * Thin parts of a model (ears, a handle, a spout, a knob, a bill), found on its voxel grid: what is left of the solid
 * once a morphological opening takes away its thick core. A low-poly mesh either spends many faces on such a part or
 * loses it, where one to four catalog primitives can stand in for it (`partPrimitives`).
 */
import type { Vec3 } from "../../coords"
import { quatFromFrame, vecAdd, vecCross, vecDot, vecLength, vecScale, vecSub } from "../../ueMath"
import { distanceTo } from "../grid/distance"
import { forEachCellIn, type GridShape, toGridShape, toPlacement } from "../grid/raster"
import { at, cellCount, cellIndex, type VoxelGrid } from "../grid/voxelize"
import { trianglesOfMesh } from "../mesh/mesh"
import { cleanSurface } from "../mesh/remesh"
import { climbShape } from "../pieces/greedy"
import type { Placement, ShapeKind } from "../shapes"

export interface ThinPart {
  /** The part's cells, as grid indices. */
  readonly cells: Int32Array
  /** How far the part reaches out of the opened core, in voxels. */
  readonly reach: number
  /** The core's cells next to the part, where a primitive sinks in to join without a gap. */
  readonly joint: Int32Array
}

export interface ThinParts {
  /** 1 where the opened core is solid. */
  readonly core: Uint8Array
  /** The opening's ball radius, in voxels. */
  readonly radius: number
  readonly parts: ReadonlyArray<ThinPart>
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

/** The opening's radius, as a share of the solid's largest inside distance. */
const OPENING = 1 / 3

/** The fewest cells a part has, in cells and as a share of the solid's. */
const PART_CELLS = 8
const PART_SHARE = 0.002

/** The least a part reaches out of the core, in voxels and as a share of the opening's radius. */
const PART_REACH = 3
const PART_REACH_SHARE = 0.5

/** The index steps to a cell's six neighbours: along x both ways, then y, then z. */
const neighbourSteps = (grid: VoxelGrid): ReadonlyArray<number> => {
  const [nx, ny] = grid.n
  return [1, -1, nx, -nx, nx * ny, -nx * ny]
}

/** The solid of `grid` split by an opening: its core, the rest of it, and each cell's distance from the core. */
const opened = (grid: VoxelGrid) => {
  const count = cellCount(grid)
  const inside = distanceTo(grid, grid.cells.map((c) => 1 - c))
  let deepest = 0, solid = 0
  for (let i = 0; i < count; i++) {
    deepest = Math.max(deepest, at(inside, i))
    solid += at(grid.cells, i)
  }
  const radius = deepest * OPENING
  // The opening: what is deeper than the radius, grown back out by the radius.
  const eroded = new Uint8Array(count)
  for (let i = 0; i < count; i++) eroded[i] = at(inside, i) > radius ? 1 : 0
  const fromCore = distanceTo(grid, eroded)
  const core = new Uint8Array(count), rest = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (at(grid.cells, i) === 0) continue
    if (at(fromCore, i) <= radius) core[i] = 1
    else rest[i] = 1
  }
  return { core, rest, fromCore, radius, solid }
}

/**
 * The parts of `grid`'s solid (a filled grid) outside its opening by a ball a third of its largest inside distance,
 * that are bigger than a small share of the solid and reach well out of the core: a skin the opening shaves off a
 * corner or a ridge doesn't reach far, a part does.
 */
export const thinParts = (grid: VoxelGrid): ThinParts => {
  const { core, fromCore, radius, rest: unclaimed, solid } = opened(grid)
  const count = cellCount(grid)
  const [nx, ny] = grid.n
  const steps = neighbourSteps(grid)
  /** The cells joined face to face to `seed`, in the order a flood from it reaches them, claimed as it goes. */
  const partFrom = (seed: number): ThinPart => {
    const cells = [seed]
    unclaimed[seed] = 0
    const joint = new Set<number>()
    let reach = 0
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k] ?? 0
      reach = Math.max(reach, at(fromCore, i) - radius)
      const x = i % nx, y = Math.floor(i / nx) % ny
      for (const [d, step] of steps.entries()) {
        // A step off the end of a row or a layer would come back in on the far side.
        if ((d === 0 && x === nx - 1) || (d === 1 && x === 0) || (d === 2 && y === ny - 1) || (d === 3 && y === 0)) {
          continue
        }
        const j = i + step
        if (j < 0 || j >= count) continue
        if (at(core, j) === 1) joint.add(j)
        if (at(unclaimed, j) === 0) continue
        unclaimed[j] = 0
        cells.push(j)
      }
    }
    return { cells: Int32Array.from(cells), reach, joint: Int32Array.from(joint) }
  }
  const parts: Array<ThinPart> = []
  const fewest = Math.max(PART_CELLS, solid * PART_SHARE), nearest = Math.max(PART_REACH, radius * PART_REACH_SHARE)
  for (let seed = 0; seed < count; seed++) {
    if (at(unclaimed, seed) === 0) continue
    const part = partFrom(seed)
    if (part.cells.length >= fewest && part.reach >= nearest) parts.push(part)
  }
  return { core, radius, parts }
}

const centreOf = (grid: VoxelGrid, i: number): Vec3 => {
  const [nx, ny] = grid.n
  return {
    x: grid.origin.x + (i % nx + 0.5) * grid.voxel,
    y: grid.origin.y + (Math.floor(i / nx) % ny + 0.5) * grid.voxel,
    z: grid.origin.z + (Math.floor(i / (nx * ny)) + 0.5) * grid.voxel
  }
}

export interface Moments {
  readonly centroid: Vec3
  /** Principal axes, largest spread first, and the variance along each, cm². */
  readonly axes: readonly [Vec3, Vec3, Vec3]
  readonly variance: readonly [number, number, number]
  /** The third moment along the first axis: positive where the long tail of the cells lies along it. */
  readonly skew: number
}

/**
 * Turns two lines of the 3 × 3 matrix `m` (row-major) into each other by the rotation with cosine `c` and sine `s`.
 * The lines start at `p` and `q` and step by `step`: columns `p` and `q` with a step of 3, rows from `3p` and `3q`
 * with a step of 1.
 */
const turnLines = (m: Float64Array, p: number, q: number, step: number, c: number, s: number) => {
  for (let k = 0; k < 3; k++) {
    const mp = at(m, p + step * k), mq = at(m, q + step * k)
    m[p + step * k] = c * mp - s * mq
    m[q + step * k] = s * mp + c * mq
  }
}

/** The most sweeps Jacobi's method makes, and the sum of squares off the diagonal at which it is done. */
const EIGEN_SWEEPS = 50
const EIGEN_DONE = 1e-18

/** The eigenvalues of a symmetric 3 × 3 matrix, largest first, with their eigenvectors (Jacobi rotations). */
export const eigen = (m: ReadonlyArray<ReadonlyArray<number>>): { values: Array<number>; vectors: Array<Vec3> } => {
  const a = new Float64Array(9), v = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[3 * i + j] = m[i]?.[j] ?? 0
  for (let sweep = 0; sweep < EIGEN_SWEEPS; sweep++) {
    let off = 0
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += at(a, 3 * i + j) ** 2
    if (off < EIGEN_DONE) break
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = at(a, 3 * p + q)
        if (Math.abs(apq) < 1e-30) continue
        // The rotation that zeroes a[p][q]: its tangent is the smaller root, for stability.
        const theta = (at(a, 4 * q) - at(a, 4 * p)) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        turnLines(a, p, q, 3, c, s)
        turnLines(a, 3 * p, 3 * q, 1, c, s)
        turnLines(v, p, q, 3, c, s)
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => at(a, 4 * j) - at(a, 4 * i))
  return {
    values: order.map((i) => at(a, 4 * i)),
    vectors: order.map((i) => ({ x: at(v, i), y: at(v, 3 + i), z: at(v, 6 + i) }))
  }
}

/** The cells' centroid, principal axes and spreads, each cell counted as a solid voxel. */
export const momentsOf = (grid: VoxelGrid, cells: ReadonlyArray<number>): Moments => {
  const centres = cells.map((i) => centreOf(grid, i)), count = Math.max(1, cells.length)
  let centroid = ZERO
  for (const p of centres) centroid = vecAdd(centroid, p)
  centroid = vecScale(centroid, 1 / count)
  const sums = new Float64Array(9)
  for (const p of centres) {
    const d = vecSub(p, centroid), e = [d.x, d.y, d.z]
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) sums[3 * r + k] = at(sums, 3 * r + k) + (e[r] ?? 0) * (e[k] ?? 0)
    }
  }
  // A voxel's own spread, a twelfth of its side squared, on top of its centre's.
  const voxelSpread = grid.voxel * grid.voxel / 12
  const spread = [0, 1, 2].map((r) => [0, 1, 2].map((k) => at(sums, 3 * r + k) / count + (r === k ? voxelSpread : 0)))
  const { values, vectors } = eigen(spread)
  const [e1 = { x: 1, y: 0, z: 0 }, e2 = { x: 0, y: 1, z: 0 }] = vectors
  let skew = 0
  for (const p of centres) skew += vecDot(vecSub(p, centroid), e1) ** 3
  return {
    centroid,
    axes: [e1, e2, vecCross(e1, e2)],
    variance: [Math.max(0, values[0] ?? 0), Math.max(0, values[1] ?? 0), Math.max(0, values[2] ?? 0)],
    skew
  }
}

/** The least half size of a primitive, cm. */
const HALF_MIN = 0.25

const sized = (x: number): number => Math.max(HALF_MIN, x)

/**
 * One primitive of `kind` with the same spread as the cells: a box or an ellipsoid along the principal axes (its own z
 * the thinnest, so a flat part gets a flat piece), a cylinder or a capsule along the longest, a cone along the longest
 * pointing along the long tail of the cells, or the other way with `reversed`, and a half sphere domed along the
 * thinnest, one way or, with `reversed`, the other.
 */
export const primitiveOf = (kind: ShapeKind, moments: Moments, reversed = false): Placement => {
  const { axes: [e1, e2, e3], centroid, variance: [l1, l2, l3] } = moments
  switch (kind) {
    case "box":
      // A box of half size h spreads h²/3 along each side.
      return {
        kind,
        center: centroid,
        half: { x: sized(Math.sqrt(3 * l1)), y: sized(Math.sqrt(3 * l2)), z: sized(Math.sqrt(3 * l3)) },
        rotation: quatFromFrame(e1, e3)
      }
    case "sphere":
      // An ellipsoid of half size h spreads h²/5 along each axis.
      return {
        kind,
        center: centroid,
        half: { x: sized(Math.sqrt(5 * l1)), y: sized(Math.sqrt(5 * l2)), z: sized(Math.sqrt(5 * l3)) },
        rotation: quatFromFrame(e1, e3)
      }
    case "cylinder":
    case "capsule":
      // A cylinder's own z is its axis, here the longest; quatFromFrame(e2, e1) makes its y the thinnest. It spreads
      // r²/4 across. A capsule's caps make it a little less spread along its axis than a cylinder as long; the climb
      // that follows takes up the difference.
      return {
        kind,
        center: centroid,
        half: { x: sized(2 * Math.sqrt(l2)), y: sized(2 * Math.sqrt(l3)), z: sized(Math.sqrt(3 * l1)) },
        rotation: quatFromFrame(e2, e1)
      }
    case "cone":
    case "pyramid": {
      // A cone of height h spreads 3h²/80 along its axis and 3r²/20 across, its centroid a quarter of its height above
      // its base; its apex points along the cells' long tail.
      const apex = (moments.skew >= 0) !== reversed ? e1 : vecScale(e1, -1)
      const height = sized(Math.sqrt(80 * l1 / 3))
      return {
        kind,
        center: vecAdd(centroid, vecScale(apex, height / 4)),
        half: { x: sized(Math.sqrt(20 * l2 / 3)), y: sized(Math.sqrt(20 * l3 / 3)), z: height / 2 },
        rotation: quatFromFrame(e2, apex)
      }
    }
    case "hemisphere": {
      // A solid half ball of radius r spreads r²/5 across its axis and 19r²/320 along it, its centroid 3r/8 off its flat
      // face; the piece's own box is centred halfway up the dome.
      const up = reversed ? vecScale(e3, -1) : e3
      const height = sized(Math.sqrt(320 * l3 / 19))
      return {
        kind,
        center: vecAdd(centroid, vecScale(up, height / 8)),
        half: { x: sized(Math.sqrt(5 * l1)), y: sized(Math.sqrt(5 * l2)), z: height / 2 },
        rotation: quatFromFrame(e1, up)
      }
    }
  }
}

/** The fewest cells a run of a part has. */
const RUN_CELLS = 4

/** Each of `cells` reachable from `from` by steps between neighbours, with how many steps, nearest first. */
const stepsFrom = (cells: ReadonlySet<number>, steps: ReadonlyArray<number>, from: number): Map<number, number> => {
  const distance = new Map<number, number>([[from, 0]])
  for (const i of distance.keys()) {
    for (const step of steps) {
      const j = i + step
      if (cells.has(j) && !distance.has(j)) distance.set(j, (distance.get(i) ?? 0) + 1)
    }
  }
  return distance
}

/** The cell furthest by `distance`: of several, the first reached. */
const farthest = (distance: ReadonlyMap<number, number>): number => {
  let far = -1, most = -Infinity
  for (const [i, d] of distance) if (d > most) [far, most] = [i, d]
  return far
}

/**
 * The part's cells in up to `segments` runs along its longest path (from the cell furthest from the cell furthest from
 * its first), each with the joint cells that touch it. Runs of fewer than `RUN_CELLS` cells are left out.
 */
const segmentsOf = (grid: VoxelGrid, part: ThinPart, segments: number): Array<Array<number>> => {
  const steps = neighbourSteps(grid)
  const cells = new Set(part.cells)
  const end = farthest(stepsFrom(cells, steps, farthest(stepsFrom(cells, steps, part.cells[0] ?? 0))))
  const along = stepsFrom(cells, steps, end)
  let longest = 1
  for (const d of along.values()) longest = Math.max(longest, d)
  const runs: Array<Array<number>> = Array.from({ length: segments }, () => [])
  const runAt = (d: number) => runs[Math.min(segments - 1, Math.floor(d / (longest + 1) * segments))]
  for (const [i, d] of along) runAt(d)?.push(i)
  for (const j of part.joint) {
    const touching = steps.map((step) => j + step).find((i) => along.has(i))
    if (touching !== undefined) runAt(along.get(touching) ?? 0)?.push(j)
  }
  return runs.filter((run) => run.length >= RUN_CELLS)
}

/** What an empty cell a primitive covers costs, in part cells covered, while it is fitted. */
const SPILL_WEIGHT = 4

/** What a body cell past the joint costs: a little, so a primitive sinks in only as far as it pays, never through. */
const BODY_WEIGHT = 0.5

/** Steps of the overlap climb per candidate. */
const CLIMB_STEPS = 400

/** The share of a part its primitives must cover, and the most of their own volume that may lie outside the model. */
const PART_COVERAGE = 0.6
const PART_SPILL = 0.15

/** What a chain's fit loses for each piece past the first. */
const PIECE_COST = 0.05

interface Start {
  readonly kind: ShapeKind
  readonly reversed: boolean
  readonly label: string
}

/** The shapes a flat part or run is tried with, each from the cells' moments. */
const FLAT_STARTS: ReadonlyArray<Start> = [
  { kind: "box", reversed: false, label: "flat box" },
  { kind: "sphere", reversed: false, label: "flat ellipsoid" }
]

/** The shapes any other part or run is tried with. */
const STARTS: ReadonlyArray<Start> = [
  { kind: "box", reversed: false, label: "box" },
  { kind: "sphere", reversed: false, label: "ellipsoid" },
  { kind: "cylinder", reversed: false, label: "cylinder" },
  { kind: "cone", reversed: false, label: "cone" },
  { kind: "cone", reversed: true, label: "cone" },
  { kind: "capsule", reversed: false, label: "capsule" },
  { kind: "hemisphere", reversed: false, label: "half sphere" },
  { kind: "hemisphere", reversed: true, label: "half sphere" }
]

/**
 * Below this flatness (`partFlatness`) a part is flat, an ear or a fin: it is tried only with flat shapes, never a
 * cylinder or cone. The bunny's ears read 0.39, the teapot's spout 0.42 and its handle 0.50.
 */
export const FLAT_PART = 0.4

/** Below this ratio of their thinnest spread to their middle one (0 for a sheet, 1 for a rod), cells are flat. */
const FLAT_CELLS = 0.6

/** The starts for cells with `moments`: only flat shapes where the cells are flat, so an ear never becomes a log. */
const startsFor = (moments: Moments): ReadonlyArray<Start> =>
  Math.sqrt(moments.variance[2] / Math.max(1e-9, moments.variance[1])) < FLAT_CELLS ? FLAT_STARTS : STARTS

/** Runs along a part its flatness is measured over. */
const FLATNESS_RUNS = 4

/** The area of some surface with its first and second moments, summed over its triangles' centres. */
interface SurfaceSums {
  weight: number
  readonly first: Float64Array
  readonly second: Float64Array
}

/**
 * The run of the part cell nearest `p`, of the eight cells whose centres surround it: the surface runs along the cells'
 * faces, so a point of it lies between a part's cell and an empty one. Undefined where none of the eight is in a run.
 */
const runNear = (grid: VoxelGrid, runOf: ReadonlyMap<number, number>, p: ReadonlyArray<number>): number | undefined => {
  const [nx, ny, nz] = grid.n
  const origin = [grid.origin.x, grid.origin.y, grid.origin.z]
  const [gx = 0, gy = 0, gz = 0] = [0, 1, 2].map((a) => ((p[a] ?? 0) - (origin[a] ?? 0)) / grid.voxel - 0.5)
  let run: number | undefined, nearest = Infinity
  for (let dk = 0; dk <= 1; dk++) {
    for (let dj = 0; dj <= 1; dj++) {
      for (let di = 0; di <= 1; di++) {
        const i = Math.floor(gx) + di, j = Math.floor(gy) + dj, k = Math.floor(gz) + dk
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue
        const r = runOf.get(cellIndex(grid, i, j, k))
        const d = (i - gx) ** 2 + (j - gy) ** 2 + (k - gz) ** 2
        if (r !== undefined && d < nearest) [run, nearest] = [r, d]
      }
    }
  }
  return run
}

/** The surface's thickness over its width: twice its thinnest spread over √12 times its middle one. */
const thicknessOverWidth = ({ first, second, weight }: SurfaceSums): number => {
  const mean = Array.from(first, (x) => x / weight)
  const spread = [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => at(second, 3 * r + c) / weight - (mean[r] ?? 0) * (mean[c] ?? 0))
  )
  const { values } = eigen(spread)
  const middle = Math.sqrt(Math.max(1e-12, values[1] ?? 0)), thinnest = Math.sqrt(Math.max(0, values[2] ?? 0))
  return 2 * thinnest / (Math.sqrt(12) * middle)
}

/**
 * A part's flatness: over runs along its length, the median of each run's thickness over its width, both read off the
 * model's own surface inside the run (its triangles' centres, weighted by area) rather than the voxels, which blur a
 * thin sheet to two or three cells. Points on a sheet's two faces spread its thickness t to ±t/2 and its width w evenly,
 * so the extents are twice and √12 times the spreads. Runs keep a cupped or bent sheet flat, and a tube or a handle's
 * loop round.
 */
export const partFlatness = (grid: VoxelGrid, part: ThinPart, triangles: Float32Array): number => {
  const runOf = new Map<number, number>()
  segmentsOf(grid, part, FLATNESS_RUNS).forEach((run, r) => {
    for (const i of run) runOf.set(i, r)
  })
  const sums: ReadonlyArray<SurfaceSums> = Array.from(
    { length: FLATNESS_RUNS },
    () => ({ weight: 0, first: new Float64Array(3), second: new Float64Array(9) })
  )
  const corner = (o: number): Vec3 => ({ x: at(triangles, o), y: at(triangles, o + 1), z: at(triangles, o + 2) })
  for (let t = 0; t + 8 < triangles.length; t += 9) {
    const p = [0, 1, 2].map((k) => (at(triangles, t + k) + at(triangles, t + 3 + k) + at(triangles, t + 6 + k)) / 3)
    const run = runNear(grid, runOf, p)
    const sum = run === undefined ? undefined : sums[run]
    if (sum === undefined) continue
    const a = corner(t)
    const area = vecLength(vecCross(vecSub(corner(t + 3), a), vecSub(corner(t + 6), a))) / 2
    sum.weight += area
    for (let r = 0; r < 3; r++) {
      sum.first[r] = at(sum.first, r) + area * (p[r] ?? 0)
      for (let c = 0; c < 3; c++) sum.second[3 * r + c] = at(sum.second, 3 * r + c) + area * (p[r] ?? 0) * (p[c] ?? 0)
    }
  }
  const ratios = sums.filter(({ weight }) => weight > 0).map(thicknessOverWidth).sort((x, y) => x - y)
  return ratios[Math.floor(ratios.length / 2)] ?? 1
}

/** `cells` marked 1 and `joint` marked 2, over the grid. */
const maskOf = (grid: VoxelGrid, cells: Iterable<number>, joint: Iterable<number>): Uint8Array => {
  const mask = new Uint8Array(grid.cells.length)
  for (const i of joint) mask[i] = 2
  for (const i of cells) mask[i] = 1
  return mask
}

/**
 * `start` climbed to cover the cells marked 1 in `target`: a cell marked 2 (the joint) is free, an empty cell costs
 * `SPILL_WEIGHT` and any other body cell `BODY_WEIGHT`.
 */
const climbed = (grid: VoxelGrid, target: Uint8Array, start: Placement, seed: number): Placement => {
  const value = (shape: GridShape) => {
    let total = 0
    forEachCellIn(grid, shape, (i) => {
      const mark = at(target, i)
      if (mark === 1) total++
      else if (at(grid.cells, i) === 0) total -= SPILL_WEIGHT
      else if (mark === 0) total -= BODY_WEIGHT
    })
    return total
  }
  const { shape } = climbShape(toGridShape(grid, start), value, {
    steps: CLIMB_STEPS,
    seed,
    minHalf: 0.5,
    maxHalf: Math.max(...grid.n) / 2
  })
  return toPlacement(grid, shape)
}

/** How `pieces` cover the `size` cells marked 1 in `target`: the share they cover, and the share of their own cells outside the model. */
const overlapOf = (grid: VoxelGrid, target: Uint8Array, size: number, pieces: ReadonlyArray<Placement>) => {
  const seen = new Set<number>()
  for (const piece of pieces) forEachCellIn(grid, toGridShape(grid, piece), (i) => seen.add(i))
  let covered = 0, spilled = 0
  for (const i of seen) {
    if (at(target, i) === 1) covered++
    else if (at(grid.cells, i) === 0) spilled++
  }
  return { coverage: covered / Math.max(1, size), spill: spilled / Math.max(1, seen.size) }
}

/** One way to stand in for a part: its pieces, how much of the part they cover, and how much of them spills out. */
export interface PartOption {
  readonly label: string
  readonly pieces: ReadonlyArray<Placement>
  readonly coverage: number
  readonly spill: number
  /** Coverage less twice the spill, less a little for each piece past the first: higher is better. */
  readonly fit: number
}

/** Whether `option` fits its part well enough to be compared with the mesh at all. */
export const eligible = (option: PartOption): boolean => option.coverage >= PART_COVERAGE && option.spill <= PART_SPILL

/** A chain's link: the best of some starts for one run of a part. */
interface Link {
  readonly piece: Placement
  readonly label: string
  readonly fit: number
}

/**
 * The best of `starts` for `run`, each climbed to cover the run's own cells of the part (those marked 1 in `target`),
 * with a seed of its own from `seed` up. Of starts that fit equally, the first.
 */
const linkOf = (
  grid: VoxelGrid,
  target: Uint8Array,
  joint: Int32Array,
  run: ReadonlyArray<number>,
  starts: (moments: Moments) => ReadonlyArray<Start>,
  seed: number
): Link | undefined => {
  const own = maskOf(grid, run.filter((i) => at(target, i) === 1), joint)
  const moments = momentsOf(grid, run)
  let best: Link | undefined
  for (const [k, start] of starts(moments).entries()) {
    const piece = climbed(grid, own, primitiveOf(start.kind, moments, start.reversed), seed + k)
    const { coverage, spill } = overlapOf(grid, own, run.length, [piece])
    const fit = coverage - 2 * spill
    if (best === undefined || fit > best.fit) best = { piece, label: start.label, fit }
  }
  return best
}

/** A chain's label: "3 cylinders" where its links are one shape, "cone + capsule" where they differ. */
const chainLabel = (labels: ReadonlyArray<string>): string => {
  const [first = ""] = labels
  if (!labels.every((label) => label === first)) return labels.join(" + ")
  return `${labels.length} ${first}${first.endsWith("box") ? "es" : "s"}`
}

/**
 * Candidates for `part`, best first: those that fit well enough (`eligible`), then the rest, each by fit. First each
 * single shape (a box, an ellipsoid, a cylinder, a capsule, a cone or a half sphere either way) started from the
 * part's moments and climbed to overlap the part's own cells, sinking into the body through its joint cells for free
 * and a little further at a cost; then chains of two to four links along the part, each link the best of the same
 * shapes for its own stretch of the part, climbed to that stretch. A `flat` part gets only flat boxes and flat
 * ellipsoids, alone or as a chain of two that follows a bend.
 */
export const partPrimitives = (grid: VoxelGrid, part: ThinPart, flat = false): Array<PartOption> => {
  const target = maskOf(grid, part.cells, part.joint)
  const option = (label: string, pieces: ReadonlyArray<Placement>): PartOption => {
    const { coverage, spill } = overlapOf(grid, target, part.cells.length, pieces)
    return { label, pieces, coverage, spill, fit: coverage - 2 * spill - PIECE_COST * (pieces.length - 1) }
  }
  const moments = momentsOf(grid, [...part.cells, ...part.joint])
  const options = (flat ? FLAT_STARTS : startsFor(moments)).map(({ kind, label, reversed }, k) =>
    option(label, [climbed(grid, target, primitiveOf(kind, moments, reversed), k + 1)])
  )
  // A flat part's chain is all one kind, so a pair of ears can match; another part's links each take their best kind.
  const chains = flat ?
    FLAT_STARTS.map((start) => ({ segments: 2, starts: (): ReadonlyArray<Start> => [start] })) :
    [2, 3, 4].map((segments) => ({ segments, starts: startsFor }))
  for (const [c, chain] of chains.entries()) {
    const runs = segmentsOf(grid, part, chain.segments)
    if (runs.length < 2) continue
    const links = runs
      .map((run, r) => linkOf(grid, target, part.joint, run, chain.starts, 100 * (c + 2) + 10 * r))
      .filter((link) => link !== undefined)
    options.push(option(chainLabel(links.map(({ label }) => label)), links.map(({ piece }) => piece)))
  }
  return options.sort((a, b) => Number(eligible(b)) - Number(eligible(a)) || b.fit - a.fit)
}

/** How near a removed cell, in voxels, the model's own triangles are dropped, and how near the voxel surface is kept. */
const CUT_CLEAR = 1.5
const CUT_COVER = 2.5

/**
 * What the remesh should follow once `removed` cells are taken out of the model: its own triangles away from the cut,
 * and the voxel surface of what is left where the cut closes over. The two overlap by a voxel, so no gap opens.
 */
export const trimmedSurface = (triangles: Float32Array, trimmed: VoxelGrid, removed: Uint8Array): Float32Array => {
  const fromCut = distanceTo(trimmed, removed)
  const [nx, ny, nz] = trimmed.n
  /** The distance from the cut at the cell that holds a point, or Infinity outside the grid. */
  const fromCutAt = (x: number, y: number, z: number) => {
    const i = Math.floor((x - trimmed.origin.x) / trimmed.voxel),
      j = Math.floor((y - trimmed.origin.y) / trimmed.voxel),
      k = Math.floor((z - trimmed.origin.z) / trimmed.voxel)
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return Infinity
    return at(fromCut, cellIndex(trimmed, i, j, k))
  }
  const kept: Array<number> = []
  /** Keeps the triangles of `list` whose centre's distance from the cut passes `test`. */
  const keep = (list: Float32Array, test: (distance: number) => boolean) => {
    for (let t = 0; t < list.length; t += 9) {
      const x = (at(list, t) + at(list, t + 3) + at(list, t + 6)) / 3
      const y = (at(list, t + 1) + at(list, t + 4) + at(list, t + 7)) / 3
      const z = (at(list, t + 2) + at(list, t + 5) + at(list, t + 8)) / 3
      if (test(fromCutAt(x, y, z))) { for (let k = 0; k < 9; k++) kept.push(at(list, t + k)) }
    }
  }
  keep(triangles, (distance) => distance > CUT_CLEAR)
  keep(trianglesOfMesh(cleanSurface(trimmed)), (distance) => distance <= CUT_COVER)
  return new Float32Array(kept)
}
