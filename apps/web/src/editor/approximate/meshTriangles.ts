/** The triangles of every mesh under an object as one flat list, nine numbers each, in the object's world frame. */
import * as THREE from "three"
import { isMesh } from "../threeGuards"

/** A mesh's corners in drawing order, three to a triangle; `count` is how many of them make whole triangles. */
interface Corners {
  readonly position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  readonly index: THREE.BufferAttribute | null
  readonly count: number
  /** The mesh's frame in the world's. */
  readonly matrix: THREE.Matrix4
}

const cornersOf = (mesh: THREE.Mesh): Corners | undefined => {
  const geometry = mesh.geometry
  // The typings say a geometry always has positions; one read from a file may have none.
  if (!geometry.hasAttribute("position")) return undefined
  const position = geometry.getAttribute("position")
  const index = geometry.getIndex()
  const count = index === null ? position.count : index.count
  return { position, index, count: count - count % 3, matrix: mesh.matrixWorld }
}

export const trianglesUnder = (root: THREE.Object3D): Float32Array => {
  root.updateMatrixWorld(true)
  const meshes: Array<Corners> = []
  root.traverse((object) => {
    const corners = isMesh(object) ? cornersOf(object) : undefined
    if (corners !== undefined) meshes.push(corners)
  })
  const triangles = new Float32Array(meshes.reduce((sum, { count }) => sum + count, 0) * 3)
  const corner = new THREE.Vector3()
  let at = 0
  for (const { count, index, matrix, position } of meshes) {
    for (let i = 0; i < count; i++) {
      corner.fromBufferAttribute(position, index === null ? i : index.getX(i)).applyMatrix4(matrix)
      triangles[at++] = corner.x
      triangles[at++] = corner.y
      triangles[at++] = corner.z
    }
  }
  return triangles
}
