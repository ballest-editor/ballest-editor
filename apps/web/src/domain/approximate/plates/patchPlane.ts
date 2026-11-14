/** One patch of nearly coplanar faces in its own plane, and the rectangles that cover it. */
import type { Vec3 } from "../../coords"
import { vecAdd, vecCross, vecDot, vecNormalize, vecScale, vecSub } from "../../ueMath"
import { at, pointAt } from "../grid/voxelize"
import type { Mesh } from "../mesh/mesh"
import { cornersOf, edgeKey, type Face, type Patch } from "./plateFaces"

type Point = readonly [number, number]

/** The convex hull, anticlockwise (Andrew's monotone chain). */
const hullOf = (points: ReadonlyArray<Point>): Array<Point> => {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const turn = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  /** One side of the hull, from the first of `list` to the one before its last. */
  const side = (list: ReadonlyArray<Point>) => {
    const out: Array<Point> = []
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2] ?? p, out[out.length - 1] ?? p, p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...side(sorted), ...side(sorted.toReversed())]
}

/** The direction of the smallest rectangle round `points`: that of one of their hull's edges. */
const rectangleAngle = (points: ReadonlyArray<Point>): number => {
  const hull = hullOf(points)
  let best = 0, bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    if (a === undefined || b === undefined) continue
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const c = Math.cos(angle), s = Math.sin(angle)
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity
    for (const p of hull) {
      const ps = p[0] * c + p[1] * s, pt = -p[0] * s + p[1] * c
      s0 = Math.min(s0, ps)
      s1 = Math.max(s1, ps)
      t0 = Math.min(t0, pt)
      t1 = Math.max(t1, pt)
    }
    const area = (s1 - s0) * (t1 - t0)
    if (area < bestArea) {
      bestArea = area
      best = angle
    }
  }
  return best
}

const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Whether `p` is in the triangle or on its edge, whichever way it is wound. */
const insideTriangle = (p: Point, a: Point, b: Point, c: Point): boolean => {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
  const negative = d1 < 0 || d2 < 0 || d3 < 0, positive = d1 > 0 || d2 > 0 || d3 > 0
  return !(negative && positive)
}

/** A rectangle in a patch's plane, in its (s, t) axes. */
export interface Rect {
  readonly s0: number
  readonly s1: number
  readonly t0: number
  readonly t1: number
}

/**
 * A face across an outline edge is level with the patch, or rises above it, when the direction from the edge's middle
 * to its centroid has more than this along the patch face's normal: about a degree below level.
 */
const LEVEL = -0.02

/** A patch in its plane: the plane's axes, the patch's faces and outline in them, and where a plate may go. */
export class PatchPlane {
  readonly patch: Patch
  /** The plane's axes in the world: `s` along the smallest rectangle round the patch, `t` square to it. */
  readonly s: Vec3
  readonly t: Vec3
  readonly triangles: Array<{ readonly face: number; readonly corners: readonly [Point, Point, Point] }> = []
  /** The outline's edges, and whether a plate may run past each. */
  readonly outline: Array<{ readonly a: Point; readonly b: Point; readonly concave: boolean }> = []
  /** The corners of the patch's bounds. */
  readonly from: Point
  readonly to: Point

