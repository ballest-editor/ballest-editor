/**
 * A model as voxels: which cells of a grid over it are solid. Triangles are one flat array, nine numbers each, in the
 * game's frame (cm, Z up).
 *
 * A cell is inside when most of three rays through its centre, one along each axis, say so. A ray counts signed
 * crossings, +1 or -1 by which way the face it crosses looks along it, and is inside wherever the count isn't zero.
 * Closed shells pushed through each other, as game and kitbashed models often are, so fill as their union. A ray
 * whose count doesn't come back to zero (faces wound the wrong way) falls back to parity, and one that then crossed
 * an odd number of times went through a hole in the mesh and doesn't vote. That copes with the small holes and stray
 * faces free models often have; a generalised winding number would cope with more and costs much more.
 *
 * With `surface` on, every cell a triangle passes through is solid too, so open sheets and parts thinner than a cell
 * still show.
 */
import type { Vec3 } from "../../coords"

/** Where a grid sits: `n` cells along each axis, `voxel` cm on a side, the corner of cell (0, 0, 0) at `origin`. */
export interface GridFrame {
  readonly n: readonly [number, number, number]
  readonly origin: Vec3
  readonly voxel: number
}

export interface VoxelGrid extends GridFrame {
  /** 1 for a solid cell, x fastest, then y, then z. */
  readonly cells: Uint8Array
}

export const cellIndex = (frame: GridFrame, x: number, y: number, z: number): number =>
  x + frame.n[0] * (y + frame.n[1] * z)

export const cellCount = (frame: GridFrame): number => frame.n[0] * frame.n[1] * frame.n[2]

/** An axis of the grid: 0 is X, 1 is Y, 2 is Z. */
export type Axis = 0 | 1 | 2

export const AXES: ReadonlyArray<Axis> = [0, 1, 2]

const NEXT_AXIS: Readonly<Record<Axis, Axis>> = { 0: 1, 1: 2, 2: 0 }

type Numbers = Float64Array | Float32Array | Uint8Array | Uint16Array | Int32Array | Uint32Array

/** `array[i]`, for an index the loop already keeps in range. */
export const at = (array: Numbers, i: number): number => array[i] ?? 0

/** The point at index `i` of a flat list of x, y, z. */
export const pointAt = (points: Float32Array | Float64Array, i: number): Vec3 => ({
  x: at(points, 3 * i),
  y: at(points, 3 * i + 1),
  z: at(points, 3 * i + 2)
})

export interface Box3 {
  readonly min: Vec3
  readonly max: Vec3
}

export const trianglesBox = (triangles: Float32Array): Box3 => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < triangles.length; i++) {
    const axis = AXES[i % 3] ?? 0
    const value = at(triangles, i)
    if (value < min[axis]) min[axis] = value
    if (value > max[axis]) max[axis] = value
  }
  return { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } }
}

/** A grid of `resolution` cells along the longest side of `box`, centred on it, with one empty cell all round. */
export const gridOver = (box: Box3, resolution: number): GridFrame => {
  const sizeX = box.max.x - box.min.x, sizeY = box.max.y - box.min.y, sizeZ = box.max.z - box.min.z
  const voxel = Math.max(sizeX, sizeY, sizeZ, 1e-6) / resolution
  const cellsAlong = (size: number) => Math.max(1, Math.ceil(size / voxel - 1e-9)) + 2
  const start = (low: number, high: number, cells: number) => (low + high) / 2 - cells * voxel / 2
  const n = [cellsAlong(sizeX), cellsAlong(sizeY), cellsAlong(sizeZ)] as const
  return {
    n,
    origin: {
      x: start(box.min.x, box.max.x, n[0]),
      y: start(box.min.y, box.max.y, n[1]),
      z: start(box.min.z, box.max.z, n[2])
    },
    voxel
  }
}

/**
 * Calls `each` on the solid cells of `cells`, x fastest, then y, then z, with `solid`: whether the cell at (x, y, z) is
 * solid, where outside the grid is empty.
 */
export const forEachSolid = (
  frame: GridFrame,
  cells: Uint8Array,
  each: (x: number, y: number, z: number, solid: (x: number, y: number, z: number) => boolean) => void
): void => {
  const [nx, ny, nz] = frame.n
  const solid = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && at(cells, x + nx * (y + ny * z)) === 1
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) if (solid(x, y, z)) each(x, y, z, solid)
    }
  }
}

/** A list of numbers that grows as it is pushed to. */
class NumberList {
  private data = new Float64Array(1 << 14)
  private length = 0

  push(value: number) {
    if (this.length === this.data.length) {
      const longer = new Float64Array(this.data.length * 2)
      longer.set(this.data)
      this.data = longer
    }
    this.data[this.length++] = value
  }

  /** The numbers, sorted in place, lowest first. */
  sorted(): Float64Array {
    return this.data.subarray(0, this.length).sort()
  }
}

/** How far each column of rays sits off its cells' centres, so it misses the lines a mesh's edges and vertices keep to. */
const JITTER = [1.37e-4, 2.71e-4, 3.14e-4] as const

