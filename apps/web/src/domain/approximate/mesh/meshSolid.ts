/**
 * The solid a closed low-poly mesh bounds: whether a point is inside it, and how far outside it a point is. Plates'
 * pieces must hide inside this solid, since its faces are what shows.
 */
import type { Vec3 } from "../../coords"
import { at } from "../grid/voxelize"
import { type Mesh, trianglesOfMesh } from "./mesh"
import { Surface } from "./surface"

export class MeshSolid {
  /** Nine numbers a face, as doubles for the winding loop. */
  private readonly corners: Float64Array
  private readonly surface: Surface

  constructor(mesh: Mesh) {
    this.corners = Float64Array.from(trianglesOfMesh(mesh))
    this.surface = new Surface(mesh)
  }

  /**
   * The generalised winding number about `p`: ±1 inside a closed mesh, 0 outside, the sign by which way the faces are
   * wound. It is the faces' solid angles seen from `p` (Van Oosterom and Strackee's formula) over the whole sphere.
   */
  winding(p: Vec3): number {
    const d = this.corners
    let total = 0
    for (let o = 0; o < d.length; o += 9) {
      const ax = at(d, o) - p.x, ay = at(d, o + 1) - p.y, az = at(d, o + 2) - p.z
      const bx = at(d, o + 3) - p.x, by = at(d, o + 4) - p.y, bz = at(d, o + 5) - p.z
      const cx = at(d, o + 6) - p.x, cy = at(d, o + 7) - p.y, cz = at(d, o + 8) - p.z
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz)
      const triple = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
      const below = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la +
        (cx * ax + cy * ay + cz * az) * lb
      total += 2 * Math.atan2(triple, below)
    }
    return total / (4 * Math.PI)
  }

  /** 0 inside the solid, wound either way; otherwise the distance to its surface. */
  outside(p: Vec3): number {
    if (Math.abs(this.winding(p)) >= 0.5) return 0
    return Math.sqrt(this.surface.nearest(p).squared)
  }
}
