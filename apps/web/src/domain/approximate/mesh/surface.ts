/**
 * A mesh's surface, for the two questions plates ask of it many thousands of times: the point of it nearest some
 * point, and where a ray first meets it. The faces sit in a tree of boxes, so a query reads only the faces near it.
 */
import type { Vec3 } from "../../coords"
import { vecAdd, vecCross, vecDot, vecScale, vecSub } from "../../ueMath"
import { at } from "../grid/voxelize"
import { type Mesh, trianglesOfMesh } from "./mesh"

type Weights = readonly [number, number, number]

/** The surface's point nearest a query: where on which face, and the squared distance to it. */
interface SurfaceHit {
  readonly point: Vec3
  /** The point's barycentric weights over the face's three corners. */
  readonly weights: Weights
  readonly face: number
  readonly squared: number
}

const AXES = ["x", "y", "z"] as const

/** A box round some faces: a leaf lists them, and any other node has two children that share them out. */
interface Node {
  readonly min: Vec3
  readonly max: Vec3
  readonly faces: ReadonlyArray<number>
  readonly children?: readonly [Node, Node]
}

/** The most faces a leaf holds. */
const LEAF_FACES = 8

/** A ray's direction along an axis, or its determinant with a triangle, below this counts as parallel. */
const PARALLEL = 1e-12

const pointAt = (data: Float32Array, i: number): Vec3 => ({ x: at(data, i), y: at(data, i + 1), z: at(data, i + 2) })

/** The box round `faces` of the flat list `triangles`. */
const boxOf = (triangles: Float32Array, faces: ReadonlyArray<number>): { min: Vec3; max: Vec3 } => {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const p = pointAt(triangles, 9 * f + 3 * k)
      for (const axis of AXES) {
        min[axis] = Math.min(min[axis], p[axis])
        max[axis] = Math.max(max[axis], p[axis])
      }
    }
  }
  return { min, max }
}

/** The axis the box is longest along, as an offset into a corner: a tie goes to the later axis. */
const longestAxis = (min: Vec3, max: Vec3): number =>
  max.x - min.x > max.y - min.y
    ? (max.x - min.x > max.z - min.z ? 0 : 2)
    : (max.y - min.y > max.z - min.z ? 1 : 2)

/** The tree over `faces`: a node with more than a leaf's worth is halved at the median face along its longest axis. */
const treeOf = (triangles: Float32Array, faces: Array<number>): Node => {
  const { max, min } = boxOf(triangles, faces)
  if (faces.length <= LEAF_FACES) return { min, max, faces }
  const axis = longestAxis(min, max)
  // Three times the face's centre along the axis, which sorts the same.
  const centre = (f: number) =>
    at(triangles, 9 * f + axis) + at(triangles, 9 * f + axis + 3) + at(triangles, 9 * f + axis + 6)
  faces.sort((a, b) => centre(a) - centre(b))
  const middle = Math.floor(faces.length / 2)
  return {
    min,
    max,
    faces: [],
    children: [treeOf(triangles, faces.slice(0, middle)), treeOf(triangles, faces.slice(middle))]
  }
}

/**
 * The barycentric weights of the point of triangle a, b, c nearest `p`: inside the face, or on the edge or corner whose
 * region `p` is in (Ericson's closest point on a triangle).
 */
const nearestWeights = (p: Vec3, a: Vec3, b: Vec3, c: Vec3): Weights => {
  const ab = vecSub(b, a), ac = vecSub(c, a), ap = vecSub(p, a)
  const d1 = vecDot(ab, ap), d2 = vecDot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
  const bp = vecSub(p, b), d3 = vecDot(ab, bp), d4 = vecDot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [1 - v, v, 0]
  }
  const cp = vecSub(p, c), d5 = vecDot(ab, cp), d6 = vecDot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [1 - w, 0, w]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6)
    return [0, 1 - w, w]
  }
  const sum = va + vb + vc
  return Math.abs(sum) < 1e-20 ? [1, 0, 0] : [va / sum, vb / sum, vc / sum]
}