/** A crossing's depth is kept to a millionth of a cell in its key; with the column and the facing that stays below 2^53. */
const DEPTH_STEPS = 2 ** 20

/** Crossings nearer than this, in cells, are at one depth. */
const SAME_DEPTH = 1e-6

/**
 * The rays along `axis`, one per column of cells: a column is at (iu, iv) on the two other axes, `u` then `v`, and
 * numbered `iu + nu * iv`.
 */
interface Rays {
  readonly axis: Axis
  readonly u: Axis
  readonly v: Axis
  /** Cells along the ray, and columns along `u` and `v`. */
  readonly na: number
  readonly nu: number
  readonly nv: number
  /** How far apart, in a list of cells, neighbours along the ray, `u` and `v` are. */
  readonly stepA: number
  readonly stepU: number
  readonly stepV: number
  /** How many key places a column takes: every depth step from 2 cells before the grid to 2 past it. */
  readonly columnSpan: number
}

const raysAlong = (frame: GridFrame, axis: Axis): Rays => {
  const u = NEXT_AXIS[axis], v = NEXT_AXIS[u]
  const steps = [1, frame.n[0], frame.n[0] * frame.n[1]] as const
  return {
    axis,
    u,
    v,
    na: frame.n[axis],
    nu: frame.n[u],
    nv: frame.n[v],
    stepA: steps[axis],
    stepU: steps[u],
    stepV: steps[v],
    columnSpan: (frame.n[axis] + 4) * DEPTH_STEPS
  }
}

/**
 * Every crossing of a ray with a triangle of `g` (grid units), as a key: twice its place (the column times
 * `columnSpan`, plus the depth in steps from 2 cells before the grid) plus 1 where the face looks along the ray. Sorted,
 * they run by column, then depth, then facing. A face's facing is which way its projection turns, which only has to
 * agree between the faces of one closed shell.
 */
const crossingKeys = (rays: Rays, g: Float64Array): Float64Array => {
  const { axis, columnSpan, na, nu, nv, u, v } = rays
  const ju = JITTER[u], jv = JITTER[v]
  const keys = new NumberList()
  for (let t = 0; t < g.length; t += 9) {
    const u0 = at(g, t + u), v0 = at(g, t + v), a0 = at(g, t + axis)
    const u1 = at(g, t + 3 + u), v1 = at(g, t + 3 + v), a1 = at(g, t + 3 + axis)
    const u2 = at(g, t + 6 + u), v2 = at(g, t + 6 + v), a2 = at(g, t + 6 + axis)
    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2)
    if (Math.abs(denom) < 1e-12) continue
    const facing = denom > 0 ? 1 : 0
    const iuFrom = Math.max(0, Math.ceil(Math.min(u0, u1, u2) - 0.5 - ju))
    const iuTo = Math.min(nu - 1, Math.floor(Math.max(u0, u1, u2) - 0.5 - ju))
    const ivFrom = Math.max(0, Math.ceil(Math.min(v0, v1, v2) - 0.5 - jv))
    const ivTo = Math.min(nv - 1, Math.floor(Math.max(v0, v1, v2) - 0.5 - jv))
    for (let iv = ivFrom; iv <= ivTo; iv++) {
      const cv = iv + 0.5 + jv
      for (let iu = iuFrom; iu <= iuTo; iu++) {
        const cu = iu + 0.5 + ju
        // The ray's barycentric coordinates in the projected triangle: inside it when none is negative.
        const l0 = ((v1 - v2) * (cu - u2) + (u2 - u1) * (cv - v2)) / denom
        if (l0 < 0) continue
        const l1 = ((v2 - v0) * (cu - u2) + (u0 - u2) * (cv - v2)) / denom
        if (l1 < 0) continue
        const l2 = 1 - l0 - l1
        if (l2 < 0) continue
        const depth = Math.min(na + 1, Math.max(-1, l0 * a0 + l1 * a1 + l2 * a2))
        const place = (iu + nu * iv) * columnSpan + Math.round((depth + 2) * DEPTH_STEPS)
        keys.push(place * 2 + facing)
      }
    }
  }
  return keys.sorted()
}

/** The crossings of one ray, nearest first. */
interface Crossings {
  /** Each crossing's depth and facing (1 or -1); a face met twice at one depth (duplicated geometry) counts once. */
  readonly signedDepths: Array<number>
  readonly signs: Array<number>
  /** Each depth a face is crossed at, once whichever way the faces there look. */
  readonly depths: Array<number>
}

/**
 * Reads into `into` the crossings of the column whose keys start at `keys[from]`, and returns the index of the next
 * column's first key.
 */
const readColumn = (rays: Rays, keys: Float64Array, from: number, column: number, into: Crossings): number => {
  const { depths, signedDepths, signs } = into
  signedDepths.length = 0
  signs.length = 0
  depths.length = 0
  let k = from
  for (; k < keys.length; k++) {
    const key = at(keys, k)
    const place = Math.floor(key / 2)
    if (Math.floor(place / rays.columnSpan) !== column) break
    const depth = (place - column * rays.columnSpan) / DEPTH_STEPS - 2
    const sign = key - place * 2 === 1 ? 1 : -1
    const last = signs.length - 1
    if (last < 0 || depth - (signedDepths[last] ?? 0) > SAME_DEPTH || signs[last] !== sign) {
      signedDepths.push(depth)
      signs.push(sign)
    }
    if (depths.length === 0 || depth - (depths[depths.length - 1] ?? 0) > SAME_DEPTH) depths.push(depth)
  }
  return k
}

