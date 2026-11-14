/** Rectangles over a mesh's nearly flat patches, as a representation of its own: a cylinder becomes a ring of strips. */
import type { Vec3 } from "../../coords"
import { vecAdd, vecDot, vecScale, vecSub } from "../../ueMath"
import { pointAt, type VoxelGrid } from "../grid/voxelize"
import { type Mesh, simplified, welded } from "../mesh/mesh"
import { MeshSolid } from "../mesh/meshSolid"
import type { Placement } from "../shapes"
import { PatchPlane, type Rect, rectanglesOf } from "./patchPlane"
import { Depths, edgesOf, type Face, facesOf, mergedPatches, type Patch } from "./plateFaces"
import { plateOverlap, rectanglePlate } from "./platePieces"

/** Faces of the mesh rectangles are fitted on: the original, lightly simplified, which keeps its creases. */
const STRIP_FACES = 2000

/** Faces of the mesh rectangles must stay inside: lighter, since it is tested at every rectangle's outline. */
const STRIP_SOLID_FACES = 800

/** What one strips fit made: its plates, and how many rectangles left the surface even when shrunk. */
interface Strips {
  readonly placements: ReadonlyArray<Placement>
  readonly patches: number
  readonly rejected: number
  readonly flatness: number
  readonly minArea: number
}

/** One patch's plates, and how many of its rectangles were dropped. */
interface PatchStrips {
  readonly plates: ReadonlyArray<Placement>
  readonly rejected: number
}

/** A mesh rectangles are fitted on, with what every fit over it shares. */
interface StripMesh {
  readonly mesh: Mesh
  readonly faces: ReadonlyArray<Face>
  readonly edges: Map<number, Array<number>>
  /** What the plates must stay inside. */
  readonly solid: MeshSolid
  readonly grid: VoxelGrid
  readonly thickness: number
  /** The strips of each patch fitted so far, by its faces: a later fit with the same patch takes them as they are. */
  readonly done: Map<string, PatchStrips>
}

/** How often a rectangle whose outline leaves the surface is tried again, a tenth shorter at each side. */
const SHRINKS = 2

/**
 * The plate over `rect` of `plane`, patch `id`: the first of the rectangle and of it shrunk about its middle whose
 * outline lies on the mesh's surface, or undefined when none does.
 */
const stripOver = (on: StripMesh, plane: PatchPlane, rect: Rect, depths: Depths, id: number): Placement | undefined => {
  const thicknessAt = (points: ReadonlyArray<Vec3>) => depths.thickness(points, plane.patch.normal, id, on.thickness)
  const overlap = plateOverlap(on.thickness, on.grid.voxel)
  let shrunk = rect
  for (let k = 0; k <= SHRINKS; k++) {
    const { onSurface, plate } = rectanglePlate(plane, shrunk, thicknessAt, overlap, (p) => on.solid.outside(p))
    if (onSurface) return plate
    const ds = (shrunk.s1 - shrunk.s0) * 0.1, dt = (shrunk.t1 - shrunk.t0) * 0.1
    shrunk = { s0: shrunk.s0 + ds, s1: shrunk.s1 - ds, t0: shrunk.t0 + dt, t1: shrunk.t1 - dt }
  }
  return undefined
}

/**
 * `patch` moved along its normal to its lowest corner. On a curved patch the mean plane's edges stand out past the
 * surface: a strip on the chord through the lowest corners meets its neighbours along their edges, like the facets
 * of a prism.
 */
const onChord = (on: StripMesh, patch: Patch): Patch => {
  let lowest = 0
  for (const f of patch.faces) {
    for (const i of on.faces[f]?.corners ?? []) {
      lowest = Math.min(lowest, vecDot(vecSub(pointAt(on.mesh.positions, i), patch.centroid), patch.normal))
    }
  }
  return { ...patch, centroid: vecAdd(patch.centroid, vecScale(patch.normal, lowest)) }
}