/** The squared distance from `p` to the node's box: 0 inside it. */
const squaredToBox = (node: Node, p: Vec3): number => {
  let squared = 0
  for (const axis of AXES) squared += Math.max(node.min[axis] - p[axis], 0, p[axis] - node.max[axis]) ** 2
  return squared
}

/** Whether the ray from `from` along `direction` is inside the node's box anywhere between `low` and `high` along it. */
const rayMeetsBox = (node: Node, from: Vec3, direction: Vec3, low: number, high: number): boolean => {
  for (const axis of AXES) {
    if (Math.abs(direction[axis]) < PARALLEL) {
      if (from[axis] < node.min[axis] || from[axis] > node.max[axis]) return false
    } else {
      const a = (node.min[axis] - from[axis]) / direction[axis], b = (node.max[axis] - from[axis]) / direction[axis]
      low = Math.max(low, Math.min(a, b))
      high = Math.min(high, Math.max(a, b))
    }
  }
  return !(low > high)
}

/** How far along the ray it crosses triangle a, b, c (Möller and Trumbore's test), or undefined where it misses. */
const rayMeetsTriangle = (from: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3): number | undefined => {
  const e1 = vecSub(b, a), e2 = vecSub(c, a), h = vecCross(direction, e2), det = vecDot(e1, h)
  if (Math.abs(det) < PARALLEL) return undefined
  const s = vecSub(from, a), u = vecDot(s, h) / det
  if (u < 0 || u > 1) return undefined
  const q = vecCross(s, e1), v = vecDot(direction, q) / det
  if (v < 0 || u + v > 1) return undefined
  return vecDot(e2, q) / det
}

export class Surface {
  private readonly triangles: Float32Array
  private readonly root: Node

  constructor(mesh: Mesh) {
    this.triangles = trianglesOfMesh(mesh)
    this.root = treeOf(this.triangles, Array.from({ length: mesh.indices.length / 3 }, (_, f) => f))
  }

  private corners(face: number): readonly [Vec3, Vec3, Vec3] {
    return [
      pointAt(this.triangles, 9 * face),
      pointAt(this.triangles, 9 * face + 3),
      pointAt(this.triangles, 9 * face + 6)
    ]
  }

  /**
   * How far the ray from `from` along `direction` goes before it first meets the surface further than `minimum` along,
   * or Infinity where it never does. Plates bound a hidden piece's depth with it.
   */
  along(from: Vec3, direction: Vec3, minimum: number): number {
    let nearest = Infinity
    const visit = (node: Node) => {
      if (!rayMeetsBox(node, from, direction, minimum, nearest)) return
      for (const child of node.children ?? []) visit(child)
      for (const face of node.faces) {
        const [a, b, c] = this.corners(face)
        const t = rayMeetsTriangle(from, direction, a, b, c)
        if (t !== undefined && t > minimum && t < nearest) nearest = t
      }
    }
    visit(this.root)
    return nearest
  }

  /** The surface's point nearest `p`. Of points equally near, the first the tree comes to. */
  nearest(p: Vec3): SurfaceHit {
    let best: SurfaceHit = { point: p, weights: [1, 0, 0], face: 0, squared: Infinity }
    const visit = (node: Node) => {
      if (squaredToBox(node, p) > best.squared) return
      if (node.children !== undefined) {
        // The nearer child first, so the farther one is more often skipped whole.
        const [a, b] = node.children
        if (squaredToBox(a, p) < squaredToBox(b, p)) {
          visit(a)
          visit(b)
        } else {
          visit(b)
          visit(a)
        }
      }
      for (const face of node.faces) {
        const [a, b, c] = this.corners(face)
        const weights = nearestWeights(p, a, b, c)
        const point = vecAdd(vecAdd(vecScale(a, weights[0]), vecScale(b, weights[1])), vecScale(c, weights[2]))
        const delta = vecSub(p, point), squared = vecDot(delta, delta)
        if (squared < best.squared) best = { point, weights, face, squared }
      }
    }
    visit(this.root)
    return best
  }
}
