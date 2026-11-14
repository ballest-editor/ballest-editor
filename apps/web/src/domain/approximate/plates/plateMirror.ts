/**
 * Mirror-symmetric low-poly meshes for plates. A source mesh is cut at the model's mirror plane (symmetry.ts), one half
 * is simplified to half the faces and joined to its mirror image, so the decimated mesh is symmetric and every vertex
 * has a partner: its mirror image, or itself when it lies on the plane. The remesh and the local search keep the mesh
 * symmetric by moving each pair to mirror images of their mean (`byPartners`). They never cut at the plane again,
 * which would add faces.
 */
import type { Vec3 } from "../../coords"
import { vecAdd, vecCross, vecDot, vecLength, vecScale, vecSub } from "../../ueMath"
import { at } from "../grid/voxelize"
import { faceCount, type Mesh, simplified } from "../mesh/mesh"
import { meshFace, meshVertex } from "../mesh/plateMesh"
import { Surface } from "../mesh/surface"
import type { Plane } from "../parts/symmetry"

/** A mesh with each vertex's mirror partner: itself on the plane, -1 for none (a vertex no face uses). */
export interface Paired {
  readonly mesh: Mesh
  readonly partners: Int32Array
}

/** What a remesh needs to keep its mesh symmetric: the plane, and the source decimated symmetrically. */
export interface MirrorRemesh {
  readonly plane: Plane
  readonly decimate: (fine: Mesh, faces: number) => Paired
}

/**
 * A vertex on the discarded side, within this share of the mean edge of the plane, moves onto it, so the kept faces
 * end there without a cut: a cut leaves slivers.
 */
const SNAP_SHARE = 0.3
/**
 * A vertex on the kept side moves onto the plane only when this much nearer. Snapping both sides as far flattens a
 * thin feature that lies across the plane: the teapot's handle and spout vanished when both sides snapped at 0.3.
 */
const KEPT_SHARE = 0.08
/** A snap is undone when it leaves a kept face with under this share of its normal along the old one. */
const TURNED = 0.2

type Face = readonly [number, number, number]

export const signedDistance = (plane: Plane, p: Vec3): number => vecDot(plane.normal, p) - plane.offset

export const ontoPlane = (plane: Plane, p: Vec3): Vec3 => vecSub(p, vecScale(plane.normal, signedDistance(plane, p)))

/** `p` reflected in the plane (symmetry.ts `mirrorPoint`, which this module can't import without a cycle). */
export const mirrorPoint = (p: Vec3, plane: Plane): Vec3 =>
  vecSub(p, vecScale(plane.normal, 2 * signedDistance(plane, p)))

/**
 * A mesh being cut at the plane, its vertices free to move and to grow in number. A vertex's `height` is its distance
 * from the plane towards the kept side; `onPlane` marks the vertices snapped onto it.
 */
class Cut {
  readonly faces: ReadonlyArray<Face>
  readonly points: Array<Vec3>
  readonly heights: Array<number>
  readonly onPlane: Uint8Array
  readonly plane: Plane
  readonly side: 1 | -1
  /** How many vertices the mesh came with: those after them were made by cutting an edge, on the plane. */
  private readonly given: number

  constructor(mesh: Mesh, plane: Plane, side: 1 | -1) {
    this.plane = plane
    this.side = side
    this.given = mesh.positions.length / 3
    this.points = Array.from({ length: this.given }, (_, i) => meshVertex(mesh, i))
    this.heights = this.points.map((p) => side * signedDistance(plane, p))
    this.faces = Array.from({ length: faceCount(mesh) }, (_, f) => meshFace(mesh, f))
    this.onPlane = new Uint8Array(this.given)
  }

  point(i: number): Vec3 {
    return this.points[i] ?? { x: 0, y: 0, z: 0 }
  }

  height(i: number): number {
    return this.heights[i] ?? 0
  }

  /** 1 on the kept side, -1 on the discarded side, 0 on the plane. */
  sideOf(i: number): number {
    return i >= this.given || at(this.onPlane, i) === 1 ? 0 : Math.sign(this.height(i))
  }