  /** `patch` is patch `id` of `patchOf`; its plane goes through its centroid, square to its normal. */
  constructor(
    patch: Patch,
    mesh: Mesh,
    faces: ReadonlyArray<Face>,
    edges: Map<number, Array<number>>,
    patchOf: Int32Array,
    id: number
  ) {
    this.patch = patch
    const n = patch.normal
    const helper: Vec3 = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    const u = vecNormalize(vecCross(n, helper)), v = vecCross(n, u)
    const inPlane = (p: Vec3, s: Vec3, t: Vec3): Point => {
      const d = vecSub(p, patch.centroid)
      return [vecDot(d, s), vecDot(d, t)]
    }
    const corners = patch.faces.flatMap((f) => faces[f]?.corners ?? [])
    const angle = rectangleAngle(corners.map((i) => inPlane(pointAt(mesh.positions, i), u, v)))
    this.s = vecAdd(vecScale(u, Math.cos(angle)), vecScale(v, Math.sin(angle)))
    this.t = vecCross(n, this.s)
    const local = (p: Vec3): Point => inPlane(p, this.s, this.t)

    const vertices = mesh.positions.length / 3
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity
    for (const f of patch.faces) {
      const face = faces[f]
      if (face === undefined) continue
      const [pa, pb, pc] = cornersOf(mesh.positions, face.corners)
      const triangle = [local(pa), local(pb), local(pc)] as const
      this.triangles.push({ face: f, corners: triangle })
      for (const p of triangle) {
        s0 = Math.min(s0, p[0])
        s1 = Math.max(s1, p[0])
        t0 = Math.min(t0, p[1])
        t1 = Math.max(t1, p[1])
      }
      for (let k = 0; k < 3; k++) {
        const i = face.corners[k] ?? 0, j = face.corners[(k + 1) % 3] ?? 0
        const onEdge = edges.get(edgeKey(i, j, vertices)) ?? []
        // An edge two of the patch's faces share is inside the patch.
        if (onEdge.filter((g) => at(patchOf, g) === id).length > 1) continue
        const across = onEdge.filter((g) => at(patchOf, g) !== id)
        const pi = pointAt(mesh.positions, i), pj = pointAt(mesh.positions, j)
        const middle = vecScale(vecAdd(pi, pj), 0.5)
        // Concave where every face across the edge is level with this one or rises above it. The direction to the
        // face's centroid tells, so a long edge between faces folded convex isn't let past.
        const concave = across.length > 0 && across.every((g) => {
          const other = faces[g]
          return other !== undefined && vecDot(face.normal, vecNormalize(vecSub(other.centroid, middle))) > LEVEL
        })
        this.outline.push({ a: local(pi), b: local(pj), concave })
      }
    }
    this.from = [s0, t0]
    this.to = [s1, t1]
  }

  /** The patch's face at `p`, the first of those that hold it; -1 outside the patch. */
  faceAt(p: Point): number {
    for (const { corners: [a, b, c], face } of this.triangles) if (insideTriangle(p, a, b, c)) return face
    return -1
  }

  /** Whether `p`, outside the patch, is within `reach` of its outline and nearest a concave edge of it. */
  pastConcaveEdge(p: Point, reach: number): boolean {
    let nearest = Infinity, concave = false
    for (const edge of this.outline) {
      const d = segmentDistance(p, edge.a, edge.b)
      if (d < nearest) {
        nearest = d
        concave = edge.concave
      }
    }
    return concave && nearest <= reach
  }

  /** Whether a plate may cover `p`: in the patch, or past a concave edge of it within `reach`. */
  open(p: Point, reach: number): boolean {
    return this.faceAt(p) !== -1 || this.pastConcaveEdge(p, reach)
  }

  /** A point of the plane in the world. */
  world(s: number, t: number): Vec3 {
    return vecAdd(vecAdd(this.patch.centroid, vecScale(this.s, s)), vecScale(this.t, t))
  }
}

/** Most rectangles one patch gets before its leftovers go to triangles. */
const MAX_RECTS = 6

/** Cells along a patch's longer side: fewer where its shorter side would then be under four cells, never over 128. */
const PATCH_CELLS = 32

/** The rectangles stop once this share of the patch's cells is left bare. */
const BARE_SHARE = 0.03

/** A rectangle must cover this share of the patch's cells that nothing covered before it, and two cells. */
const FRESH_SHARE = 0.05

/** The plane cut into square cells round the patch, with a margin a plate may reach into. */
interface Cells {
  readonly ns: number
  readonly nt: number
  /** The cells' side, and the plane's (s, t) at the corner of the first. */
  readonly h: number
  readonly s0: number
  readonly t0: number
  /** The face of the patch at each cell's centre; -1 outside the patch. */
  readonly face: Int32Array
  /** 1 where a plate may cover the cell: in the patch, or past a concave edge within the margin. */
  readonly open: Uint8Array
  /** Steps to the nearest cell outside the patch, 1 on the grid's border; 0 outside the patch. */
  readonly depth: Int32Array
  /** How many cells are in the patch. */
  readonly inPatch: number
}

