import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { UE_TO_THREE_MATRIX, ueToScene } from "../domain/coords"
import { localBounds, makeSelectionHelper, obbCorners, updateSelectionHelper } from "./selectionBounds"

/** An item group like ItemObject builds: item transform -> mirror root -> UE-space mesh. */
const makeItem = (rotationDeg: number) => {
  const half = (rotationDeg * Math.PI) / 360
  const t = ueToScene({
    translation: { x: 100, y: -50, z: 20 },
    rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }, // about game Z
    scale3D: { x: 1, y: 2, z: 0.5 }
  })
  const item = new THREE.Group()
  item.position.set(...t.position)
  item.quaternion.set(...t.quaternion)
  item.scale.set(...t.scale)
  const mirror = new THREE.Group()
  mirror.matrixAutoUpdate = false
  mirror.matrix.set(...UE_TO_THREE_MATRIX)
  // a 400 x 100 x 30 cm slab in UE local space, off-centre
  mirror.add(new THREE.Mesh(new THREE.BoxGeometry(400, 100, 30).translate(50, 0, 15)))
  item.add(mirror)
  item.updateMatrixWorld(true)
  return item
}

describe("selection bounds", () => {
  it("rotating an item 37 deg about game Z leaves its local bounds identical; the OBB rotates with it", () => {
    const flat = makeItem(0)
    const turned = makeItem(37)
    const b0 = localBounds(flat)
    const b1 = localBounds(turned)
    expect(b1.min.toArray()).toEqual(b0.min.toArray())
    expect(b1.max.toArray()).toEqual(b0.max.toArray())
    // UE local (x: -150..250, y: -50..50, z: 0..30) maps to three local (x, z, y)
    expect(b0.min.toArray().map((n) => Math.round(n))).toEqual([-150, 0, -50])
    expect(b0.max.toArray().map((n) => Math.round(n))).toEqual([250, 30, 50])

    // corners of the drawn helper == the item's world matrix applied to the local corners
    const helper = makeSelectionHelper()
    turned.add(helper)
    updateSelectionHelper(helper, turned)
    helper.updateMatrixWorld(true)
    const expected = obbCorners(turned, b1)
    const unit = [-0.5, 0.5]
    const drawn: Array<THREE.Vector3> = []
    for (const x of unit) {
      for (const y of unit) {
        for (const z of unit) drawn.push(new THREE.Vector3(x * 2, y * 2, z * 2).applyMatrix4(helper.matrixWorld))
      }
    }
    // Box3Helper draws the unit cube [-1, 1]^3 scaled by half the box size
    for (let i = 0; i < 8; i++) expect(drawn[i]!.distanceTo(expected[i]!)).toBeLessThan(1e-6)
    // and the world AABB of the turned item is bigger than the box we draw (the old bug)
    const worldAabb = new THREE.Box3().setFromObject(turned)
    const drawnSize = b1.getSize(new THREE.Vector3()).multiply(turned.scale)
    expect(worldAabb.getSize(new THREE.Vector3()).x).toBeGreaterThan(drawnSize.x * Math.cos((37 * Math.PI) / 180) - 1)
  })

  it("is not affected by the helper itself and is never raycast", () => {
    const item = makeItem(10)
    const helper = makeSelectionHelper()
    item.add(helper)
    updateSelectionHelper(helper, item)
    const before = helper.box.clone()
    updateSelectionHelper(helper, item)
    expect(helper.box.equals(before)).toBe(true)
    const hits: Array<THREE.Intersection> = []
    helper.raycast(new THREE.Raycaster(), hits)
    expect(hits).toHaveLength(0)
  })
})
