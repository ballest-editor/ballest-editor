/**
 * Plates' remesh: the model's surface cut down to a face budget and then made fit for flat pieces. Edges turn where
 * that sharpens no corner past a right angle, vertices slide along the surface toward the middle of their neighbours,
 * and a fit both ways (the model's samples pull the faces, the model's surface pulls the vertices) brings the coarse
 * mesh back onto the model.
 */
import type { Vec3 } from "../../coords"
import { vecAdd, vecCross, vecDot, vecLength, vecNormalize, vecScale, vecSub } from "../../ueMath"
import { PlateSolid } from "../grid/solid"
import { at, cellIndex, type VoxelGrid } from "../grid/voxelize"
import { cornerCosine } from "../plates/acutePyramid"
import { byPartners, type MirrorRemesh } from "../plates/plateMirror"
import { faceCount, type Mesh, simplified, welded } from "./mesh"
import { meshFace, meshNormal, meshVertex } from "./plateMesh"
import { Surface } from "./surface"

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

type Corners = ReadonlyArray<number>

const setVertex = (mesh: Mesh, i: number, p: Vec3) => {
  mesh.positions[3 * i] = p.x
  mesh.positions[3 * i + 1] = p.y
  mesh.positions[3 * i + 2] = p.z
}

/** The least cosine of the face's corners: above 0 only where every corner is acute, and higher the further from 90°. */
const quality = (mesh: Mesh, corners: Corners): number => {
  const a = meshVertex(mesh, corners[0] ?? 0), b = meshVertex(mesh, corners[1] ?? 0)
  const c = meshVertex(mesh, corners[2] ?? 0)
  return Math.min(cornerCosine(a, b, c), cornerCosine(b, c, a), cornerCosine(c, a, b))
}

/** The share of the mesh's faces whose corners are all acute. */
export const acuteShare = (mesh: Mesh): number => {
  let acute = 0
  for (let f = 0; f < faceCount(mesh); f++) if (quality(mesh, meshFace(mesh, f)) > 1e-6) acute++
  return acute / Math.max(1, faceCount(mesh))
}

/** One face's side of an edge: the edge runs from `a` to `b` in the face's winding, and `c` is the corner across it. */
interface EdgeSide {
  readonly face: number
  readonly a: number
  readonly b: number
  readonly c: number
}

const edgeKey = (a: number, b: number): string => `${Math.min(a, b)},${Math.max(a, b)}`

/** Every edge of the mesh with the sides of the faces that meet at it, edges and sides in face order. */
const edgeSides = (mesh: Mesh): Map<string, Array<EdgeSide>> => {
  const edges = new Map<string, Array<EdgeSide>>()
  for (let face = 0; face < faceCount(mesh); face++) {
    const corners = meshFace(mesh, face)
    for (let k = 0; k < 3; k++) {
      const a = corners[k] ?? 0, b = corners[(k + 1) % 3] ?? 0, c = corners[(k + 2) % 3] ?? 0
      const key = edgeKey(a, b)
      const sides = edges.get(key)
      if (sides === undefined) edges.set(key, [{ face, a, b, c }])
      else sides.push({ face, a, b, c })
    }
  }
  return edges
}

/**
 * Whether the mesh is open or non-manifold: some edge has other than two faces. Such a mesh is replaced by the closed
 * voxel surface (`cleanSurface`) before it is cut down, never handed to the sloppy simplifier, which ignores topology.
 */
export const needsCleanSurface = (mesh: Mesh): boolean =>
  [...edgeSides(mesh).values()].some((sides) => sides.length !== 2)

/**
 * A cube between eight voxel centres as six tetrahedra round the diagonal from corner 0 to corner 7. Every cube is cut
 * along the same diagonals, so neighbours agree on the face between them. Corner `i` is at bit 0 along x, bit 1 along
 * y and bit 2 along z.
 */
const TETRAHEDRA: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7]
]

