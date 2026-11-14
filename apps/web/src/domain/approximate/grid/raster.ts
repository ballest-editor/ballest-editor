/**
 * A placed shape over a grid: the cells whose centres it holds. The greedy fit scores candidates with it and the
 * measures draw every method's result into one grid with it, so every method is judged the same way.
 */
import type { Quat4 } from "../../coords"
import { type Placement, type ShapeKind, SHAPES } from "../shapes"
import { cellIndex, type GridFrame } from "./voxelize"

/** A placement in a grid's cell units: cell (i, j, k) spans [i, i + 1) along each axis. */
export interface GridShape {
  readonly kind: ShapeKind
  /** Its centre, its half extents along its own axes, and its turn. */
  readonly c: readonly [number, number, number]
  readonly h: readonly [number, number, number]
  readonly q: Quat4
}

/** The rotation's matrix, row by row: column j is the turned thing's own axis j. */
export const rotationMatrix = (
  { w, x, y, z }: Quat4
): readonly [number, number, number, number, number, number, number, number, number] => [
  1 - 2 * (y * y + z * z),
  2 * (x * y - w * z),
  2 * (x * z + w * y),
  2 * (x * y + w * z),
  1 - 2 * (x * x + z * z),
  2 * (y * z - w * x),
  2 * (x * z - w * y),
  2 * (y * z + w * x),
  1 - 2 * (x * x + y * y)
]

export const toGridShape = ({ origin, voxel }: GridFrame, { center, half, kind, rotation }: Placement): GridShape => ({
  kind,
  c: [(center.x - origin.x) / voxel, (center.y - origin.y) / voxel, (center.z - origin.z) / voxel],
  h: [half.x / voxel, half.y / voxel, half.z / voxel],
  q: rotation
})

export const toPlacement = ({ origin, voxel }: GridFrame, { c, h, kind, q }: GridShape): Placement => ({
  kind,
  center: { x: origin.x + c[0] * voxel, y: origin.y + c[1] * voxel, z: origin.z + c[2] * voxel },
  half: { x: h[0] * voxel, y: h[1] * voxel, z: h[2] * voxel },
  rotation: q
})

/** How far the shape reaches from its centre along each grid axis: half its bounding box once turned. */
export const reachOf = (shape: GridShape): readonly [number, number, number] => {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotationMatrix(shape.q)
  const [hx, hy, hz] = shape.h
  return [
    Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz,
    Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz,
    Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz
  ]
}

/** How many cells the shape's bounding box spans: what a full `forEachCellIn` walks. */
export const boundingCells = (shape: GridShape): number => {
  const [reachX, reachY, reachZ] = reachOf(shape)
  return 8 * reachX * reachY * reachZ
}

/**
 * Calls `visit` with the index of every cell whose centre is inside `shape`, x fastest, then y, then z, and returns
 * how many there were. With `stride` above 1 it tries only every `stride`th cell along each axis, for a quick
 * estimate.
 */
export const forEachCellIn = (
  frame: GridFrame,
  shape: GridShape,
  visit: (index: number) => void,
  stride = 1
): number => {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotationMatrix(shape.q)
  const [cx, cy, cz] = shape.c
  const [reachX, reachY, reachZ] = reachOf(shape)
  const [nx, ny, nz] = frame.n
  const x0 = Math.max(0, Math.ceil(cx - reachX - 0.5)), x1 = Math.min(nx - 1, Math.floor(cx + reachX - 0.5))
  const y0 = Math.max(0, Math.ceil(cy - reachY - 0.5)), y1 = Math.min(ny - 1, Math.floor(cy + reachY - 0.5))
  const z0 = Math.max(0, Math.ceil(cz - reachZ - 0.5)), z1 = Math.min(nz - 1, Math.floor(cz + reachZ - 0.5))
  const inside = SHAPES[shape.kind].inside
  const perX = 1 / shape.h[0], perY = 1 / shape.h[1], perZ = 1 / shape.h[2]
  // A coarse estimate starts mid-stride, so it doesn't always miss the same edge.
  const start = stride > 1 ? Math.floor(stride / 2) : 0
  let visited = 0
  for (let z = z0 + start; z <= z1; z += stride) {
    const dz = z + 0.5 - cz
    for (let y = y0 + start; y <= y1; y += stride) {
      const dy = y + 0.5 - cy
      for (let x = x0 + start; x <= x1; x += stride) {
        const dx = x + 0.5 - cx
        // The cell's centre in the shape's normalised box, an axis at a time.
        const lx = (r00 * dx + r10 * dy + r20 * dz) * perX
        if (lx < -1 || lx > 1) continue
        const ly = (r01 * dx + r11 * dy + r21 * dz) * perY
        if (ly < -1 || ly > 1) continue
        const lz = (r02 * dx + r12 * dy + r22 * dz) * perZ
        if (lz < -1 || lz > 1) continue
        if (!inside(lx, ly, lz)) continue
        visited++
        visit(cellIndex(frame, x, y, z))
      }
    }
  }
  return visited
}