  normal([a, b, c]: Face): Vec3 {
    return vecCross(vecSub(this.point(b), this.point(a)), vecSub(this.point(c), this.point(a)))
  }

  meanEdge(): number {
    const length = (i: number, j: number) => vecLength(vecSub(this.point(i), this.point(j)))
    let sum = 0
    for (const [a, b, c] of this.faces) sum += length(a, b) + length(b, c) + length(c, a)
    return sum / Math.max(1, 3 * this.faces.length)
  }

  /** Whether a face lies wholly on the kept side, with a corner off the plane. */
  private kept(face: Face): boolean {
    return face.some((i) => this.height(i) > 0 && at(this.onPlane, i) === 0) &&
      face.every((i) => this.height(i) >= 0 || at(this.onPlane, i) === 1)
  }

  /** Moves vertex `i` onto the plane, unless that turns one of the kept faces `around` it over. */
  snap(i: number, around: ReadonlyArray<Face>): void {
    const old = this.point(i), oldHeight = this.height(i)
    const before = around.map((face) => this.normal(face))
    this.points[i] = vecSub(old, vecScale(this.plane.normal, this.side * oldHeight))
    this.heights[i] = 0
    this.onPlane[i] = 1
    const turned = around.some((face, k) => {
      if (!this.kept(face)) return false
      const was = before[k] ?? { x: 0, y: 0, z: 0 }
      return vecDot(this.normal(face), was) <= TURNED * vecDot(was, was)
    })
    if (!turned) return
    this.points[i] = old
    this.heights[i] = oldHeight
    this.onPlane[i] = 0
  }

  /** A new vertex where the edge from `i` to `j` crosses the plane. */
  cross(i: number, j: number): number {
    const t = this.height(i) / (this.height(i) - this.height(j))
    const along = vecAdd(this.point(i), vecScale(vecSub(this.point(j), this.point(i)), t))
    this.heights.push(0)
    return this.points.push(ontoPlane(this.plane, along)) - 1
  }
}

/**
 * Snaps the vertices near the plane onto it, nearest first: within `SNAP_SHARE` of the mean edge on the discarded side
 * and `KEPT_SHARE` on the kept side.
 */
const snapNear = (cut: Cut): void => {
  const meanEdge = cut.meanEdge()
  const around: Array<Array<Face>> = cut.points.map(() => [])
  for (const face of cut.faces) for (const i of face) around[i]?.push(face)
  const near = [...new Set(cut.faces.flat())]
    .filter((i) => cut.height(i) < 0 ? -cut.height(i) < SNAP_SHARE * meanEdge : cut.height(i) < KEPT_SHARE * meanEdge)
    .sort((a, b) => Math.abs(cut.height(a)) - Math.abs(cut.height(b)))
  for (const i of near) cut.snap(i, around[i] ?? [])
}

/**
 * The faces on the kept side. A face that still crosses the plane is cut there, with one new vertex per crossing edge
 * that both faces on the edge share; a quad left of it is split along its shorter diagonal.
 */
const keptFaces = (cut: Cut): Array<Face> => {
  const crossings = new Map<string, number>()
  const crossing = (i: number, j: number): number => {
    const key = `${Math.min(i, j)},${Math.max(i, j)}`
    const made = crossings.get(key) ?? cut.cross(i, j)
    crossings.set(key, made)
    return made
  }
  const span = (i: number, j: number) => vecLength(vecSub(cut.point(i), cut.point(j)))
  const kept: Array<Face> = []
  for (const face of cut.faces) {
    const sides = face.map((i) => cut.sideOf(i))
    if (sides.every((side) => side >= 0)) {
      if (sides.some((side) => side > 0)) kept.push(face)
      continue
    }
    if (sides.every((side) => side <= 0)) continue
    // The kept part of the triangle's outline, as a polygon of three or four corners.
    const polygon: Array<number> = []
    for (let k = 0; k < 3; k++) {
      const i = face[k] ?? 0, j = face[(k + 1) % 3] ?? 0, here = sides[k] ?? 0, next = sides[(k + 1) % 3] ?? 0
      if (here >= 0) polygon.push(i)
      if (here * next < 0) polygon.push(crossing(i, j))
    }
    const [a = 0, b = 0, c = 0, d] = polygon
    if (d === undefined) kept.push([a, b, c])
    else if (span(a, c) <= span(b, d)) kept.push([a, b, c], [a, c, d])
    else kept.push([a, b, d], [b, c, d])
  }
  return kept
}