/** The closed surface between the grid's solid and empty cells: marching tetrahedra over the cells' centres. */
export const cleanSurface = (grid: VoxelGrid): Mesh => {
  const triangles: Array<number> = []
  const [nx, ny, nz] = grid.n
  const solidAt = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && at(grid.cells, cellIndex(grid, x, y, z)) === 1
  const solid = new Uint8Array(8), centres = new Float64Array(24)
  // From -1, so the cubes between the outermost cells and the empty space round the grid close the surface.
  for (let z = -1; z < nz; z++) {
    for (let y = -1; y < ny; y++) {
      for (let x = -1; x < nx; x++) {
        let solids = 0
        for (let i = 0; i < 8; i++) {
          solid[i] = solidAt(x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1)) ? 1 : 0
          solids += at(solid, i)
        }
        if (solids === 0 || solids === 8) continue
        for (let i = 0; i < 8; i++) {
          centres[3 * i] = grid.origin.x + (x + (i & 1) + 0.5) * grid.voxel
          centres[3 * i + 1] = grid.origin.y + (y + ((i >> 1) & 1) + 0.5) * grid.voxel
          centres[3 * i + 2] = grid.origin.z + (z + ((i >> 2) & 1) + 0.5) * grid.voxel
        }
        for (const tetrahedron of TETRAHEDRA) cutTetrahedron(tetrahedron, solid, centres, triangles)
      }
    }
  }
  return welded(new Float32Array(triangles))
}

/**
 * Adds to `triangles` the surface inside one tetrahedron of a cube, through the middles of its edges that join a solid
 * corner to an empty one: a triangle where one corner differs from the other three, two where they are two and two.
 * Each is wound to look from the solid out.
 */
const cutTetrahedron = (
  tetrahedron: ReadonlyArray<number>,
  solid: Uint8Array,
  centres: Float64Array,
  triangles: Array<number>
) => {
  const inside = tetrahedron.filter((i) => at(solid, i) === 1), outside = tetrahedron.filter((i) => at(solid, i) === 0)
  if (inside.length === 0 || outside.length === 0) return
  const [in0 = 0, in1 = 0] = inside, [out0 = 0, out1 = 0] = outside
  const centre = (i: number): Vec3 => ({ x: at(centres, 3 * i), y: at(centres, 3 * i + 1), z: at(centres, 3 * i + 2) })
  const middle = (i: number, j: number) => vecScale(vecAdd(centre(i), centre(j)), 0.5)
  const outward = vecSub(centre(out0), centre(in0))
  const emit = (a: Vec3, b: Vec3, c: Vec3) => {
    if (vecDot(vecCross(vecSub(b, a), vecSub(c, a)), outward) < 0) [b, c] = [c, b]
    triangles.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }
  if (inside.length === 1 || outside.length === 1) {
    const lone = inside.length === 1 ? in0 : out0
    const [o0 = 0, o1 = 0, o2 = 0] = inside.length === 1 ? outside : inside
    emit(middle(lone, o0), middle(lone, o1), middle(lone, o2))
  } else {
    const a = middle(in0, out0), b = middle(in0, out1), c = middle(in1, out0), d = middle(in1, out1)
    emit(a, b, c)
    emit(b, d, c)
  }
}

/** An edge turned: the edge it was, and the corners its two faces get. */
interface Turn {
  readonly a: number
  readonly b: number
  readonly faces: ReadonlyArray<{ readonly face: number; readonly corners: Corners }>
}

/** Passes over the edges one round of turning makes. */
const TURN_PASSES = 4

/** Faces across an edge whose unit normals' dot is below this meet at a crease, which stays. */
const CREASE = 0.8

/** How much the worse of an edge's two faces must gain in quality for the edge to turn. */
const TURN_GAIN = 0.02

/**
 * Whether turning the edge between the faces with corners `oldA` and `oldB`, which makes them `nextA` and `nextB`,
 * keeps the surface's shape (no crease lost, neither face folded over) and improves the worse face's quality.
 */
const turnPays = (mesh: Mesh, oldA: Corners, oldB: Corners, nextA: Corners, nextB: Corners): boolean => {
  const normalA = meshNormal(mesh, oldA), normalB = meshNormal(mesh, oldB)
  if (vecDot(vecNormalize(normalA), vecNormalize(normalB)) < CREASE) return false
  if (vecDot(meshNormal(mesh, nextA), normalA) <= 0 || vecDot(meshNormal(mesh, nextB), normalB) <= 0) return false
  const before = Math.min(quality(mesh, oldA), quality(mesh, oldB))
  const after = Math.min(quality(mesh, nextA), quality(mesh, nextB))
  if (after <= before + TURN_GAIN) return false
  return true
}

/**
 * One pass over the mesh's edges as they were when it began, turning each that pays. A face turns once a pass. With
 * `partners` (a mirror-symmetric mesh's vertex pairs), an edge on the plane never turns, and any other turns only
 * together with its mirror image, so the topology stays symmetric.
 */
