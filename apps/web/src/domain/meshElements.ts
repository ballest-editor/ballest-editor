/**
 * What a mesh offers the Mesh target (docs/SNAPPING.md § Mesh): the corners where its sharp edges meet, those edges and
 * the runs they weld into, the centres of its flat faces, and those flat faces that are faces of the piece. Worked out
 * from the triangles the renderer has, with a mesh's repeated corners welded, since a corner is repeated once per normal
 * it needs. No renderer here: the editor hands in the arrays.
 */
import type { Vec3 } from "./coords"
import {
  ORIGIN,
  squareTo,
  vecAdd,
  vecCross,
  vecDistance,
  vecDot,
  vecLength,
  vecLerp,
  vecNormalize,
  vecScale,
  vecSub
} from "./ueMath"

/** A flat face of a mesh that is a face of the piece, and not a facet of something curved. */
export interface MeshFace {
  readonly centre: Vec3
  /** Out of the face, unit length. */
  readonly normal: Vec3
  /** The rectangle around it, for the tint. */
  readonly corners: ReadonlyArray<Vec3>
}

export interface MeshElements {
  /** The ends and corners of `runs`. A closed run with no corner, a cylinder's rim, has none. */
  readonly vertices: ReadonlyArray<Vec3>
  /** Its sharp edges and the rim of any open surface, a segment at a time. */
  readonly edges: ReadonlyArray<readonly [Vec3, Vec3]>
  /** `edges` welded into the edges a user sees, each as its polyline: a closed one ends where it starts. */
  readonly runs: ReadonlyArray<ReadonlyArray<Vec3>>
  /** The middle of each flat face, however many triangles make it. */
  readonly faceCentres: ReadonlyArray<Vec3>
  /** The flat faces that are at least `FACE_SHARE` of its surface. */
  readonly faces: ReadonlyArray<MeshFace>
}

/** The same elements in the world. One built by hand can leave `runs` out: each of its edges is then a run. */
export interface WorldMesh extends Omit<MeshElements, "runs"> {
  readonly runs?: MeshElements["runs"]
}

/** Two corners closer than this are one. */
const WELD_CM = 0.01
/** Two triangles this close to one plane make one flat face, in degrees. */
const FLAT_DEGREES = 0.5
/**
 * A flat face under this share of the mesh's surface is a facet of something curved. Measured on the pieces: it leaves a
 * bent tube its two caps out of 802 flat faces and a sphere none, and the smallest real face, a long tube's cap, is 0.36%.
 */
const FACE_SHARE = 0.0025

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

/** Each run of flat triangles sharing edges. */
const flatRuns = (
  triangles: ReadonlyArray<Triangle>,
  edges: ReturnType<typeof facesOfEdges>
): ReadonlyArray<ReadonlyArray<Triangle>> => {
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
  const runs = new Map<number, Array<Triangle>>()
  triangles.forEach((triangle, i) => {
    const root = rootOf(i)
    const run = runs.get(root)
    if (run === undefined) runs.set(root, [triangle])
    else run.push(triangle)
  })
  return [...runs.values()]
}

const areaOf = (run: ReadonlyArray<Triangle>) => run.reduce((sum, { area }) => sum + area, 0)

/** The middle of a run, however many triangles make it. */
const centreOf = (run: ReadonlyArray<Triangle>): Vec3 =>
  vecScale(run.reduce((sum, { area, centre }) => vecAdd(sum, vecScale(centre, area)), ORIGIN), 1 / areaOf(run))

/** A run as a face: the rectangle around it lies along the mesh's own axes, so a square-cut face fills it. */
const faceOf = (run: ReadonlyArray<Triangle>, vertices: ReadonlyArray<Vec3>): MeshFace => {
  const centre = centreOf(run)
  const normal = vecNormalize(run.reduce((sum, { area, normal: n }) => vecAdd(sum, vecScale(n, area)), ORIGIN))
  const u = squareTo(normal)
  const v = vecCross(normal, u)
  const points = run.flatMap(({ corners }) => corners.flatMap((corner) => vertices[corner] ?? []))
  const reach = (axis: Vec3) =>
    points.reduce<readonly [number, number]>(([low, high], point) => {
      const along = vecDot(vecSub(point, centre), axis)
      return [Math.min(low, along), Math.max(high, along)]
    }, [Infinity, -Infinity])
  const [[u0, u1], [v0, v1]] = [reach(u), reach(v)]
  const corner = (a: number, b: number) => vecAdd(vecAdd(centre, vecScale(u, a)), vecScale(v, b))
  return { centre, normal, corners: [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)] }
}

/**
 * The sharp edges `segments` welded into runs, and the corners that end them. A run carries on through a vertex with two
 * sharp edges that turn by less than `sharp`, the cosine of the sharp angle, so a straight edge or a curved lip the mesh
 * tessellates is one run. Whatever is left once every corner's runs are walked is a closed run with no corner.
 */
