import { gridOver, trianglesBox, type VoxelGrid, voxelize } from "../domain/approximate/grid/voxelize"
import { type Mesh, welded } from "../domain/approximate/mesh/mesh"
import { edgesOf, type Face, facesOf, growPatches, type Patch } from "../domain/approximate/plates/plateFaces"

type Point = readonly [number, number]

/**
 * A closed prism wound outward, as a flat triangle list: `outline`, anticlockwise in x and y and seen whole from its
 * first corner, swept along z from `from` to `to`. Each cap is a fan from the first corner, and each side two
 * triangles.
 */
export const prismTriangles = (outline: ReadonlyArray<Point>, from: number, to: number): Float32Array => {
  const out: Array<number> = []
  const corner = (i: number): Point => outline[i % outline.length] ?? [0, 0]
  for (let i = 0; i < outline.length; i++) {
    const [px, py] = corner(i), [qx, qy] = corner(i + 1)
    out.push(px, py, from, qx, qy, from, qx, qy, to, px, py, from, qx, qy, to, px, py, to)
    if (i === 0 || i === outline.length - 1) continue
    const [ox, oy] = corner(0)
    out.push(ox, oy, from, qx, qy, from, px, py, from, ox, oy, to, px, py, to, qx, qy, to)
  }
  return new Float32Array(out)
}

/** A regular polygon of `sides` corners `radius` from the origin, anticlockwise. */
export const regularOutline = (sides: number, radius: number): Array<Point> =>
  Array.from({ length: sides }, (_, k) => {
    const angle = 2 * Math.PI * k / sides
    return [radius * Math.cos(angle), radius * Math.sin(angle)]
  })

/** What the plates' stages read off a mesh: its faces, their edges and their patches, with the grid of its solid. */
export interface PlateSurface {
  readonly triangles: Float32Array
  readonly mesh: Mesh
  readonly grid: VoxelGrid
  readonly vertices: number
  readonly faces: ReadonlyArray<Face>
  readonly edges: Map<number, Array<number>>
  readonly patches: ReadonlyArray<Patch>
  readonly patchOf: Int32Array
}

/** `triangles` welded and read as the plates read a mesh, on a grid `resolution` cells along its longest side. */
export const plateSurface = (triangles: Float32Array, resolution = 16, flatness = 12): PlateSurface => {
  const mesh = welded(triangles)
  const grid = voxelize(triangles, gridOver(trianglesBox(triangles), resolution), { surface: true })
  const vertices = mesh.positions.length / 3
  const faces = facesOf(mesh, grid)
  const edges = edgesOf(faces, vertices)
  return { triangles, mesh, grid, vertices, faces, edges, ...growPatches(faces, edges, vertices, flatness) }
}

/** The index of the surface's patch that looks most along `direction`. */
export const patchFacing = (surface: PlateSurface, direction: readonly [number, number, number]): number => {
  const along = ({ normal }: Patch) => normal.x * direction[0] + normal.y * direction[1] + normal.z * direction[2]
  return surface.patches.reduce(
    (best, patch, id) => along(patch) > along(surface.patches[best] ?? patch) ? id : best,
    0
  )
}
