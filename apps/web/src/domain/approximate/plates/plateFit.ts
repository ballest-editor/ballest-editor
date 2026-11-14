/**
 * One mesh covered with plates. A patch of nearly coplanar faces takes rectangles (thin cubes) where those cover it
 * with fewer pieces; every other face takes one side of a pyramid sunk into the model, two overlapping sides where it
 * isn't acute, or lenses (flattened pyramids) where the pyramid would show through the model's other side.
 */
import type { Vec3 } from "../../coords"
import { vecAdd, vecLength, vecLerp, vecScale, vecSub } from "../../ueMath"
import type { VoxelGrid } from "../grid/voxelize"
import type { Mesh } from "../mesh/mesh"
import { MeshSolid } from "../mesh/meshSolid"
import type { PlateSource } from "../mesh/remesh"
import { holder } from "../parts/bulk"
import type { Placement } from "../shapes"
import { acutePyramid, overlappingAcute } from "./acutePyramid"
import { PatchPlane, rectanglesOf } from "./patchPlane"
import { cornersOf, Depths, edgesOf, type Face, facesOf, growPatches, type Patch } from "./plateFaces"
import { pieceWorld, plateOverlap, rectanglePlate, shifted, trianglePieces, tucked } from "./platePieces"
import { emptyPaths, type FitOptions, type FittedPlates, type PlatePaths } from "./plateTypes"

type Triangle = readonly [Vec3, Vec3, Vec3]

/** A piece and its path, for renders. */
interface Tagged {
  readonly tag: string
  readonly piece: Placement
}

/** What the faces of one fit share. */
interface Fit {
  readonly grid: VoxelGrid
  readonly mesh: Mesh
  readonly faces: ReadonlyArray<Face>
  readonly edges: Map<number, Array<number>>
  readonly patchOf: Int32Array
  readonly depths: Depths
  /** The most a plate or a lens may be thick, cm. */
  readonly thickness: number
  /** How far a rectangle's plate reaches past each side, to tuck under its neighbours. */
  readonly overlap: number
  /** How far a point is outside the container: the low-poly solid, whose faces are what shows, and the covers. */
  readonly outside: (p: Vec3) => number
  /** Whether a cover hides the face; absent with no covers. */
  readonly hidden?: (face: Face, corners: Triangle) => boolean
  /** Counted as the faces are covered. */
  readonly paths: PlatePaths
}

/** The lengths of the triangle's three edges, added up. */
const edgeSum = ([a, b, c]: Triangle): number =>
  vecLength(vecSub(a, b)) + vecLength(vecSub(b, c)) + vecLength(vecSub(c, a))

// --- faces under a cover ------------------------------------------------------------------------------------------

/** A face's corners may stand this share of its mean edge further proud of a cover than the rest of it. */
const CORNER_LIFT = 0.15

/**
 * Whether a point is inside one of `covers`, and whether they hide a face: its centroid, its edges' middles and the
 * points halfway from its corners to its centroid within `grow` cm of a cover, and its corners within a little more.
 * The fit lifts a coarse mesh's corners off the surface to keep its volume, so they get that room.
 */
const coverTests = (covers: ReadonlyArray<Placement>, grow: number, voxel: number) => {
  const inside = holder(covers), under = holder(covers, grow)
  // The corners' room is rounded up to quarters of a voxel, so faces share the tests.
  const lifted = new Map<number, (p: Vec3) => boolean>()
  const underLifted = (quarters: number) => {
    let test = lifted.get(quarters)
    if (test === undefined) {
      test = holder(covers, grow + quarters * voxel / 4)
      lifted.set(quarters, test)
    }
    return test
  }
  const hidden = (face: Face, [a, b, c]: Triangle): boolean => {
    const mids = [vecLerp(a, b, 0.5), vecLerp(b, c, 0.5), vecLerp(c, a, 0.5)]
    const inner = [a, b, c].map((p) => vecLerp(p, face.centroid, 0.5))
    const lift = edgeSum([a, b, c]) / 3 * CORNER_LIFT
    return [face.centroid, ...mids, ...inner].every(under) &&
      [a, b, c].every(underLifted(Math.ceil(lift / (voxel / 4))))
  }
  return { inside, hidden }
}

