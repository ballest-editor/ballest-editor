/** A plate mesh's faces: their outward normals, the patches nearly flat runs of them make, and what lies behind them. */
import type { Vec3 } from "../../coords"
import { vecAdd, vecCross, vecDot, vecLength, vecNormalize, vecScale, vecSub } from "../../ueMath"
import { at, cellIndex, pointAt, type VoxelGrid } from "../grid/voxelize"
import { cornerData, faceCount, type Mesh } from "../mesh/mesh"

type Corners = readonly [number, number, number]

/** A face's three corners in cm. */
export const cornersOf = (positions: Float32Array, corners: Corners): readonly [Vec3, Vec3, Vec3] => [
  pointAt(positions, corners[0]),
  pointAt(positions, corners[1]),
  pointAt(positions, corners[2])
]

export interface Face {
  readonly corners: Corners
  /** Outward. */
  readonly normal: Vec3
  readonly area: number
  readonly centroid: Vec3
}

/** Whether the grid's cell at `p` is solid; outside the grid is empty. */
const solidAt = (grid: VoxelGrid, p: Vec3): boolean => {
  const x = Math.floor((p.x - grid.origin.x) / grid.voxel)
  const y = Math.floor((p.y - grid.origin.y) / grid.voxel)
  const z = Math.floor((p.z - grid.origin.z) / grid.voxel)
  if (x < 0 || y < 0 || z < 0 || x >= grid.n[0] || y >= grid.n[1] || z >= grid.n[2]) return false
  return at(grid.cells, cellIndex(grid, x, y, z)) === 1
}

/** How far in front of a face and behind it the grid is read to tell which way the face looks, in voxels. */
const PROBE_VOXELS = 1.5

/**
 * The mesh's faces that have an area, with outward normals. The winding is taken as the mesh's signed volume says
 * (reading a Y-up file mirrors it, and a mirror turns every face over); a face whose voxels clearly say otherwise,
 * solid a voxel and a half in front of it and empty as far behind, is turned over on its own.
 */
export const facesOf = (mesh: Mesh, grid: VoxelGrid): Array<Face> => {
  const wound: Array<Face> = []
  // Six times the volume the faces bound, negative where they are wound inward.
  let volume = 0
  for (let f = 0; f < faceCount(mesh); f++) {
    const corners = [at(mesh.indices, 3 * f), at(mesh.indices, 3 * f + 1), at(mesh.indices, 3 * f + 2)] as const
    const [a, b, c] = cornersOf(mesh.positions, corners)
    const cross = vecCross(vecSub(b, a), vecSub(c, a))
    volume += vecDot(a, cross)
    const length = vecLength(cross)
    if (length < 1e-9) continue
    const centroid = vecScale(vecAdd(vecAdd(a, b), c), 1 / 3)
    wound.push({ corners, normal: vecScale(cross, 1 / length), area: length / 2, centroid })
  }
  const probe = grid.voxel * PROBE_VOXELS
  return wound.map((face) => {
    const outward = volume >= 0 ? face.normal : vecScale(face.normal, -1)
    const ahead = solidAt(grid, vecAdd(face.centroid, vecScale(outward, probe)))
    const behind = solidAt(grid, vecSub(face.centroid, vecScale(outward, probe)))
    return { ...face, normal: ahead && !behind ? vecScale(outward, -1) : outward }
  })
}

/** An edge's key, by its two vertices of a mesh with `vertices` of them. */
export const edgeKey = (a: number, b: number, vertices: number) => Math.min(a, b) * vertices + Math.max(a, b)

/** The key of the face's edge from corner `e` to the next. */
const faceEdge = (face: Face, e: number, vertices: number): number =>
  edgeKey(face.corners[e] ?? 0, face.corners[(e + 1) % 3] ?? 0, vertices)

/** The faces on each edge, by `edgeKey`. */
export const edgesOf = (faces: ReadonlyArray<Face>, vertices: number): Map<number, Array<number>> => {
  const edges = new Map<number, Array<number>>()
  faces.forEach((face, f) => {
    for (let e = 0; e < 3; e++) {
      const key = faceEdge(face, e, vertices)
      const list = edges.get(key)
      if (list === undefined) edges.set(key, [f])
      else list.push(f)
    }
  })
  return edges
}

