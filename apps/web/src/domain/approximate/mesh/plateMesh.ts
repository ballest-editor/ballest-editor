/** Reads of an indexed mesh that plates' remesh, its mirror and its search share. */
import type { Vec3 } from "../../coords"
import { vecCross, vecSub } from "../../ueMath"
import { at } from "../grid/voxelize"
import type { Mesh } from "./mesh"

export const meshVertex = (mesh: Mesh, i: number): Vec3 => ({
  x: at(mesh.positions, 3 * i),
  y: at(mesh.positions, 3 * i + 1),
  z: at(mesh.positions, 3 * i + 2)
})

/** The three vertex indices of face `f`. */
export const meshFace = (mesh: Mesh, f: number): [number, number, number] => [
  at(mesh.indices, 3 * f),
  at(mesh.indices, 3 * f + 1),
  at(mesh.indices, 3 * f + 2)
]

/** The normal of the face with these `corners`, as long as twice its area. It is taken from the first corner. */
export const meshNormal = (mesh: Mesh, corners: ReadonlyArray<number>): Vec3 => {
  const a = meshVertex(mesh, corners[0] ?? 0)
  const b = meshVertex(mesh, corners[1] ?? 0)
  const c = meshVertex(mesh, corners[2] ?? 0)
  return vecCross(vecSub(b, a), vecSub(c, a))
}