// --- one face as pyramid sides ------------------------------------------------------------------------------------

/** Why a pyramid can't stand behind a face: a hidden corner of it, or an edge or its inside, leaves the container. */
type Failure = "depth" | "protrusion"

/**
 * Whether the hidden part of `piece`, a pyramid with `triangle` as its +X, +Y, apex side, fits the container within
 * 5% of the triangle's mean edge: its two hidden corners, then points along the edges from them and inside it.
 */
const guardFailure = (piece: Placement, triangle: Triangle, outside: (p: Vec3) => number): Failure | undefined => {
  const world = pieceWorld(piece)
  const hidden = [world(-1, 0, -1), world(0, -1, -1)]
  const all = [...hidden, world(1, 0, -1), world(0, 1, -1), world(0, 0, 1)]
  const tolerance = 0.05 * edgeSum(triangle) / 3
  const out = (p: Vec3) => outside(p) > tolerance
  if (hidden.some(out)) return "depth"
  const samples = [...hidden]
  for (const p of hidden) {
    for (const q of all) {
      for (const t of [0.25, 0.5, 0.75]) samples.push(vecAdd(vecScale(p, t), vecScale(q, 1 - t)))
    }
  }
  const centre = vecScale(all.reduce(vecAdd), 1 / all.length)
  samples.push(centre, ...all.map((p) => vecScale(vecAdd(p, centre), 0.5)))
  return samples.some(out) ? "protrusion" : undefined
}

/** A pyramid side over a triangle, or why there is none; neither for a triangle that isn't acute. */
interface Side {
  readonly piece?: Placement
  readonly failure?: Failure
}

/**
 * The pyramid behind `triangle` that fits the container, tried with each corner in turn on the pyramid's +X corner:
 * the three differ in where their hidden corners go.
 */
const pyramidSide = (triangle: Triangle, normal: Vec3, outside: (p: Vec3) => number): Side => {
  let failure: Failure | undefined
  for (let k = 0; k < 3; k++) {
    const [a, b, c] = [triangle[k], triangle[(k + 1) % 3], triangle[(k + 2) % 3]]
    if (a === undefined || b === undefined || c === undefined) return {}
    const piece = acutePyramid(a, b, c, normal)
    if (piece === undefined) return {}
    failure = guardFailure(piece, triangle, outside)
    if (failure === undefined) return { piece }
  }
  return failure === undefined ? {} : { failure }
}

// --- one face as lenses -------------------------------------------------------------------------------------------

/** A lens is thinned at most this many times, and never to under 0.5 cm thick. */
const HALVINGS = 6

/** `lens` halved in thickness about its middle slice until both its side corners are inside the container. */
const thinnedLens = (
  lens: Placement,
  tolerance: number,
  outside: (p: Vec3) => number
): { readonly piece: Placement; readonly halved: number } => {
  const thinnedTo = (x: number): Placement => ({ ...lens, half: { ...lens.half, x } })
  let x = lens.half.x, halved = 0
  for (; halved < HALVINGS && x > 0.25; halved++) {
    const world = pieceWorld(thinnedTo(x))
    if (outside(world(-1, 0, -1)) <= tolerance && outside(world(1, 0, -1)) <= tolerance) break
    x /= 2
  }
  return { piece: thinnedTo(x), halved }
}

/** What one face takes when no rectangle covers it: its pieces, the path it went, and how often they were thinned. */
interface FaceCover {
  readonly path: keyof PlatePaths
  readonly pieces: ReadonlyArray<Tagged>
  readonly halved: number
}

