/**
 * What a mesh offers the Mesh target (docs/SNAPPING.md § Mesh): its vertices, its sharp edges and the centres of its
 * flat faces. Worked out from the triangles the renderer has, with a mesh's repeated corners welded, since a corner is
 * repeated once per normal it needs. No renderer here: the editor hands in the arrays.
 */
import type { Vec3 } from "./coords"
import { vecAdd, vecCross, vecDot, vecLength, vecLerp, vecNormalize, vecScale, vecSub } from "./ueMath"

export interface MeshElements {
  readonly vertices: ReadonlyArray<Vec3>
  /** Its sharp edges and the rim of any open surface. */
  readonly edges: ReadonlyArray<readonly [Vec3, Vec3]>
  /** The middle of each flat face, however many triangles make it. */
  readonly faceCentres: ReadonlyArray<Vec3>
}

/** The same elements in the world. */
export type WorldMesh = MeshElements

/** Two corners closer than this are one. */
const WELD_CM = 0.01
/** Two triangles this close to one plane make one flat face, in degrees. */
const FLAT_DEGREES = 0.5

interface Triangle {
  readonly corners: readonly [number, number, number]
  readonly normal: Vec3
  readonly area: number
  readonly centre: Vec3
}

const weldKey = ({ x, y, z }: Vec3) =>
  `${Math.round(x / WELD_CM)},${Math.round(y / WELD_CM)},${Math.round(z / WELD_CM)}`

const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`

/** Each mesh corner's welded vertex, and the welded vertices. */
const weld = (positions: ArrayLike<number>) => {
  const vertices: Array<Vec3> = []
  const seen = new Map<string, number>()
  const count = Math.floor(positions.length / 3)
  const welded = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const point = { x: positions[i * 3] ?? 0, y: positions[i * 3 + 1] ?? 0, z: positions[i * 3 + 2] ?? 0 }
    const key = weldKey(point)
    let at = seen.get(key)
    if (at === undefined) {
      at = vertices.length
      seen.set(key, at)
      vertices.push(point)
    }
    welded[i] = at
  }
  return { vertices, welded }
}

/** The mesh's triangles with any area, by welded vertex. */
const trianglesOf = (
  vertices: ReadonlyArray<Vec3>,
  welded: Int32Array,
  index: ArrayLike<number> | null
): ReadonlyArray<Triangle> => {
  const out: Array<Triangle> = []
  const corners = index?.length ?? welded.length
  for (let i = 0; i + 2 < corners; i += 3) {
    const at = (n: number) => welded[index === null ? n : index[n] ?? 0] ?? 0
    const [a, b, c] = [at(i), at(i + 1), at(i + 2)]
    const [pa, pb, pc] = [vertices[a], vertices[b], vertices[c]]
    if (pa === undefined || pb === undefined || pc === undefined) continue
    const cross = vecCross(vecSub(pb, pa), vecSub(pc, pa))
    const area = vecLength(cross) / 2
    if (area === 0) continue
    out.push({
      corners: [a, b, c],
      normal: vecNormalize(cross),
      area,
      centre: vecScale(vecAdd(vecAdd(pa, pb), pc), 1 / 3)
    })
  }
  return out
}

/** Each edge's triangles, by edge key. */
const facesOfEdges = (triangles: ReadonlyArray<Triangle>) => {
  const edges = new Map<string, { readonly a: number; readonly b: number; readonly faces: Array<number> }>()
  triangles.forEach(({ corners: [a, b, c] }, face) => {
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(from, to)
      const edge = edges.get(key)
      if (edge === undefined) edges.set(key, { a: from, b: to, faces: [face] })
      else edge.faces.push(face)
    }
  })
  return edges
}

/** The centre of each run of flat triangles sharing edges. */
const flatFaceCentres = (
  triangles: ReadonlyArray<Triangle>,
  edges: ReturnType<typeof facesOfEdges>
): ReadonlyArray<Vec3> => {
  const flat = Math.cos(FLAT_DEGREES * Math.PI / 180)
  const roots = triangles.map((_, i) => i)
  const rootOf = (i: number): number => {
    let at = i
    while (roots[at] !== at) {
      const up = roots[roots[at] ?? at] ?? at
      roots[at] = up
      at = up
    }
    return at
  }
  for (const { faces } of edges.values()) {
    for (const face of faces.slice(1)) {
      const [first] = faces
      const [p, q] = [triangles[first ?? 0], triangles[face]]
      if (p !== undefined && q !== undefined && vecDot(p.normal, q.normal) >= flat) {
        roots[rootOf(face)] = rootOf(first ?? 0)
      }
    }
  }
  const sums = new Map<number, { sum: Vec3; area: number }>()
  triangles.forEach(({ area, centre }, i) => {
    const root = rootOf(i)
    const sum = sums.get(root) ?? { sum: { x: 0, y: 0, z: 0 }, area: 0 }
    sum.sum = vecAdd(sum.sum, vecScale(centre, area))
    sum.area += area
    sums.set(root, sum)
  })
  return [...sums.values()].map(({ area, sum }) => vecScale(sum, 1 / area))
}

/**
 * The elements of a mesh of `positions` (three numbers a corner), through `index` when it has one. An edge is sharp when
 * its two faces meet at more than `sharpAngle` degrees.
 */
export const meshElementsOf = (
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  sharpAngle: number
): MeshElements => {
  const { vertices, welded } = weld(positions)
  const triangles = trianglesOf(vertices, welded, index)
  const faces = facesOfEdges(triangles)
  const sharp = Math.cos(sharpAngle * Math.PI / 180)
  const edges = [...faces.values()].flatMap(({ a, b, faces: around }) => {
    const [from, to] = [vertices[a], vertices[b]]
    if (from === undefined || to === undefined) return []
    const [p, q] = [triangles[around[0] ?? 0], triangles[around[1] ?? 0]]
    const isRim = around.length === 1
    const bends = p !== undefined && q !== undefined && vecDot(p.normal, q.normal) < sharp
    return isRim || bends ? [[from, to] as const] : []
  })
  return { vertices, edges, faceCentres: flatFaceCentres(triangles, faces) }
}

/** `elements` under `place`, which takes a point of the mesh to the world. */
export const placedMesh = (elements: MeshElements, place: (point: Vec3) => Vec3): WorldMesh => ({
  vertices: elements.vertices.map(place),
  edges: elements.edges.map(([a, b]) => [place(a), place(b)] as const),
  faceCentres: elements.faceCentres.map(place)
})

/** Where an edge's middle is. */
export const midpointOf = ([a, b]: readonly [Vec3, Vec3]): Vec3 => vecLerp(a, b, 0.5)
