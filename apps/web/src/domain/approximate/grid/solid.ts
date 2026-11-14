/**
 * The model as a solid seen from outside: its cells with every sealed hollow filled, which also joins input shells
 * pushed through each other. Plates are held inside it and read its local thickness.
 */
import type { Vec3 } from "../../coords"
import { vecAdd, vecScale } from "../../ueMath"
import { depthInside, depthOutside, distanceTo } from "./distance"
import { at, cellCount, cellIndex, type GridFrame, type VoxelGrid } from "./voxelize"

/** `cells` with every empty cell the grid's border can't reach through empty cells filled, in place. */
export const fillSealed = (frame: GridFrame, cells: Uint8Array): Uint8Array => {
  const [nx, ny, nz] = frame.n
  const outside = new Uint8Array(cells.length)
  const queue = new Int32Array(cells.length)
  let queued = 0
  const reach = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return
    const i = cellIndex(frame, x, y, z)
    if (at(cells, i) === 1 || at(outside, i) === 1) return
    outside[i] = 1
    queue[queued++] = i
  }
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) reach(x, y, z)
      }
    }
  }
  for (let next = 0; next < queued; next++) {
    const i = at(queue, next)
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny))
    reach(x - 1, y, z)
    reach(x + 1, y, z)
    reach(x, y - 1, z)
    reach(x, y + 1, z)
    reach(x, y, z - 1)
    reach(x, y, z + 1)
  }
  for (let i = 0; i < cells.length; i++) if (at(outside, i) === 0) cells[i] = 1
  return cells
}

export class PlateSolid {
  /** The grid it was made from, its sealed hollows filled. */
  readonly grid: VoxelGrid
  /** Each cell's distance, in cells, to the nearest solid cell and to the nearest empty one. */
  private readonly outer: Float32Array
  private readonly inner: Float32Array

  constructor(grid: VoxelGrid) {
    this.grid = { ...grid, cells: fillSealed(grid, grid.cells.slice()) }
    this.outer = depthOutside(this.grid)
    this.inner = depthInside(this.grid)
  }

  /**
   * `field` at the point `p`, in cm: blended between the eight cell centres round it, and past the outermost centres
   * the nearest's value plus the distance to it.
   */
  private sample(p: Vec3, field: Float32Array): number {
    const { n, origin, voxel } = this.grid
    const x = (p.x - origin.x) / voxel - 0.5, y = (p.y - origin.y) / voxel - 0.5, z = (p.z - origin.z) / voxel - 0.5
    const inX = Math.max(0, Math.min(n[0] - 1, x))
    const inY = Math.max(0, Math.min(n[1] - 1, y))
    const inZ = Math.max(0, Math.min(n[2] - 1, z))
    const lowX = Math.floor(inX), lowY = Math.floor(inY), lowZ = Math.floor(inZ)
    const highX = Math.min(n[0] - 1, lowX + 1),
      highY = Math.min(n[1] - 1, lowY + 1),
      highZ = Math.min(n[2] - 1, lowZ + 1)
    let value = 0
    for (let corner = 0; corner < 8; corner++) {
      const upX = (corner & 1) === 1, upY = (corner & 2) === 2, upZ = (corner & 4) === 4
      const weight = (upX ? inX - lowX : 1 - inX + lowX) * (upY ? inY - lowY : 1 - inY + lowY) *
        (upZ ? inZ - lowZ : 1 - inZ + lowZ)
      value += weight * at(field, cellIndex(this.grid, upX ? highX : lowX, upY ? highY : lowY, upZ ? highZ : lowZ))
    }
    const beyond = Math.hypot(x - inX, y - inY, z - inZ)
    return (value + beyond) * voxel
  }

  /** The solid's largest inside distance, in cells: half its thickness where it is thickest. */
  get deepest(): number {
    let deepest = 0
    for (const depth of this.inner) deepest = Math.max(deepest, depth)
    return deepest
  }

  /** How far outside the solid `p` is, in cm, measured to its cells' faces, not to the raw mesh's inner triangles. */
  outside(p: Vec3): number {
    return Math.max(0, this.sample(p, this.outer) - this.grid.voxel * 0.5)
  }

  /**
   * How thick the solid is at `p` on its surface, in cm: twice the largest inside distance met stepping half a cell
   * at a time along `inward` until the first exit. The first three steps may still be outside.
   */
  thickness(p: Vec3, inward: Vec3): number {
    const voxel = this.grid.voxel
    let deepest = 0, entered = false
    for (let i = 1; i <= Math.max(...this.grid.n); i++) {
      const q = vecAdd(p, vecScale(inward, i * voxel * 0.5))
      if (this.outside(q) > voxel * 0.5) {
        if (entered || i > 3) break
        continue
      }
      entered = true
      deepest = Math.max(deepest, this.sample(q, this.inner))
    }
    return Math.max(voxel, deepest * 2)
  }
}

/** `grid`'s frame with `pad` more cells on every side. */
const paddedFrame = (grid: GridFrame, pad: number): GridFrame => ({
  n: [grid.n[0] + 2 * pad, grid.n[1] + 2 * pad, grid.n[2] + 2 * pad],
  origin: {
    x: grid.origin.x - pad * grid.voxel,
    y: grid.origin.y - pad * grid.voxel,
    z: grid.origin.z - pad * grid.voxel
  },
  voxel: grid.voxel
})

/**
 * `grid`'s solid closed by a ball of `radius` cells: grown that far, what the growth seals off filled, then shrunk
 * back. Hollows, wells and gaps narrower than twice the radius fill in and nothing else moves, so what is left is the
 * model as it looks from too far away to see them.
 */
export const closedGrid = (grid: VoxelGrid, radius: number): VoxelGrid => {
  // Room for the growth, and an empty cell round it for the fill to start from.
  const pad = Math.ceil(radius) + 1
  const wide = paddedFrame(grid, pad)
  const [nx, ny, nz] = grid.n
  /** Calls `visit` with each of the grid's cells and the same cell in the wide frame. */
  const eachCell = (visit: (cell: number, wideCell: number) => void) => {
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) visit(cellIndex(grid, x, y, z), cellIndex(wide, x + pad, y + pad, z + pad))
      }
    }
  }
  const solid = new Uint8Array(cellCount(wide))
  eachCell((cell, wideCell) => {
    solid[wideCell] = at(grid.cells, cell)
  })
  const near = distanceTo(wide, solid)
  const grown = new Uint8Array(near.length)
  for (let i = 0; i < grown.length; i++) grown[i] = at(near, i) <= radius ? 1 : 0
  fillSealed(wide, grown)
  const depth = distanceTo(wide, grown.map((cell) => 1 - cell))
  const cells = new Uint8Array(grid.cells.length)
  eachCell((cell, wideCell) => {
    cells[cell] = at(grid.cells, cell) === 1 || at(depth, wideCell) > radius ? 1 : 0
  })
  return { ...grid, cells }
}