/** `faces` as a mesh of the vertices they use, in the order they use them, those on the plane exactly on it. */
const compacted = (cut: Cut, faces: ReadonlyArray<Face>): Mesh => {
  const index = new Map<number, number>()
  const positions: Array<number> = [], indices: Array<number> = []
  for (const face of faces) {
    for (const i of face) {
      let k = index.get(i)
      if (k === undefined) {
        k = index.size
        index.set(i, k)
        const p = cut.sideOf(i) === 0 ? ontoPlane(cut.plane, cut.point(i)) : cut.point(i)
        positions.push(p.x, p.y, p.z)
      }
      indices.push(k)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/**
 * The half of `mesh` on `side` of the plane, its border on the plane: vertices near the plane snapped onto it where
 * that turns no kept face over, faces that still cross it cut there, and the vertices on it exactly on it.
 */
export const halfOf = (mesh: Mesh, plane: Plane, side: 1 | -1): Mesh => {
  const cut = new Cut(mesh, plane, side)
  snapNear(cut)
  return compacted(cut, keptFaces(cut))
}

/**
 * A half mesh, its border on the plane, joined to its mirror image with the winding reversed. Vertices on the plane are
 * shared, and faces lying in it dropped, since one would meet its own image back to back.
 */
export const mirrorHalf = (half: Mesh, plane: Plane): Paired => {
  const used = [...new Set(half.indices)]
  let reach = 0
  for (const i of used) reach = Math.max(reach, Math.abs(signedDistance(plane, meshVertex(half, i))))
  const tolerance = Math.max(1e-6, 1e-5 * reach)
  // The half's own vertices first, in the order its faces use them, then the images of those off the plane.
  const index = new Map<number, number>()
  const partners: Array<number> = [], positions: Array<number> = []
  for (const i of used) {
    const p = meshVertex(half, i), k = index.size
    index.set(i, k)
    const on = Math.abs(signedDistance(plane, p)) <= tolerance
    const q = on ? ontoPlane(plane, p) : p
    positions.push(q.x, q.y, q.z)
    partners[k] = on ? k : -1
  }
  for (const i of used) {
    const k = index.get(i) ?? 0
    if (partners[k] === k) continue
    const q = mirrorPoint(meshVertex(half, i), plane), image = positions.length / 3
    partners[k] = image
    partners[image] = k
    positions.push(q.x, q.y, q.z)
  }
  const indices: Array<number> = []
  for (let f = 0; f < faceCount(half); f++) {
    const face = meshFace(half, f).map((i) => index.get(i) ?? 0)
    if (!face.every((k) => partners[k] === k)) indices.push(...face)
  }
  const own = indices.length
  for (let f = 0; f < own; f += 3) {
    const image = (corner: number) => partners[indices[f + corner] ?? 0] ?? 0
    indices.push(image(0), image(2), image(1))
  }
  return {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
    partners: Int32Array.from(partners)
  }
}

/**
 * A symmetric mesh of about `faces` from `half`, one side of a mesh cut at the plane: simplified to half the faces and
 * mirrored. The simplifier collapses a border vertex only along the border, so the cut stays on the plane.
 */
const decimatedHalf = (half: Mesh, plane: Plane, faces: number): Paired =>
  mirrorHalf(simplified(half, Math.max(2, Math.round(faces / 2))), plane)

/** Mean squared distance of `samples` to `mesh`. */
const fitError = (mesh: Mesh, samples: ReadonlyArray<Vec3>): number => {
  const surface = new Surface(mesh)
  let sum = 0
  for (const p of samples) sum += surface.nearest(p).squared
  return sum / Math.max(1, samples.length)
}

/**
 * Each vertex's mirror partner in a mesh built mirror-symmetric: the vertex nearest its mirror image within a
 * ten-thousandth of the mesh's size (itself on the plane), -1 for none.
 */
export const partnersOf = (mesh: Mesh, plane: Plane): Int32Array => {
  const count = mesh.positions.length / 3
  let low = Infinity, high = -Infinity
  for (const value of mesh.positions) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  // Vertices by grid cell: a vertex's partner is looked for in its image's cell and the cells round it.
  const cell = Math.max(1e-6, (high - low) * 1e-4)
  const cellOf = (p: Vec3) => [Math.round(p.x / cell), Math.round(p.y / cell), Math.round(p.z / cell)] as const
  const cells = new Map<string, Array<number>>()
  for (let i = 0; i < count; i++) {
    const key = cellOf(meshVertex(mesh, i)).join()
    const held = cells.get(key)
    if (held === undefined) cells.set(key, [i])
    else held.push(i)
  }
  const partners = new Int32Array(count).fill(-1)
  for (let i = 0; i < count; i++) {
    const image = mirrorPoint(meshVertex(mesh, i), plane)
    const [cx, cy, cz] = cellOf(image)
    let nearest = (2 * cell) ** 2
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = vecSub(meshVertex(mesh, j), image), squared = vecDot(d, d)
            if (squared < nearest) {
              nearest = squared
              partners[i] = j
            }
          }
        }
      }
    }
  }
  return partners
}

