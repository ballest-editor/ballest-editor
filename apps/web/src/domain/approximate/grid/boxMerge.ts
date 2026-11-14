/**
 * The two voxel baselines, each piece a scaled cube along the grid's axes.
 *
 * Merged boxes covers the solid cells with as few boxes as a greedy pass finds. Items may overlap in a map, so a box
 * may grow over cells another box covers; it only has to start on one nobody does. Boxes start at the uncovered cell
 * deepest inside the model (distance.ts), so the first are the big middles. Each grows both ways along each axis in
 * turn, in each of the six orders of the axes, and the order that covers the most new cells is kept. The result is
 * largest first, so its first N are a fair N-piece version.
 *
 * Voxel cubes is one cube per solid cell that shows.
 */
import { IDENTITY_QUAT, type Placement } from "../shapes"
import { depthInside, surfaceCells } from "./distance"
import { at, type Axis, cellCount, cellIndex, type VoxelGrid } from "./voxelize"

type Cell = readonly [number, number, number]

/** Cells [from, to) along each axis. */
interface CellBox {
  readonly from: Cell
  readonly to: Cell
}

const ORDERS: ReadonlyArray<ReadonlyArray<Axis>> = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]

/** How many solid cells any box holds, in eight lookups: the counts of the boxes from the grid's corner. */
class SolidCounts {
  /** At (x, y, z), the solid cells in [0, x) by [0, y) by [0, z). */
  private readonly sums: Int32Array
  private readonly nx: number
  private readonly ny: number

  constructor(grid: VoxelGrid) {
    const [nx, ny, nz] = grid.n
    this.nx = nx + 1
    this.ny = ny + 1
    this.sums = new Int32Array(this.nx * this.ny * (nz + 1))
    for (let z = 1; z <= nz; z++) {
      for (let y = 1; y <= ny; y++) {
        for (let x = 1; x <= nx; x++) {
          this.sums[this.index(x, y, z)] = at(grid.cells, cellIndex(grid, x - 1, y - 1, z - 1)) +
            this.sum(x - 1, y, z) + this.sum(x, y - 1, z) + this.sum(x, y, z - 1) -
            this.sum(x - 1, y - 1, z) - this.sum(x - 1, y, z - 1) - this.sum(x, y - 1, z - 1) +
            this.sum(x - 1, y - 1, z - 1)
        }
      }
    }
  }

  private index(x: number, y: number, z: number) {
    return x + this.nx * (y + this.ny * z)
  }

  private sum(x: number, y: number, z: number) {
    return at(this.sums, this.index(x, y, z))
  }

  /** Solid cells in [from, to). */
  count(from: Cell, to: Cell): number {
    const x0 = from[0], y0 = from[1], z0 = from[2], x1 = to[0], y1 = to[1], z1 = to[2]
    return this.sum(x1, y1, z1) - this.sum(x0, y1, z1) - this.sum(x1, y0, z1) - this.sum(x1, y1, z0) +
      this.sum(x0, y0, z1) + this.sum(x0, y1, z0) + this.sum(x1, y0, z0) - this.sum(x0, y0, z0)
  }
}

const volumeOf = ({ from, to }: CellBox) => (to[0] - from[0]) * (to[1] - from[1]) * (to[2] - from[2])

/** The box grown from the cell `seed` along each axis of `order` in turn, both ways, while whole layers are solid. */
const grow = (grid: VoxelGrid, solid: SolidCounts, seed: Cell, order: ReadonlyArray<Axis>): CellBox => {
  const from: [number, number, number] = [...seed]
  const to: [number, number, number] = [seed[0] + 1, seed[1] + 1, seed[2] + 1]
  const box = { from, to }
  /** Whether every cell of the box's one layer at `layer` along `axis` is solid. */
  const layerSolid = (axis: Axis, layer: number) => {
    if (layer < 0 || layer >= grid.n[axis]) return false
    const first = from[axis], end = to[axis]
    from[axis] = layer
    to[axis] = layer + 1
    const full = solid.count(from, to) === volumeOf(box)
    from[axis] = first
    to[axis] = end
    return full
  }
  for (const axis of order) {
    while (layerSolid(axis, to[axis])) to[axis]++
    while (layerSolid(axis, from[axis] - 1)) from[axis]--
  }
  return box
}

const forEachCell = (grid: VoxelGrid, { from, to }: CellBox, visit: (index: number) => void) => {
  for (let z = from[2]; z < to[2]; z++) {
    for (let y = from[1]; y < to[1]; y++) {
      for (let x = from[0]; x < to[0]; x++) visit(cellIndex(grid, x, y, z))
    }
  }
}

/** The cell at `index` of the grid's cells. */
const cellAt = (grid: VoxelGrid, index: number): Cell => {
  const [nx, ny] = grid.n
  return [index % nx, Math.floor(index / nx) % ny, Math.floor(index / (nx * ny))]
}

/** The cube that fills `box`. */
const placementOfCells = (grid: VoxelGrid, { from, to }: CellBox): Placement => {
  const middle = (axis: Axis) => (from[axis] + to[axis]) / 2 * grid.voxel
  const half = (axis: Axis) => (to[axis] - from[axis]) / 2 * grid.voxel
  return {
    kind: "box",
    center: { x: grid.origin.x + middle(0), y: grid.origin.y + middle(1), z: grid.origin.z + middle(2) },
    half: { x: half(0), y: half(1), z: half(2) },
    rotation: IDENTITY_QUAT
  }
}

/** The solid cells, deepest inside the model first. */
const seedsOf = (grid: VoxelGrid): ReadonlyArray<number> => {
  const depth = depthInside(grid)
  const seeds: Array<number> = []
  for (let i = 0; i < grid.cells.length; i++) if (at(grid.cells, i) === 1) seeds.push(i)
  return seeds.sort((a, b) => at(depth, b) - at(depth, a) || a - b)
}

/** Merged boxes: the cubes that cover `grid`'s solid cells, largest first. */
export const mergeBoxes = (grid: VoxelGrid): ReadonlyArray<Placement> => {
  const covered = new Uint8Array(cellCount(grid))
  const solid = new SolidCounts(grid)
  const uncoveredIn = (box: CellBox) => {
    let uncovered = 0
    forEachCell(grid, box, (i) => {
      uncovered += 1 - at(covered, i)
    })
    return uncovered
  }
  const boxes: Array<CellBox> = []
  for (const index of seedsOf(grid)) {
    if (at(covered, index) === 1) continue
    let best: CellBox | undefined
    let bestGain = 0
    for (const order of ORDERS) {
      const box = grow(grid, solid, cellAt(grid, index), order)
      const gain = uncoveredIn(box)
      if (gain > bestGain) {
        best = box
        bestGain = gain
      }
    }
    if (best === undefined) continue
    forEachCell(grid, best, (i) => {
      covered[i] = 1
    })
    boxes.push(best)
  }
  return boxes.sort((a, b) => volumeOf(b) - volumeOf(a)).map((box) => placementOfCells(grid, box))
}

/** Voxel cubes: one cube per solid cell that shows, a cell with an empty neighbour. */
export const surfaceCubes = (grid: VoxelGrid): ReadonlyArray<Placement> => {
  const shows = surfaceCells(grid, grid.cells)
  const placements: Array<Placement> = []
  for (let i = 0; i < shows.length; i++) {
    if (at(shows, i) === 0) continue
    const [x, y, z] = cellAt(grid, i)
    placements.push(placementOfCells(grid, { from: [x, y, z], to: [x + 1, y + 1, z + 1] }))
  }
  return placements
}