/** A run of cells: columns `i0` up to `i1`, rows `j0` up to `j1`. */
interface CellBox {
  readonly i0: number
  readonly i1: number
  readonly j0: number
  readonly j1: number
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/** How deep each cell is in the patch, breadth first from the cells outside it and the grid's border. */
const depthsOf = (face: Int32Array, ns: number, nt: number): Int32Array => {
  const depth = new Int32Array(ns * nt).fill(-1)
  const queue: Array<number> = []
  for (let k = 0; k < face.length; k++) {
    const i = k % ns, j = Math.floor(k / ns)
    const inPatch = at(face, k) !== -1
    if (!inPatch || i === 0 || j === 0 || i === ns - 1 || j === nt - 1) {
      depth[k] = inPatch ? 1 : 0
      queue.push(k)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q] ?? 0
    const i = k % ns, j = Math.floor(k / ns)
    for (const [di, dj] of NEIGHBOURS) {
      const ii = i + di, jj = j + dj
      if (ii < 0 || jj < 0 || ii >= ns || jj >= nt) continue
      const kk = ii + ns * jj
      if (at(depth, kk) !== -1) continue
      depth[kk] = at(depth, k) + 1
      queue.push(kk)
    }
  }
  return depth
}

/** The cells round `plane`'s patch, with `margin` on every side. */
const cellsOf = (plane: PatchPlane, margin: number): Cells => {
  const width = plane.to[0] - plane.from[0], height = plane.to[1] - plane.from[1]
  const long = Math.max(width, height), short = Math.min(width, height)
  const h = Math.max(long / 128, Math.min(long / PATCH_CELLS, short / 4), 1e-6)
  const ns = Math.max(1, Math.ceil((width + 2 * margin) / h)), nt = Math.max(1, Math.ceil((height + 2 * margin) / h))
  const s0 = plane.from[0] - margin, t0 = plane.from[1] - margin
  const face = new Int32Array(ns * nt), open = new Uint8Array(ns * nt)
  let inPatch = 0
  for (let j = 0; j < nt; j++) {
    for (let i = 0; i < ns; i++) {
      const k = i + ns * j
      const centre: Point = [s0 + (i + 0.5) * h, t0 + (j + 0.5) * h]
      face[k] = plane.faceAt(centre)
      if (at(face, k) !== -1) inPatch++
      open[k] = at(face, k) !== -1 || plane.pastConcaveEdge(centre, margin) ? 1 : 0
    }
  }
  return { ns, nt, h, s0, t0, face, open, depth: depthsOf(face, ns, nt), inPatch }
}

/** Whether a plate may cover every one of `count` cells from cell `from`, `step` apart: 1 along a row, `ns` down a column. */
const lineOpen = ({ open }: Cells, from: number, step: number, count: number): boolean => {
  for (let k = 0; k < count; k++) if (at(open, from + step * k) === 0) return false
  return true
}

/**
 * The run of open cells grown from cell `seed`: as far as it goes along s, forward then back, and then along t, or
 * the other way about.
 */
const grownFrom = (cells: Cells, seed: number, sFirst: boolean): CellBox => {
  const { ns, nt } = cells
  let i0 = seed % ns, i1 = i0 + 1, j0 = Math.floor(seed / ns), j1 = j0 + 1
  const growS = () => {
    while (i1 < ns && lineOpen(cells, i1 + ns * j0, ns, j1 - j0)) i1++
    while (i0 > 0 && lineOpen(cells, i0 - 1 + ns * j0, ns, j1 - j0)) i0--
  }
  const growT = () => {
    while (j1 < nt && lineOpen(cells, i0 + ns * j1, 1, i1 - i0)) j1++
    while (j0 > 0 && lineOpen(cells, i0 + ns * (j0 - 1), 1, i1 - i0)) j0--
  }
  if (sFirst) {
    growS()
    growT()
  } else {
    growT()
    growS()
  }
  return { i0, i1, j0, j1 }
}

/** How many of the patch's cells `box` holds that nothing covers yet. */
const freshIn = (cells: Cells, covered: Uint8Array, box: CellBox): number => {
  let fresh = 0
  for (let j = box.j0; j < box.j1; j++) {
    for (let i = box.i0; i < box.i1; i++) {
      const k = i + cells.ns * j
      if (at(cells.face, k) !== -1 && at(covered, k) === 0) fresh++
    }
  }
  return fresh
}

/** The deepest cell of the patch that is neither covered nor tried, the first of equals; -1 when none is left. */
const deepestBare = (cells: Cells, covered: Uint8Array, tried: Uint8Array): number => {
  let seed = -1
  for (let k = 0; k < cells.face.length; k++) {
    if (at(cells.face, k) === -1 || at(covered, k) === 1 || at(tried, k) === 1) continue
    if (seed === -1 || at(cells.depth, k) > at(cells.depth, seed)) seed = k
  }
  return seed
}

/**
 * Runs of cells over the patch, each grown from the deepest bare cell both ways about and kept the way that covers
 * more, where that is enough; and the cells they cover between them.
 */
const coverOf = (cells: Cells): { readonly boxes: Array<CellBox>; readonly covered: Uint8Array } => {
  const covered = new Uint8Array(cells.face.length), tried = new Uint8Array(cells.face.length)
  const boxes: Array<CellBox> = []
  let bare = cells.inPatch
  while (boxes.length < MAX_RECTS && bare > cells.inPatch * BARE_SHARE) {
    const seed = deepestBare(cells, covered, tried)
    if (seed === -1) break
    tried[seed] = 1
    const sFirst = grownFrom(cells, seed, true), tFirst = grownFrom(cells, seed, false)
    const sFresh = freshIn(cells, covered, sFirst), tFresh = freshIn(cells, covered, tFirst)
    const box = sFresh >= tFresh ? sFirst : tFirst, fresh = Math.max(sFresh, tFresh)
    if (fresh < Math.max(2, cells.inPatch * FRESH_SHARE)) continue
    for (let j = box.j0; j < box.j1; j++) {
      for (let i = box.i0; i < box.i1; i++) covered[i + cells.ns * j] = 1
    }
    bare -= fresh
    boxes.push(box)
  }
  return { boxes, covered }
}

/** Whether a plate may cover the rectangle's outline, read at nine points a side. */
const outlineOpen = (plane: PatchPlane, { s0, s1, t0, t1 }: Rect, reach: number): boolean => {
  for (let k = 0; k <= 8; k++) {
    const f = k / 8
    const points: ReadonlyArray<Point> = [
      [s0 + (s1 - s0) * f, t0],
      [s0 + (s1 - s0) * f, t1],
      [s0, t0 + (t1 - t0) * f],
      [s1, t0 + (t1 - t0) * f]
    ]
    if (points.some((p) => !plane.open(p, reach))) return false
  }
  return true
}

/** `rect` with each side moved out to the patch's true outline, up to a cell, where the cells stopped it short. */
const stretched = (plane: PatchPlane, rect: Rect, h: number, reach: number): Rect => {
  const by = h / 8
  let out = rect
  const tryFor = (wider: Rect) => {
    if (outlineOpen(plane, wider, reach)) out = wider
  }
  for (let step = 0; step < 8; step++) {
    tryFor({ ...out, s1: out.s1 + by })
    tryFor({ ...out, s0: out.s0 - by })
    tryFor({ ...out, t1: out.t1 + by })
    tryFor({ ...out, t0: out.t0 - by })
  }
  return out
}

/**
 * The patch's faces the rectangles leave mostly bare: at least two bare cells that are 30% of the face's or cover
 * `bareArea` between them, since a share of a big face is a big hole. A face too small to hold a cell is a sliver the
 * rectangles' stretch and overlap cover.
 */
const bareFaces = (plane: PatchPlane, cells: Cells, covered: Uint8Array, bareArea: number): Array<number> => {
  const counts = new Map<number, { all: number; bare: number }>()
  for (let k = 0; k < cells.face.length; k++) {
    const face = at(cells.face, k)
    if (face === -1) continue
    const count = counts.get(face) ?? { all: 0, bare: 0 }
    count.all++
    if (at(covered, k) === 0) count.bare++
    counts.set(face, count)
  }
  return plane.triangles.map(({ face }) => face).filter((face) => {
    const count = counts.get(face)
    return count !== undefined && count.bare >= 2 &&
      (count.bare >= count.all * 0.3 || count.bare * cells.h * cells.h >= bareArea)
  })
}

/**
 * Rectangles over the patch, each grown from the bare cell deepest inside it and reaching at most `reach` past a
 * concave edge of its outline, and which of the patch's faces they leave mostly bare.
 */
export const rectanglesOf = (
  plane: PatchPlane,
  reach: number,
  bareArea: number
): { readonly rects: Array<Rect>; readonly bare: Array<number> } => {
  const margin = Math.min(reach, Math.max(plane.to[0] - plane.from[0], plane.to[1] - plane.from[1]))
  const cells = cellsOf(plane, margin)
  const { boxes, covered } = coverOf(cells)
  const { h, s0, t0 } = cells
  const rects = boxes.map((box) =>
    stretched(plane, { s0: s0 + box.i0 * h, s1: s0 + box.i1 * h, t0: t0 + box.j0 * h, t1: t0 + box.j1 * h }, h, margin)
  )
  return { rects, bare: bareFaces(plane, cells, covered, bareArea) }
}