/** The face of patch `id` as one lens or two, each tucked under its neighbours and thinned to fit the container. */
const lensCover = (fit: Fit, face: Face, id: number, [a, b, c]: Triangle, path: keyof PlatePaths): FaceCover => {
  const inward = vecScale(face.normal, -1)
  const tolerance = 0.05 * Math.sqrt(face.area)
  // The second of a pair sinks a little further than the first, so the two aren't coplanar where they overlap.
  const sink = Math.max(0.3, 0.002 * Math.sqrt(face.area))
  const lenses = trianglePieces(a, b, c, fit.depths.thickness([face.centroid], face.normal, id, fit.thickness))
    .map((lens, k) => thinnedLens(shifted(tucked(lens, inward), inward, k * sink), tolerance, fit.outside))
  return {
    path,
    pieces: lenses.map(({ piece }) => ({ tag: "lens", piece })),
    halved: lenses.reduce((sum, lens) => sum + lens.halved, 0)
  }
}

/** The path of a face that goes to lenses: whether it is acute, and why its pyramids failed. */
const LENS_PATHS = {
  acute: { depth: "lensDepth", protrusion: "lensProtrusion" },
  wide: { depth: "splitDepth", protrusion: "splitProtrusion", none: "splitNonAcute" }
} as const

/**
 * What `face` of patch `id` takes on its own: nothing under a cover, one pyramid side where it is acute, two
 * overlapping sides where it isn't, and lenses where a pyramid would leave the container.
 */
const faceCover = (fit: Fit, face: Face, id: number): FaceCover => {
  const triangle = cornersOf(fit.mesh.positions, face.corners)
  if (fit.hidden?.(face, triangle) === true) return { path: "hidden", pieces: [], halved: 0 }
  const single = pyramidSide(triangle, face.normal, fit.outside)
  if (single.piece !== undefined) return { path: "one", pieces: [{ tag: "one", piece: single.piece }], halved: 0 }
  if (single.failure !== undefined) return lensCover(fit, face, id, triangle, LENS_PATHS.acute[single.failure])
  const pair = overlappingAcute(...triangle)?.map((half) => pyramidSide(half, face.normal, fit.outside))
  const [first, second] = [pair?.[0]?.piece, pair?.[1]?.piece]
  if (first !== undefined && second !== undefined) {
    // The second of the pair sinks a little, so the two aren't exactly coplanar where they overlap.
    const sink = Math.max(0.3, 0.004 * Math.sqrt(face.area))
    const pieces = [{ tag: "pair", piece: first }, { tag: "pair", piece: shifted(second, face.normal, -sink) }]
    return { path: "overlap", pieces, halved: 0 }
  }
  const failure = pair?.find((side) => side.failure !== undefined)?.failure
  return lensCover(fit, face, id, triangle, LENS_PATHS.wide[failure ?? "none"])
}

// --- one patch ----------------------------------------------------------------------------------------------------

/** A patch's pieces, rectangles first, and how many of them are rectangles. */
interface PatchCover {
  readonly pieces: ReadonlyArray<Tagged>
  readonly plates: number
}

/**
 * Patch `id` covered face by face, or by rectangles with the faces they leave bare covered on their own, where that
 * takes fewer pieces and every rectangle lies on the container's surface.
 */