const turnEdgesOnce = (mesh: Mesh, partners: Int32Array | undefined) => {
  const edges = edgeSides(mesh)
  const turned = new Set<number>()
  /** The turn of the edge with these sides, if it may turn. */
  const turnOf = (sides: ReadonlyArray<EdgeSide> | undefined): Turn | undefined => {
    const [one, other] = sides ?? []
    if (sides?.length !== 2 || one === undefined || other === undefined) return undefined
    if (turned.has(one.face) || turned.has(other.face)) return undefined
    // The two faces must run the edge opposite ways, and the edge across must not be there already.
    if (one.a !== other.b || one.b !== other.a || one.c === other.c || edges.has(edgeKey(one.c, other.c))) {
      return undefined
    }
    if (partners !== undefined && partners[one.a] === one.a && partners[one.b] === one.b) return undefined
    const nextA = [one.c, other.c, one.b], nextB = [other.c, one.c, one.a]
    if (!turnPays(mesh, meshFace(mesh, one.face), meshFace(mesh, other.face), nextA, nextB)) return undefined
    return { a: one.a, b: one.b, faces: [{ face: one.face, corners: nextA }, { face: other.face, corners: nextB }] }
  }
  const apply = (turn: Turn) => {
    for (const { corners, face } of turn.faces) {
      mesh.indices.set(corners, 3 * face)
      turned.add(face)
    }
  }
  for (const sides of edges.values()) {
    const turn = turnOf(sides)
    if (turn === undefined) continue
    if (partners === undefined) {
      apply(turn)
      continue
    }
    const imageA = partners[turn.a] ?? -1, imageB = partners[turn.b] ?? -1
    // An edge across the plane is its own image, and turns into one that is too.
    if ((imageA === turn.a && imageB === turn.b) || (imageA === turn.b && imageB === turn.a)) {
      apply(turn)
      continue
    }
    const image = edges.get(edgeKey(imageA, imageB))
    if (image === undefined || image.some((side) => turn.faces.some(({ face }) => face === side.face))) continue
    const mirrored = turnOf(image)
    if (mirrored === undefined) continue
    apply(turn)
    apply(mirrored)
  }
}

const turnEdges = (mesh: Mesh, partners: Int32Array | undefined) => {
  for (let pass = 0; pass < TURN_PASSES; pass++) turnEdgesOnce(mesh, partners)
}

/** The faces at each vertex, in face order. */
const facesByVertex = (mesh: Mesh): Map<number, Array<number>> => {
  const incident = new Map<number, Array<number>>()
  for (let f = 0; f < faceCount(mesh); f++) {
    for (const i of meshFace(mesh, f)) {
      const faces = incident.get(i)
      if (faces === undefined) incident.set(i, [f])
      else faces.push(f)
    }
  }
  return incident
}

/** With coarse corners locked, a vertex stays where a face of its is further than this (a cosine) off their mean. */
const COARSE_CORNER = 0.7

/** The share of its area, along its old normal, a face must keep when a vertex of its moves. */
const LEAST_FACE = 0.2

/** How many times a move is halved before it is given up. */
const MOVE_TRIALS = 6

/**
 * Moves vertex `i` toward `next`, by the whole way or the largest of its halvings that neither turns over nor nearly
 * collapses any of the vertex's `faces`, or not at all. With `lockCoarseCorners`, a vertex at a corner of the coarse
 * mesh doesn't move: a corner between coarse facets is no evidence of a crease in the model, but moving it loses it.
 */
const moveVertex = (mesh: Mesh, faces: ReadonlyArray<number>, i: number, next: Vec3, lockCoarseCorners: boolean) => {
  const old = meshVertex(mesh, i)
  const normals = faces.map((f) => meshNormal(mesh, meshFace(mesh, f)))
  if (lockCoarseCorners) {
    let sum = ZERO
    for (const n of normals) sum = vecAdd(sum, n)
    const mean = vecNormalize(sum)
    if (normals.some((n) => vecDot(vecNormalize(n), mean) < COARSE_CORNER)) return
  }
  const keepsFaces = () =>
    faces.every((f, k) => {
      const before = normals[k] ?? ZERO
      return vecDot(meshNormal(mesh, meshFace(mesh, f)), before) > LEAST_FACE * vecDot(before, before)
    })
  let fraction = 1
  for (let trial = 0; trial < MOVE_TRIALS; trial++) {
    setVertex(mesh, i, vecAdd(old, vecScale(vecSub(next, old), fraction)))
    if (keepsFaces()) return
    fraction *= 0.5
  }
  setVertex(mesh, i, old)
}