/** What the rays say of each cell: how many of the three say inside, and how many don't vote. */
interface Votes {
  readonly inside: Uint8Array
  readonly abstain: Uint8Array
}

const bump = (counts: Uint8Array, cell: number) => {
  counts[cell] = at(counts, cell) + 1
}

/** Votes inside for each cell of the column starting at cell `base` whose centre is between the two depths. */
const voteInside = (rays: Rays, votes: Votes, base: number, from: number, to: number) => {
  const first = Math.max(0, Math.ceil(from - 0.5)), last = Math.min(rays.na - 1, Math.floor(to - 0.5))
  for (let ia = first; ia <= last; ia++) bump(votes.inside, base + ia * rays.stepA)
}

/** One ray's votes, for the column of cells starting at cell `base`. */
const voteColumn = (rays: Rays, base: number, { depths, signedDepths, signs }: Crossings, votes: Votes) => {
  let total = 0
  for (const sign of signs) total += sign
  if (total === 0) {
    // The count comes back to zero: inside wherever it isn't zero on the way.
    let winding = 0
    for (let p = 0; p < signs.length - 1; p++) {
      winding += signs[p] ?? 0
      if (winding !== 0) voteInside(rays, votes, base, signedDepths[p] ?? 0, signedDepths[p + 1] ?? 0)
    }
  } else if (depths.length % 2 === 0) {
    // Faces wound the wrong way: inside between each odd crossing and the next.
    for (let p = 0; p < depths.length; p += 2) voteInside(rays, votes, base, depths[p] ?? 0, depths[p + 1] ?? 0)
  } else {
    // An odd number of crossings: the ray went through a hole.
    for (let ia = 0; ia < rays.na; ia++) bump(votes.abstain, base + ia * rays.stepA)
  }
}

/** Adds the votes of the rays along `axis`. A ray that crosses nothing says outside of every cell. */
const voteAlong = (frame: GridFrame, g: Float64Array, axis: Axis, votes: Votes) => {
  const rays = raysAlong(frame, axis)
  const keys = crossingKeys(rays, g)
  const crossings: Crossings = { signedDepths: [], signs: [], depths: [] }
  let k = 0
  while (k < keys.length) {
    const column = Math.floor(Math.floor(at(keys, k) / 2) / rays.columnSpan)
    k = readColumn(rays, keys, k, column, crossings)
    const iu = column % rays.nu, iv = Math.floor(column / rays.nu)
    voteColumn(rays, iu * rays.stepU + iv * rays.stepV, crossings, votes)
  }
}

/** Marks every cell a triangle of `g` (grid units) passes through, by sampling each triangle finer than a cell. */
const markSurface = (frame: GridFrame, g: Float64Array, cells: Uint8Array) => {
  const [nx, ny, nz] = frame.n
  for (let t = 0; t < g.length; t += 9) {
    const ax = at(g, t), ay = at(g, t + 1), az = at(g, t + 2)
    const bx = at(g, t + 3) - ax, by = at(g, t + 4) - ay, bz = at(g, t + 5) - az
    const cx = at(g, t + 6) - ax, cy = at(g, t + 7) - ay, cz = at(g, t + 8) - az
    const longest = Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz), Math.hypot(cx - bx, cy - by, cz - bz))
    const steps = Math.min(4096, Math.max(1, Math.ceil(longest * 2)))
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const s = i / steps, r = j / steps
        const x = Math.floor(ax + bx * s + cx * r)
        const y = Math.floor(ay + by * s + cy * r)
        const z = Math.floor(az + bz * s + cz * r)
        if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) cells[x + nx * (y + ny * z)] = 1
      }
    }
  }
}

/** `triangles` in cell units of `frame`: cell (i, j, k) spans [i, i + 1) and so on. */
const toGridUnits = (frame: GridFrame, triangles: Float32Array): Float64Array => {
  const origin = [frame.origin.x, frame.origin.y, frame.origin.z] as const
  const g = new Float64Array(triangles.length)
  for (let i = 0; i < triangles.length; i++) g[i] = (at(triangles, i) - (origin[i % 3] ?? 0)) / frame.voxel
  return g
}

export const voxelize = (
  triangles: Float32Array,
  frame: GridFrame,
  options: { readonly surface: boolean }
): VoxelGrid => {
  const g = toGridUnits(frame, triangles)
  const count = cellCount(frame)
  const votes: Votes = { inside: new Uint8Array(count), abstain: new Uint8Array(count) }
  for (const axis of AXES) voteAlong(frame, g, axis, votes)
  const cells = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const voters = 3 - at(votes.abstain, i)
    cells[i] = voters > 0 && at(votes.inside, i) * 2 > voters ? 1 : 0
  }
  if (options.surface) markSurface(frame, g, cells)
  return { ...frame, cells }
}
