/**
 * A flat, rectilinear model as rectangular plates. The grid is cut into layers across its shortest side; the layer
 * with the most cells no plate covers yet is covered with rectangles (boxMerge.ts), and each rectangle runs on through
 * the layers on either side for as long as the model fills all of it. Plates may overlap: a map draws their union.
 */
import { mergeBoxes } from "../grid/boxMerge"
import { at, type Axis, type VoxelGrid } from "../grid/voxelize"
import { IDENTITY_QUAT, type Placement } from "../shapes"

const KEYS = ["x", "y", "z"] as const

/** The grid's axes as the layers see them: `w` across the layers, the shortest side, and `u`, `v` within one. */
const layerAxes = (n: VoxelGrid["n"]): readonly [w: Axis, u: Axis, v: Axis] =>
  n[0] <= Math.min(n[1], n[2]) ? [0, 1, 2] : n[1] <= n[2] ? [1, 2, 0] : [2, 0, 1]

/** A rectangle of a layer's cells: `a` along u and `b` along v, each from its first cell to one past its last. */
interface CellRect {
  readonly a0: number
  readonly a1: number
  readonly b0: number
  readonly b1: number
}

/** Calls `each` on every cell of `rect`, row by row. */
const forEachIn = (rect: CellRect, each: (a: number, b: number) => void): void => {
  for (let b = rect.b0; b < rect.b1; b++) {
    for (let a = rect.a0; a < rect.a1; a++) each(a, b)
  }
}

export const rectangularPlates = (grid: VoxelGrid): ReadonlyArray<Placement> => {
  const [w, u, v] = layerAxes(grid.n)
  const nu = grid.n[u], nv = grid.n[v], nw = grid.n[w]
  const origin = [grid.origin.x, grid.origin.y, grid.origin.z] as const
  const strides = [1, grid.n[0], grid.n[0] * grid.n[1]] as const
  const index = (a: number, b: number, layer: number) => a * strides[u] + b * strides[v] + layer * strides[w]
  const whole: CellRect = { a0: 0, a1: nu, b0: 0, b1: nv }

  const covered = new Uint8Array(grid.cells.length)
  /** Per layer, the model's cells no plate covers yet. */
  const open = new Uint32Array(nw)
  for (let layer = 0; layer < nw; layer++) {
    forEachIn(whole, (a, b) => {
      open[layer] = at(open, layer) + at(grid.cells, index(a, b, layer))
    })
  }

  /** The layer with the most open cells, the first of equals; -1 once none has any. */
  const mostOpen = (): number => {
    let found = -1, most = 0
    for (let layer = 0; layer < nw; layer++) {
      if (at(open, layer) > most) {
        found = layer
        most = at(open, layer)
      }
    }
    return found
  }

  /** The open cells of `layer` as a grid one cell deep, for the rectangle merge. */
  const openCells = (layer: number): VoxelGrid => {
    const cells = new Uint8Array(nu * nv)
    forEachIn(whole, (a, b) => {
      const i = index(a, b, layer)
      cells[a + nu * b] = at(grid.cells, i) === 1 && at(covered, i) === 0 ? 1 : 0
    })
    return { n: [nu, nv, 1], origin: { x: origin[u], y: origin[v], z: 0 }, voxel: grid.voxel, cells }
  }

  const cellsOf = (rect: Placement): CellRect => ({
    a0: Math.round((rect.center.x - rect.half.x - origin[u]) / grid.voxel),
    a1: Math.round((rect.center.x + rect.half.x - origin[u]) / grid.voxel),
    b0: Math.round((rect.center.y - rect.half.y - origin[v]) / grid.voxel),
    b1: Math.round((rect.center.y + rect.half.y - origin[v]) / grid.voxel)
  })

  /** Whether the model fills all of `rect` in `layer`. */
  const full = (rect: CellRect, layer: number): boolean => {
    for (let b = rect.b0; b < rect.b1; b++) {
      for (let a = rect.a0; a < rect.a1; a++) if (at(grid.cells, index(a, b, layer)) === 0) return false
    }
    return true
  }

  const cover = (rect: CellRect, layer: number) =>
    forEachIn(rect, (a, b) => {
      const i = index(a, b, layer)
      if (at(covered, i) === 0) {
        covered[i] = 1
        open[layer] = at(open, layer) - 1
      }
    })

  const pieces: Array<Placement> = []
  for (let seed = mostOpen(); seed >= 0; seed = mostOpen()) {
    for (const rect of mergeBoxes(openCells(seed))) {
      const cells = cellsOf(rect)
      // The plate's layers, from `begin` to one short of `end`.
      let begin = seed, end = seed + 1
      while (begin > 0 && full(cells, begin - 1)) begin--
      while (end < nw && full(cells, end)) end++
      for (let layer = begin; layer < end; layer++) cover(cells, layer)
      const center = { x: 0, y: 0, z: 0 }, half = { x: 0, y: 0, z: 0 }
      center[KEYS[u]] = rect.center.x
      center[KEYS[v]] = rect.center.y
      center[KEYS[w]] = origin[w] + (begin + end) * grid.voxel / 2
      half[KEYS[u]] = rect.half.x
      half[KEYS[v]] = rect.half.y
      half[KEYS[w]] = (end - begin) * grid.voxel / 2
      pieces.push({ kind: "box", center, half, rotation: IDENTITY_QUAT })
    }
  }
  return pieces
}
