/**
 * Distances over a grid, in cells: the exact Euclidean distance transform of Felzenszwalb and Huttenlocher, one pass
 * along each axis. The fitters read how deep a cell is inside the model and how far one is outside it; the measures
 * read how far one surface is from another.
 */
import { at, cellCount, cellIndex, forEachSolid, type GridFrame, type VoxelGrid } from "./voxelize"

/**
 * One pass of the transform along a line of cells: each cell's squared distance becomes the least, over the line's
 * cells p, of p's squared distance plus the squared distance from p along the line. That is the lower envelope of one
 * parabola a cell, found in a sweep that keeps the parabolas on the envelope and where each takes over.
 */
class LinePass {
  /** The line's values before the pass, and after. */
  private readonly before: Float64Array
  private readonly after: Float64Array
  /** The cells whose parabolas are on the envelope, left to right, and where each one's stretch starts. */
  private readonly vertex: Int32Array
  private readonly starts: Float64Array

  constructor(longest: number) {
    this.before = new Float64Array(longest)
    this.after = new Float64Array(longest)
    this.vertex = new Int32Array(longest)
    this.starts = new Float64Array(longest + 1)
  }

  /** Where the parabolas of cells `q` and `p` cross. */
  private crossing(q: number, p: number): number {
    const f = this.before
    return (at(f, q) + q * q - (at(f, p) + p * p)) / (2 * q - 2 * p)
  }

  /** Runs the pass over the `count` values of `squared` from `offset`, `step` apart. */
  run(squared: Float64Array, count: number, offset: number, step: number) {
    const { after, before, starts, vertex } = this
    for (let i = 0; i < count; i++) before[i] = at(squared, offset + i * step)
    let k = 0
    vertex[0] = 0
    starts[0] = -Infinity
    starts[1] = Infinity
    for (let q = 1; q < count; q++) {
      // The first stretch starts at -Infinity, so k never drops below 0.
      let s = this.crossing(q, at(vertex, k))
      while (s <= at(starts, k)) {
        k--
        s = this.crossing(q, at(vertex, k))
      }
      k++
      vertex[k] = q
      starts[k] = s
      starts[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < count; q++) {
      while (at(starts, k + 1) < q) k++
      const p = at(vertex, k)
      after[q] = (q - p) * (q - p) + at(before, p)
    }
    for (let i = 0; i < count; i++) squared[offset + i * step] = at(after, i)
  }
}

/** Each cell's distance to the nearest cell `sources` marks with 1; 0 on a source. */
export const distanceTo = (frame: GridFrame, sources: Uint8Array): Float32Array => {
  const [nx, ny, nz] = frame.n
  const far = (nx + ny + nz) ** 2
  const squared = new Float64Array(cellCount(frame))
  for (let i = 0; i < squared.length; i++) squared[i] = at(sources, i) === 1 ? 0 : far
  const pass = new LinePass(Math.max(nx, ny, nz))
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) pass.run(squared, nx, nx * (y + ny * z), 1)
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) pass.run(squared, ny, x + nx * ny * z, nx)
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) pass.run(squared, nz, x + nx * y, nx * ny)
  const distance = new Float32Array(squared.length)
  for (let i = 0; i < squared.length; i++) distance[i] = Math.sqrt(at(squared, i))
  return distance
}

/** Each solid cell's distance to the nearest empty one; 0 outside. */
export const depthInside = (grid: VoxelGrid): Float32Array => distanceTo(grid, grid.cells.map((cell) => 1 - cell))

/** Each empty cell's distance to the nearest solid one; 0 inside. */
export const depthOutside = (grid: VoxelGrid): Float32Array => distanceTo(grid, grid.cells)

/** The solid cells that show: those with an empty neighbour, or on the grid's edge. */
export const surfaceCells = (frame: GridFrame, cells: Uint8Array): Uint8Array => {
  const shows = new Uint8Array(cells.length)
  forEachSolid(frame, cells, (x, y, z, solid) => {
    const buried = solid(x - 1, y, z) && solid(x + 1, y, z) && solid(x, y - 1, z) && solid(x, y + 1, z) &&
      solid(x, y, z - 1) && solid(x, y, z + 1)
    if (!buried) shows[cellIndex(frame, x, y, z)] = 1
  })
  return shows
}
