/**
 * Triangle winding guard for piece glbs.
 *
 * three.js decides "front" in local space: when a world matrix is mirrored (our UE ->
 * three matrix has det -1) it flips gl.frontFace to compensate. So a glb renders solid
 * with FrontSide only if its triangles wind counter-clockwise around their normals in
 * the file's own coordinates. The first extractor exports kept UE's index order and were
 * inside-out (rings looked hollow); the current ones are valid glTF.
 *
 * `fixWinding` checks each geometry once and reverses the winding only when most
 * triangles disagree with their normals, so correct files are left alone and stale
 * inside-out exports still render correctly. No BackSide/DoubleSide anywhere.
 */
import * as THREE from "three"

const FIXED = "ballestWindingChecked"

/** Fraction of triangles whose geometric normal (right-handed cross product) agrees with the vertex normals. */
export const normalAgreement = (geometry: THREE.BufferGeometry): number | undefined => {
  // glTF meshes may lack normals; the typings claim the attributes always exist.
  if (!geometry.hasAttribute("position") || !geometry.hasAttribute("normal")) return undefined
  const position = geometry.getAttribute("position")
  const normal = geometry.getAttribute("normal")
  const index = geometry.getIndex()
  const triangles = Math.floor((index?.count ?? position.count) / 3)
  if (triangles === 0) return undefined
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const n = new THREE.Vector3(), tmp = new THREE.Vector3()
  let agree = 0
  for (let t = 0; t < triangles; t++) {
    const ia = index ? index.getX(3 * t) : 3 * t
    const ib = index ? index.getX(3 * t + 1) : 3 * t + 1
    const ic = index ? index.getX(3 * t + 2) : 3 * t + 2
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib).sub(a)
    c.fromBufferAttribute(position, ic).sub(a)
    n.fromBufferAttribute(normal, ia)
      .add(tmp.fromBufferAttribute(normal, ib))
      .add(tmp.fromBufferAttribute(normal, ic))
    if (b.cross(c).dot(n) >= 0) agree++
  }
  return agree / triangles
}

/** Swaps the 2nd and 3rd vertex of every triangle (indices, or vertex data when non-indexed). */
export const reverseWinding = (geometry: THREE.BufferGeometry): void => {
  const index = geometry.getIndex()
  if (index !== null) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const second = index.getX(i + 1)
      index.setX(i + 1, index.getX(i + 2))
      index.setX(i + 2, second)
    }
    index.needsUpdate = true
    return
  }
  for (const attribute of Object.values(geometry.attributes)) {
    const size = attribute.itemSize
    for (let v = 0; v + 2 < attribute.count; v += 3) {
      for (let k = 0; k < size; k++) {
        const second = attribute.getComponent(v + 1, k)
        attribute.setComponent(v + 1, k, attribute.getComponent(v + 2, k))
        attribute.setComponent(v + 2, k, second)
      }
    }
    attribute.needsUpdate = true
  }
}

/** Makes triangles wind counter-clockwise around their normals. Idempotent; returns true if it flipped. */
export const fixWinding = (geometry: THREE.BufferGeometry): boolean => {
  if (geometry.userData[FIXED] === true) return false
  geometry.userData[FIXED] = true
  const agreement = normalAgreement(geometry)
  if (agreement === undefined || agreement >= 0.5) return false
  reverseWinding(geometry)
  return true
}

export const fixSceneWinding = (root: THREE.Object3D): void =>
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) fixWinding(object.geometry as THREE.BufferGeometry)
  })