/** How far toward the middle of its neighbours a vertex slides in one relaxation step. */
const RELAX_SHARE = 0.25

/**
 * Where one relaxation step sends each of the `used` vertices: a quarter of the way to the mean of its neighbours,
 * along the mesh only (across its normal there), and from there onto `surface`. In the order of `used`.
 */
const relaxedTargets = (mesh: Mesh, used: Iterable<number>, surface: Surface): Array<readonly [number, Vec3]> => {
  const neighbours = new Map<number, Set<number>>()
  const normals = new Map<number, Vec3>()
  for (let f = 0; f < faceCount(mesh); f++) {
    const face = meshFace(mesh, f), normal = meshNormal(mesh, face)
    for (const i of face) {
      const around = neighbours.get(i) ?? new Set<number>()
      for (const j of face) if (i !== j) around.add(j)
      neighbours.set(i, around)
      normals.set(i, vecAdd(normals.get(i) ?? ZERO, normal))
    }
  }
  const targets: Array<readonly [number, Vec3]> = []
  for (const i of used) {
    const p = meshVertex(mesh, i), around = neighbours.get(i) ?? new Set<number>()
    let mean = ZERO
    for (const j of around) mean = vecAdd(mean, meshVertex(mesh, j))
    mean = vecScale(mean, 1 / Math.max(1, around.size))
    const normal = vecNormalize(normals.get(i) ?? { x: 0, y: 0, z: 1 }), toMean = vecSub(mean, p)
    const along = vecSub(toMean, vecScale(normal, vecDot(toMean, normal)))
    targets.push([i, surface.nearest(vecAdd(p, vecScale(along, RELAX_SHARE))).point])
  }
  return targets
}

/** The shares of the samples' pull and of the surface's pull a vertex follows in one fit step. */
const SAMPLE_PULL = 0.5
const SURFACE_PULL = 0.2

/**
 * Where one fit step sends vertex `i`. The model's `samples` each pull the point of the mesh nearest them, shared out
 * over that face's corners by its weights, so faces come out to cover the model; and each vertex is pulled to the
 * nearest point of `surface`, so it stays on the model. A vertex no sample reaches follows the surface alone.
 */
const fitTargets = (mesh: Mesh, samples: ReadonlyArray<Vec3>, surface: Surface): (i: number) => Vec3 => {
  const current = new Surface(mesh)
  const pulls = new Map<number, Vec3>(), weights = new Map<number, number>()
  for (const sample of samples) {
    const hit = current.nearest(sample), pull = vecSub(sample, hit.point)
    meshFace(mesh, hit.face).forEach((i, k) => {
      const weight = hit.weights[k] ?? 0
      pulls.set(i, vecAdd(pulls.get(i) ?? ZERO, vecScale(pull, weight)))
      weights.set(i, (weights.get(i) ?? 0) + weight * weight)
    })
  }
  return (i) => {
    const p = meshVertex(mesh, i), toSurface = vecSub(surface.nearest(p).point, p)
    const toSamples = vecScale(pulls.get(i) ?? toSurface, 1 / Math.max(1, weights.get(i) ?? 0))
    return vecAdd(p, vecAdd(vecScale(toSamples, SAMPLE_PULL), vecScale(toSurface, SURFACE_PULL)))
  }
}

/** Samples of the model's surface a source keeps. */
const SAMPLES = 4000

/**
 * `SAMPLES` points spread evenly over the mesh's area, the same every time: sample k is the centre of the face that
 * holds the middle of the k-th equal share of the area, so a crowd of tiny triangles doesn't dominate the fit.
 */
const areaSamples = (mesh: Mesh): Array<Vec3> => {
  const upTo: Array<number> = []
  let area = 0
  for (let f = 0; f < faceCount(mesh); f++) {
    area += vecLength(meshNormal(mesh, meshFace(mesh, f)))
    upTo.push(area)
  }
  const samples: Array<Vec3> = []
  let f = 0
  for (let k = 0; k < SAMPLES; k++) {
    const target = area * (k + 0.5) / SAMPLES
    while ((upTo[f] ?? Infinity) < target) f++
    const [ia, ib, ic] = meshFace(mesh, f)
    const a = meshVertex(mesh, ia), b = meshVertex(mesh, ib), c = meshVertex(mesh, ic)
    samples.push(vecScale(vecAdd(vecAdd(a, b), c), 1 / 3))
  }
  return samples
}