/** `mesh` made exactly mirror-symmetric by its vertex pairs: each pair moved to mirror images of their mean. */
export const byPartners = (mesh: Mesh, plane: Plane, partners: Int32Array): Mesh => {
  const positions = mesh.positions.slice()
  for (let i = 0; i < partners.length; i++) {
    const j = at(partners, i)
    // Each pair once, from its lower vertex; a vertex with no partner stays.
    if (j < i) continue
    const p = meshVertex(mesh, i)
    const mean = j === i ? ontoPlane(plane, p) : vecScale(vecAdd(p, mirrorPoint(meshVertex(mesh, j), plane)), 0.5)
    positions.set([mean.x, mean.y, mean.z], 3 * i)
    if (j === i) continue
    const image = mirrorPoint(mean, plane)
    positions.set([image.x, image.y, image.z], 3 * j)
  }
  return { positions, indices: mesh.indices }
}

/** A face's corners as a key that starts at its least vertex, so the same cycle always reads the same. */
const cycleKey = (a: number, b: number, c: number): string =>
  a <= b && a <= c ? `${a},${b},${c}` : b <= c ? `${b},${c},${a}` : `${c},${a},${b}`

/** Whether every face's mirror image, by `partners`, is a face too: the topology is symmetric. */
export const isMirrored = (mesh: Mesh, partners: Int32Array): boolean => {
  const faces = new Set<string>()
  for (let f = 0; f < faceCount(mesh); f++) faces.add(cycleKey(...meshFace(mesh, f)))
  for (let f = 0; f < faceCount(mesh); f++) {
    const [a, b, c] = meshFace(mesh, f)
    const ia = partners[a] ?? -1, ib = partners[b] ?? -1, ic = partners[c] ?? -1
    if (ia < 0 || ib < 0 || ic < 0 || !faces.has(cycleKey(ia, ic, ib))) return false
  }
  return true
}

/**
 * The symmetric decimation a remesh starts from: both halves decimated, and the one whose mesh stays nearer `samples`
 * (the source's surface) kept, so on a nearly symmetric model the better-kept side is mirrored.
 */
export const mirrorRemesh = (plane: Plane, samples: ReadonlyArray<Vec3>): MirrorRemesh => {
  const halves = new WeakMap<Mesh, readonly [Mesh, Mesh]>()
  const halvesOf = (fine: Mesh): readonly [Mesh, Mesh] => {
    const cut = halves.get(fine) ?? [halfOf(fine, plane, 1), halfOf(fine, plane, -1)]
    halves.set(fine, cut)
    return cut
  }
  return {
    plane,
    decimate: (fine, faces) => {
      const [kept, other] = halvesOf(fine)
      const plus = decimatedHalf(kept, plane, faces), minus = decimatedHalf(other, plane, faces)
      return fitError(plus.mesh, samples) <= fitError(minus.mesh, samples) ? plus : minus
    }
  }
}