/** Patch `id` covered by rectangles alone, however much of it they leave bare. */
const patchStrips = (on: StripMesh, patch: Patch, id: number, patchOf: Int32Array, depths: Depths): PatchStrips => {
  const plane = new PatchPlane(onChord(on, patch), on.mesh, on.faces, on.edges, patchOf, id)
  const plates: Array<Placement> = []
  let rejected = 0
  for (const rect of rectanglesOf(plane, on.thickness * 2, Infinity).rects) {
    const plate = stripOver(on, plane, rect, depths, id)
    if (plate === undefined) rejected++
    else plates.push(plate)
  }
  return { plates, rejected }
}

/**
 * Rectangles over the mesh's patches at `flatness`, patches under `minArea` merged into their flattest neighbours:
 * every patch covered by rectangles and never by triangles, each plate kept inside the mesh's own solid with its
 * outline on the surface. Where that makes more than `budget`, the smallest go.
 */
const stripsAt = (on: StripMesh, flatness: number, minArea: number, budget: number): Strips => {
  const { patches, patchOf } = mergedPatches(on.faces, on.edges, on.mesh.positions.length / 3, flatness, minArea)
  const placements: Array<Placement> = []
  let rejected = 0, depths: Depths | undefined
  patches.forEach((patch, id) => {
    const key = [...patch.faces].sort((x, y) => x - y).join(",")
    let strips = on.done.get(key)
    if (strips === undefined) {
      depths ??= new Depths(on.mesh, on.faces, patchOf)
      strips = patchStrips(on, patch, id, patchOf, depths)
      on.done.set(key, strips)
    }
    placements.push(...strips.plates)
    rejected += strips.rejected
  })
  const area = (plate: Placement) => plate.half.x * plate.half.y
  const kept = placements.length <= budget
    ? placements
    : [...placements].sort((x, y) => area(y) - area(x)).slice(0, budget)
  return { placements: kept, patches: patches.length, rejected, flatness, minArea }
}

/** The patches make at most this share of the budget, since a patch takes two or three rectangles; and four at least. */
const PATCH_SHARE = 0.5

/** Smallest patch areas, as shares of the model's: smaller patches merge into their neighbours. */
const STRIP_MERGE = [0.002, 0.005]

/** The range of flatness tried, in degrees, and the steps of the bisection over it. */
const FINEST = 2
const COARSEST = 80
const BISECTIONS = 7

/**
 * Rectangles that fit the budget, one fit for each smallest patch area in `STRIP_MERGE`: the finest flatness whose
 * patches number at most `PATCH_SHARE` of the budget, found by bisection over the patches alone, then that
 * flatness's rectangles, the smallest dropped past the budget. No fit where even the coarsest flatness makes more
 * patches than that.
 */
export const stripsWithin = (
  triangles: Float32Array,
  grid: VoxelGrid,
  thickness: number,
  budget: number
): Array<Strips> => {
  const mesh = simplified(welded(triangles), STRIP_FACES)
  const faces = facesOf(mesh, grid)
  const vertices = mesh.positions.length / 3
  const on: StripMesh = {
    mesh,
    faces,
    edges: edgesOf(faces, vertices),
    solid: new MeshSolid(simplified(mesh, STRIP_SOLID_FACES)),
    grid,
    thickness,
    done: new Map()
  }
  let total = 0
  for (const face of faces) total += face.area
  const most = Math.max(4, Math.floor(budget * PATCH_SHARE))
  const fits: Array<Strips> = []
  for (const share of STRIP_MERGE) {
    const minArea = share * total
    const fitsAt = (flatness: number) =>
      mergedPatches(faces, on.edges, vertices, flatness, minArea).patches.length <= most
    if (!fitsAt(COARSEST)) continue
    let low = FINEST, high = COARSEST
    for (let step = 0; step < BISECTIONS; step++) {
      const middle = (low + high) / 2
      if (fitsAt(middle)) high = middle
      else low = middle
    }
    fits.push(stripsAt(on, high, minArea, budget))
  }
  return fits
}