const runsOf = (
  segments: ReadonlyArray<readonly [number, number]>,
  pointOf: (vertex: number) => Vec3,
  sharp: number
) => {
  const meeting = new Map<number, Array<number>>()
  segments.forEach((ends, segment) => {
    for (const vertex of ends) {
      const around = meeting.get(vertex)
      if (around === undefined) meeting.set(vertex, [segment])
      else around.push(segment)
    }
  })
  const across = (segment: number, vertex: number) => {
    const [a = vertex, b = vertex] = segments[segment] ?? []
    return a === vertex ? b : a
  }
  const isCorner = (vertex: number) => {
    const [first, second, ...others] = meeting.get(vertex) ?? []
    if (first === undefined || second === undefined || others.length > 0) return true
    const at = pointOf(vertex)
    const coming = vecNormalize(vecSub(at, pointOf(across(first, vertex))))
    const going = vecNormalize(vecSub(pointOf(across(second, vertex)), at))
    return vecDot(coming, going) <= sharp
  }
  const corners = new Set([...meeting.keys()].filter(isCorner))
  const walked = new Set<number>()
  const walk = (start: number, first: number) => {
    const run = [start]
    let vertex = start
    let segment: number | undefined = first
    while (segment !== undefined) {
      walked.add(segment)
      vertex = across(segment, vertex)
      run.push(vertex)
      segment = corners.has(vertex) ? undefined : meeting.get(vertex)?.find((next) => !walked.has(next))
    }
    return run
  }
  const fromCorners = [...corners].flatMap((corner) =>
    (meeting.get(corner) ?? []).map((segment) => [corner, segment] as const)
  )
  const fromAnywhere = segments.map(([a], segment) => [a, segment] as const)
  const runs = [...fromCorners, ...fromAnywhere].flatMap(([from, segment]) =>
    walked.has(segment) ? [] : [walk(from, segment)]
  )
  return { corners, runs }
}

/**
 * The elements of a mesh of `positions` (three numbers a corner), through `index` when it has one. An edge is sharp when
 * its two faces meet at more than `sharpAngle` degrees, and it bends at a corner when it turns by at least as much.
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
  const segments = [...faces.values()].flatMap(({ a, b, faces: around }) => {
    const [p, q] = [triangles[around[0] ?? 0], triangles[around[1] ?? 0]]
    const isRim = around.length === 1
    const bends = p !== undefined && q !== undefined && vecDot(p.normal, q.normal) < sharp
    return isRim || bends ? [[a, b] as const] : []
  })
  const pointOf = (vertex: number) => vertices[vertex] ?? ORIGIN
  const { corners, runs } = runsOf(segments, pointOf, sharp)
  const flats = flatRuns(triangles, faces)
  const least = areaOf(triangles) * FACE_SHARE
  return {
    vertices: vertices.filter((_, i) => corners.has(i)),
    edges: segments.map(([a, b]) => [pointOf(a), pointOf(b)] as const),
    runs: runs.map((run) => run.map(pointOf)),
    faceCentres: flats.map(centreOf),
    faces: flats.filter((run) => areaOf(run) >= least).map((run) => faceOf(run, vertices))
  }
}

/** Which way a face looks under `place`: a mirror reverses the cross product, which the normal's own image gives away. */
const placedNormal = ({ centre, normal }: MeshFace, place: (point: Vec3) => Vec3): Vec3 => {
  const from = place(centre)
  const image = (direction: Vec3) => vecSub(place(vecAdd(centre, direction)), from)
  const across = squareTo(normal)
  const turned = vecCross(image(across), image(vecCross(normal, across)))
  return vecNormalize(vecDot(turned, image(normal)) < 0 ? vecScale(turned, -1) : turned)
}

/** `elements` under `place`, which takes a point of the mesh to the world. */
export const placedMesh = (elements: MeshElements, place: (point: Vec3) => Vec3): MeshElements => ({
  vertices: elements.vertices.map(place),
  edges: elements.edges.map(([a, b]) => [place(a), place(b)] as const),
  runs: elements.runs.map((run) => run.map(place)),
  faceCentres: elements.faceCentres.map(place),
  faces: elements.faces.map((face) => ({
    centre: place(face.centre),
    normal: placedNormal(face, place),
    corners: face.corners.map(place)
  }))
})

/** The point halfway along a polyline, by its length. */
const halfwayAlong = (run: ReadonlyArray<Vec3>): ReadonlyArray<Vec3> => {
  const segments = run.slice(1).map((to, i) => [run[i] ?? to, to] as const)
  let left = segments.reduce((sum, [a, b]) => sum + vecDistance(a, b), 0) / 2
  for (const [a, b] of segments) {
    const length = vecDistance(a, b)
    if (left < length) return [vecLerp(a, b, left / length)]
    left -= length
  }
  return []
}

/** The middle of each whole edge, however many segments the mesh gives it. */
export const runMidpoints = ({ edges, runs = edges }: WorldMesh): ReadonlyArray<Vec3> => runs.flatMap(halfwayAlong)
