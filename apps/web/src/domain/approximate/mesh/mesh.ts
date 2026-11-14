/**
 * A model's triangles as an indexed mesh: corners that coincide are one vertex, so a face knows its neighbours, and the
 * mesh can be cut down to a face budget by meshoptimizer's simplifier (the library the asset pack is built with). The
 * simplifier is WebAssembly and loads asynchronously: await `meshReady` once before calling `simplified`.
 */
import { MeshoptSimplifier } from "meshoptimizer/simplifier"
import { at, trianglesBox } from "../grid/voxelize"

export interface Mesh {
  /** x, y, z per vertex, cm. */
  readonly positions: Float32Array
  /** Three vertex indices per face. */
  readonly indices: Uint32Array
}

export const meshReady: Promise<void> = MeshoptSimplifier.ready

export const faceCount = (mesh: Mesh): number => mesh.indices.length / 3

/** Copies vertex `vertex` of `mesh` to `out`, starting at `offset`. */
const copyVertex = (mesh: Mesh, vertex: number, out: Float32Array | Float64Array, offset: number) => {
  out[offset] = at(mesh.positions, 3 * vertex)
  out[offset + 1] = at(mesh.positions, 3 * vertex + 1)
  out[offset + 2] = at(mesh.positions, 3 * vertex + 2)
}

/** The corners of `faces` (three vertex indices each) as x, y, z per corner, nine numbers a face, for tight loops. */
export const cornerData = (mesh: Mesh, faces: ReadonlyArray<ArrayLike<number>>): Float64Array => {
  const data = new Float64Array(faces.length * 9)
  faces.forEach((corners, f) => {
    for (let k = 0; k < 3; k++) copyVertex(mesh, corners[k] ?? 0, data, 9 * f + 3 * k)
  })
  return data
}

/** The mesh as a flat triangle list, nine numbers a face. */
export const trianglesOfMesh = (mesh: Mesh): Float32Array => {
  const triangles = new Float32Array(mesh.indices.length * 3)
  for (let k = 0; k < mesh.indices.length; k++) copyVertex(mesh, at(mesh.indices, k), triangles, 3 * k)
  return triangles
}

/** The share of the model's longest side within which two corners are the same vertex. */
const WELD_SHARE = 1e-5

/** `triangles` as a mesh: corners in the same cell of a lattice a hundred-thousandth of the model's size are one vertex. */
export const welded = (triangles: Float32Array): Mesh => {
  const { max, min } = trianglesBox(triangles)
  const step = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1e-6) * WELD_SHARE
  const vertexAt = new Map<string, number>()
  const positions: Array<number> = []
  const indices = new Uint32Array(triangles.length / 3)
  for (let corner = 0; corner < indices.length; corner++) {
    const x = at(triangles, 3 * corner), y = at(triangles, 3 * corner + 1), z = at(triangles, 3 * corner + 2)
    const cell = `${Math.round(x / step)},${Math.round(y / step)},${Math.round(z / step)}`
    let vertex = vertexAt.get(cell)
    if (vertex === undefined) {
      vertex = positions.length / 3
      vertexAt.set(cell, vertex)
      positions.push(x, y, z)
    }
    indices[corner] = vertex
  }
  return { positions: new Float32Array(positions), indices: withoutDegenerate(indices) }
}

/** `indices` less the faces that name a vertex twice. */
const withoutDegenerate = (indices: Uint32Array): Uint32Array => {
  const kept: Array<number> = []
  for (let f = 0; f < indices.length; f += 3) {
    const a = at(indices, f), b = at(indices, f + 1), c = at(indices, f + 2)
    if (a !== b && b !== c && a !== c) kept.push(a, b, c)
  }
  return new Uint32Array(kept)
}

/** How far over its target the simplifier may stop before the sloppy one takes over. */
const STALLED = 1.5

/**
 * `mesh` with about `faces` faces, or as close as the simplifier gets. Where the mesh's topology stops it well short
 * (open or non-manifold meshes often do), the sloppy simplifier, which ignores topology, takes over.
 */
export const simplified = (mesh: Mesh, faces: number): Mesh => {
  if (faceCount(mesh) <= faces) return mesh
  const target = Math.max(3, Math.round(faces) * 3)
  let [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, 1)
  if (indices.length > target * STALLED) {
    ;[indices] = MeshoptSimplifier.simplifySloppy(indices, mesh.positions, 3, null, target, 1)
  }
  return { positions: mesh.positions, indices: withoutDegenerate(indices) }
}