/** A run of faces that share edges and look nearly the same way. */
export interface Patch {
  readonly faces: ReadonlyArray<number>
  /** The faces' normals' mean, by area. */
  readonly normal: Vec3
  /** The faces' centroids' mean, by area. */
  readonly centroid: Vec3
  readonly area: number
}

/** The mesh's faces as patches, and the patch of each face. */
interface Patches {
  readonly patches: ReadonlyArray<Patch>
  readonly patchOf: Int32Array
}

/** The sum of the centroids of `members`, each times its face's area. */
const centroidSum = (faces: ReadonlyArray<Face>, members: ReadonlyArray<number>): Vec3 => {
  let sum: Vec3 = { x: 0, y: 0, z: 0 }
  for (const f of members) {
    const face = faces[f]
    if (face !== undefined) sum = vecAdd(sum, vecScale(face.centroid, face.area))
  }
  return sum
}

/**
 * Every face in a patch: the largest face not yet in one starts a patch, which takes in each face across an edge of
 * its own that looks within `flatness` degrees of the patch's mean direction so far.
 */
export const growPatches = (
  faces: ReadonlyArray<Face>,
  edges: Map<number, Array<number>>,
  vertices: number,
  flatness: number
): Patches => {
  const patchOf = new Int32Array(faces.length).fill(-1)
  const cosine = Math.cos(flatness * Math.PI / 180)
  const largestFirst = faces.map((_, f) => f).sort((a, b) => (faces[b]?.area ?? 0) - (faces[a]?.area ?? 0))
  const patches: Array<Patch> = []
  for (const seed of largestFirst) {
    const first = faces[seed]
    if (first === undefined || at(patchOf, seed) !== -1) continue
    const id = patches.length
    const members = [seed]
    patchOf[seed] = id
    // The members' normals, each times its area: the patch's direction once normalised.
    let direction = vecScale(first.normal, first.area)
    for (let k = 0; k < members.length; k++) {
      const face = faces[members[k] ?? 0]
      if (face === undefined) continue
      for (let e = 0; e < 3; e++) {
        for (const g of edges.get(faceEdge(face, e, vertices)) ?? []) {
          const other = faces[g]
          if (other === undefined || at(patchOf, g) !== -1) continue
          if (vecDot(other.normal, vecNormalize(direction)) < cosine) continue
          patchOf[g] = id
          members.push(g)
          direction = vecAdd(direction, vecScale(other.normal, other.area))
        }
      }
    }
    let area = 0
    for (const f of members) area += faces[f]?.area ?? 0
    patches.push({
      faces: members,
      normal: vecNormalize(direction),
      centroid: vecScale(centroidSum(faces, members), 1 / area),
      area
    })
  }
  return { patches, patchOf }
}

/**
 * `growPatches`, then each patch smaller than `minArea`, smallest first, merged into the neighbour whose direction is
 * nearest its own, until it is big enough or has no neighbour left.
 */