const patchCover = (fit: Fit, patch: Patch, id: number): PatchCover => {
  const { paths } = fit
  const covers = new Map<number, FaceCover>()
  for (const f of patch.faces) {
    const face = fit.faces[f]
    if (face !== undefined) covers.set(f, faceCover(fit, face, id))
  }
  const coversOf = (list: ReadonlyArray<number>) => list.flatMap((f) => covers.get(f) ?? [])
  const piecesOf = (list: ReadonlyArray<number>) => coversOf(list).flatMap((cover) => cover.pieces)
  const halvings = (list: ReadonlyArray<number>) => coversOf(list).reduce((sum, cover) => sum + cover.halved, 0)
  const all = piecesOf(patch.faces)
  const faceByFace = (): PatchCover => {
    for (const cover of coversOf(patch.faces)) paths[cover.path]++
    return { pieces: all, plates: 0 }
  }
  // `thinned` counts every face's lenses, placed or not, and the bare faces' twice.
  paths.thinned += halvings(patch.faces)
  if (patch.faces.length === 1) return faceByFace()

  const plane = new PatchPlane(patch, fit.mesh, fit.faces, fit.edges, fit.patchOf, id)
  const { bare, rects } = rectanglesOf(plane, fit.thickness * 2, 2 * fit.grid.voxel * fit.grid.voxel)
  const leftovers = piecesOf(bare)
  paths.thinned += halvings(bare)
  if (rects.length + leftovers.length >= all.length) return faceByFace()
  const thicknessAt = (points: ReadonlyArray<Vec3>) => fit.depths.thickness(points, patch.normal, id, fit.thickness)
  const plates: Array<Tagged> = []
  for (const rect of rects) {
    const { halved, onSurface, plate } = rectanglePlate(plane, rect, thicknessAt, fit.overlap, fit.outside)
    paths.thinned += halved
    if (!onSurface) {
      paths.rectangleRejected++
      return faceByFace()
    }
    plates.push({ tag: "rectangle", piece: plate })
  }
  paths.rectangle += patch.faces.length - bare.length
  for (const cover of coversOf(bare)) paths[cover.path]++
  return { pieces: [...plates, ...leftovers], plates: plates.length }
}

// --- the fit ------------------------------------------------------------------------------------------------------

/**
 * `source` remeshed to `options.faces` faces, or `supplied` as it is, covered with plates that stay inside the mesh's
 * own solid. Faces that `options.covers` hide take no pieces, and the covers lead the placements.
 */
export const fitPlates = (
  grid: VoxelGrid,
  options: FitOptions,
  source: PlateSource,
  supplied?: Mesh
): FittedPlates => {
  const { acuteAfter, acuteBefore, mesh } = supplied === undefined ?
    source.remesh(options.faces, options.mirror) :
    { mesh: supplied, acuteBefore: 0, acuteAfter: 0 }
  const faces = facesOf(mesh, grid)
  const vertices = mesh.positions.length / 3
  const edges = edgesOf(faces, vertices)
  const { patches, patchOf } = growPatches(faces, edges, vertices, options.flatness)
  const lowPoly = new MeshSolid(mesh)
  const thickness = options.thickness > 0 ? options.thickness : grid.voxel
  const covers = options.covers ?? [], coverGrow = options.coverGrow ?? 0
  const covered = covers.length === 0 ? undefined : coverTests(covers, coverGrow, grid.voxel)
  const fit: Fit = {
    grid,
    mesh,
    faces,
    edges,
    patchOf,
    depths: new Depths(mesh, faces, patchOf),
    thickness,
    overlap: plateOverlap(thickness, grid.voxel),
    // A cover is solid, so what is inside one is out of sight.
    outside: covered === undefined ? (p) => lowPoly.outside(p) : (p) => covered.inside(p) ? 0 : lowPoly.outside(p),
    ...(covered !== undefined && { hidden: covered.hidden }),
    paths: emptyPaths()
  }

  const pieces: Array<Tagged> = []
  let plates = 0
  patches.forEach((patch, id) => {
    const cover = patchCover(fit, patch, id)
    pieces.push(...cover.pieces)
    plates += cover.plates
  })
  const placements = pieces.map(({ piece }) => piece), tags = pieces.map(({ tag }) => tag)
  return {
    representation: "mesh",
    cornerLocked: source.lockCoarseCorners,
    surfaceMesh: mesh,
    source,
    paths: fit.paths,
    acuteBefore,
    acuteAfter,
    repaired: source.repaired,
    placements: [...covers, ...placements],
    tags: [...covers.map(() => "bulk"), ...tags],
    ...(covers.length > 0 && { covers, coverGrow }),
    faces: faces.length,
    patches: patches.length,
    plates,
    triangles: pieces.length - plates,
    ...(options.mirror !== undefined && { mirror: options.mirror })
  }
}
