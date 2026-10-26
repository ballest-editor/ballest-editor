/**
 * Selection box as an oriented box: the item's bounds in its OWN local frame (geometry
 * boxes, cached per geometry by three.js, mapped through each mesh's matrix relative to
 * the item), drawn by a Box3Helper parented to the item so it inherits the item's world
 * transform. Rotating an item never changes its local bounds, so the box turns with it
 * instead of growing like a world-space AABB would.
 */
import * as THREE from "three"

const inverse = new THREE.Matrix4()
const relative = new THREE.Matrix4()

/** Bounds of everything under `item`, in `item`'s local space. Helpers (lines) are skipped. */
export const localBounds = (item: THREE.Object3D, into = new THREE.Box3()): THREE.Box3 => {
  into.makeEmpty()
  item.updateMatrixWorld(true)
  inverse.copy(item.matrixWorld).invert()
  item.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry as THREE.BufferGeometry
    if (geometry.boundingBox === null) geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (box === null || box.isEmpty()) return
    relative.multiplyMatrices(inverse, object.matrixWorld)
    into.union(box.clone().applyMatrix4(relative))
  })
  return into
}

/** The eight corners of a local box, in world space through `item`'s world matrix. */
export const obbCorners = (item: THREE.Object3D, box: THREE.Box3): Array<THREE.Vector3> => {
  const corners: Array<THREE.Vector3> = []
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(item.matrixWorld))
    }
  }
  return corners
}

/** An orange box helper for `item`'s local bounds; never raycast (selection must hit geometry). */
export const makeSelectionHelper = (): THREE.Box3Helper => {
  const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color("#ffb020"))
  helper.raycast = () => {}
  helper.userData["selectionHelper"] = true
  const material = helper.material as THREE.LineBasicMaterial
  material.toneMapped = false
  return helper
}

/** Recomputes the helper's box from `item` (the helper itself is ignored: it's not a Mesh). */
export const updateSelectionHelper = (helper: THREE.Box3Helper, item: THREE.Object3D): void => {
  localBounds(item, helper.box)
  helper.visible = !helper.box.isEmpty()
}