export const mergedPatches = (
  faces: ReadonlyArray<Face>,
  edges: Map<number, Array<number>>,
  vertices: number,
  flatness: number,
  minArea: number
): Patches => {
  const grown = growPatches(faces, edges, vertices, flatness)
  if (minArea <= 0) return grown
  const up: Vec3 = { x: 0, y: 0, z: 1 }
  // The patch each grown patch has merged into, itself while it stands; and what each standing patch holds.
  const mergedInto = Int32Array.from(grown.patches, (_, i) => i)
  const standing = (i: number): number => {
    let root = i
    while (at(mergedInto, root) !== root) root = at(mergedInto, root)
    mergedInto[i] = root
    return root
  }
  const members = grown.patches.map((patch) => [...patch.faces])
  const area = Float64Array.from(grown.patches, (patch) => patch.area)
  const direction = grown.patches.map((patch) => vecScale(patch.normal, patch.area))

  /** The patch across an edge of `patch` whose direction is nearest its own, the first found of equals; -1 for none. */
  const nearestNeighbour = (patch: number): number => {
    const own = vecNormalize(direction[patch] ?? up)
    let best = -1, bestDot = -Infinity
    for (const f of members[patch] ?? []) {
      const face = faces[f]
      if (face === undefined) continue
      for (let e = 0; e < 3; e++) {
        for (const g of edges.get(faceEdge(face, e, vertices)) ?? []) {
          const other = standing(at(grown.patchOf, g))
          if (other === patch) continue
          const dot = vecDot(own, vecNormalize(direction[other] ?? own))
          if (dot > bestDot) {
            bestDot = dot
            best = other
          }
        }
      }
    }
    return best
  }

  const smallestFirst = [...mergedInto].sort((a, b) => at(area, a) - at(area, b))
  for (const patch of smallestFirst) {
    if (standing(patch) !== patch || at(area, patch) >= minArea) continue
    const into = nearestNeighbour(patch)
    if (into === -1) continue
    const own = direction[patch] ?? up
    mergedInto[patch] = into
    area[into] = at(area, into) + at(area, patch)
    direction[into] = vecAdd(direction[into] ?? own, own)
    members[into]?.push(...(members[patch] ?? []))
    members[patch] = []
  }

  const patchOf = new Int32Array(faces.length).fill(-1)
  const patches: Array<Patch> = []
  members.forEach((list, i) => {
    if (list.length === 0 || standing(i) !== i) return
    for (const f of list) patchOf[f] = patches.length
    patches.push({
      faces: list,
      normal: vecNormalize(direction[i] ?? up),
      centroid: vecScale(centroidSum(faces, list), 1 / Math.max(1e-9, at(area, i))),
      area: at(area, i)
    })
  })
  return { patches, patchOf }
}

/** How far the model goes on behind a point of its surface: the nearest face, outside the point's own patch, along a ray. */
export class Depths {
  /** Nine numbers a face: its corners. */
  private readonly corners: Float64Array
  private readonly patchOf: Int32Array

  constructor(mesh: Mesh, faces: ReadonlyArray<Face>, patchOf: Int32Array) {
    this.corners = cornerData(mesh, faces.map((face) => face.corners))
    this.patchOf = patchOf
  }

  /**
   * How far along `direction` from `from` the nearest face not of `patch` is, in lengths of `direction`; Infinity
   * where nothing is behind. Each face is tested as Möller and Trumbore do.
   */
  along(from: Vec3, direction: Vec3, patch: number): number {
    const d = this.corners
    let nearest = Infinity
    for (let f = 0; f < this.patchOf.length; f++) {
      if (at(this.patchOf, f) === patch) continue
      const o = 9 * f
      const ax = at(d, o), ay = at(d, o + 1), az = at(d, o + 2)
      const e1x = at(d, o + 3) - ax, e1y = at(d, o + 4) - ay, e1z = at(d, o + 5) - az
      const e2x = at(d, o + 6) - ax, e2y = at(d, o + 7) - ay, e2z = at(d, o + 8) - az
      const px = direction.y * e2z - direction.z * e2y
      const py = direction.z * e2x - direction.x * e2z
      const pz = direction.x * e2y - direction.y * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-12) continue
      const tx = from.x - ax, ty = from.y - ay, tz = from.z - az
      const u = (tx * px + ty * py + tz * pz) / det
      if (u < 0 || u > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const v = (direction.x * qx + direction.y * qy + direction.z * qz) / det
      if (v < 0 || u + v > 1) continue
      const t = (e2x * qx + e2y * qy + e2z * qz) / det
      if (t > 1e-6 && t < nearest) nearest = t
    }
    return nearest
  }

  /**
   * How thick a plate over `points` of `patch` may be, `normal` being its outward direction: `most`, or 90% of the
   * model behind the points where that is less, and never under 0.5 cm.
   */
  thickness(points: ReadonlyArray<Vec3>, normal: Vec3, patch: number, most: number): number {
    const inward = vecScale(normal, -1)
    const behind = Math.min(...points.map((p) => this.along(vecAdd(p, vecScale(normal, 1e-3)), inward, patch)))
    return Math.max(0.5, Math.min(most, behind * 0.9))
  }
}