/** Steps of turning and relaxing, then of fitting, a remesh makes. */
const RELAX_STEPS = 4
const FIT_STEPS = 4

/**
 * A model ready to be remeshed at any face budget: the mesh the remesh starts from, the surface it follows and samples
 * of it, and the model's solid. These are what costs, and every budget tried shares them.
 */
export class PlateSource {
  readonly lockCoarseCorners: boolean
  readonly solid: PlateSolid
  /** What a remesh cuts down: the model's own mesh, or the voxel surface where that was `repaired`. */
  readonly mesh: Mesh
  /** The model's own surface, which the fit follows whether or not the mesh was repaired. */
  readonly surface: Surface
  /** Whether the remesh starts from the voxel surface: the model's mesh is open or non-manifold, or `forceClean`. */
  readonly repaired: boolean
  readonly samples: ReadonlyArray<Vec3>
  /** The welded mesh the fit follows. */
  private readonly original: Mesh
  private readonly grid: VoxelGrid

  /**
   * `surface`, when given, is what the fit follows in place of `triangles` (a model with parts taken out), with
   * `forceClean` so the remesh starts from the voxel surface of `grid`. `shared` is another source over the same model
   * and grid, whose costly parts this one takes: `variant` passes it.
   */
  constructor(
    triangles: Float32Array,
    grid: VoxelGrid,
    forceClean = false,
    lockCoarseCorners = false,
    surface?: Float32Array,
    shared?: PlateSource
  ) {
    this.lockCoarseCorners = lockCoarseCorners
    this.grid = grid
    this.solid = shared?.solid ?? new PlateSolid(grid)
    this.original = shared?.original ?? welded(surface ?? triangles)
    this.repaired = forceClean || (shared === undefined ? needsCleanSurface(this.original) : shared.repaired)
    this.mesh = !this.repaired ? this.original : shared?.repaired === true ? shared.mesh : cleanSurface(grid)
    this.surface = shared?.surface ?? new Surface(this.original)
    this.samples = shared?.samples ?? areaSamples(this.original)
  }

  /** This source remeshed another way: from the voxel surface, or keeping coarse corners. A repaired source stays so. */
  variant(forceClean: boolean, lockCoarseCorners: boolean): PlateSource {
    return new PlateSource(new Float32Array(0), this.grid, forceClean, lockCoarseCorners, undefined, this)
  }

  /**
   * This source cut down to about `faces` faces and fitted back to the model, with the share of acute faces before and
   * after the fit. With `mirror`, the mesh is cut down symmetrically and stays symmetric: edges turn in mirror pairs,
   * and every step ends with each pair of vertices moved to mirror images of their mean.
   */
  remesh(faces: number, mirror?: MirrorRemesh): { mesh: Mesh; acuteBefore: number; acuteAfter: number } {
    const paired = mirror?.decimate(this.mesh, faces)
    const coarse = paired?.mesh ?? simplified(this.mesh, faces)
    const mesh: Mesh = { positions: coarse.positions.slice(), indices: coarse.indices.slice() }
    const acuteBefore = acuteShare(mesh)
    if (faceCount(this.mesh) <= faces) return { mesh, acuteBefore, acuteAfter: acuteBefore }
    const partners = paired?.partners
    const mirrorPairs = () => {
      if (mirror !== undefined && partners !== undefined) {
        mesh.positions.set(byPartners(mesh, mirror.plane, partners).positions)
      }
    }
    // The vertices the faces use, in the order the faces first name them. Turning an edge never changes which.
    const used = new Set(mesh.indices)
    let incident = new Map<number, Array<number>>()
    const move = (i: number, next: Vec3) => moveVertex(mesh, incident.get(i) ?? [], i, next, this.lockCoarseCorners)
    for (let step = 0; step < RELAX_STEPS; step++) {
      turnEdges(mesh, partners)
      incident = facesByVertex(mesh)
      // Every target is worked out before any vertex moves.
      for (const [i, target] of relaxedTargets(mesh, used, this.surface)) move(i, target)
      mirrorPairs()
    }
    for (let step = 0; step < FIT_STEPS; step++) {
      const target = fitTargets(mesh, this.samples, this.surface)
      for (const i of used) move(i, target(i))
      mirrorPairs()
    }
    turnEdges(mesh, partners)
    mirrorPairs()
    return { mesh, acuteBefore, acuteAfter: acuteShare(mesh) }
  }
}
