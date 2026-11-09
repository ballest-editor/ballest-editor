import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { GroupBox } from "./groupBox"

/** A box in the game's frame around the origin, 5 cm out each way, moved along x. */
const boxAt = (x = 0) => ({ min: { x: x - 5, y: -5, z: -5 }, max: { x: x + 5, y: 5, z: 5 } })

const camera = new THREE.PerspectiveCamera(60)
camera.position.set(0, 0, 1000)

describe("GroupBox", () => {
  it("hides with nothing to go round", () => {
    const box = new GroupBox()
    box.update(undefined, camera, 800)
    assert.isFalse(box.visible)
  })

  it("draws 12 edges at the bounds of the items, each corner to a neighbour", () => {
    const box = new GroupBox()
    box.update(boxAt(), camera, 800)
    assert.isTrue(box.visible)
    const { instanceStart: from, instanceEnd: to } = box.geometry.attributes
    assert.strictEqual(from?.count, 12)
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [5, 5, 5])
    for (let i = 0; i < 12; i++) {
      const differ = [
        from?.getX(i) !== to?.getX(i),
        from?.getY(i) !== to?.getY(i),
        from?.getZ(i) !== to?.getZ(i)
      ]
      assert.strictEqual(differ.filter(Boolean).length, 1)
    }
  })

  it("turns the game's frame into the scene's", () => {
    const box = new GroupBox()
    box.update({ min: { x: 0, y: 100, z: 200 }, max: { x: 10, y: 110, z: 220 } }, camera, 800)
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.min.toArray(), [0, 200, 100])
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [10, 220, 110])
  })

  it("follows its items, and measures its dashes along each edge", () => {
    const box = new GroupBox()
    box.update(boxAt(), camera, 800)
    box.update(boxAt(50), camera, 800)
    box.geometry.computeBoundingBox()
    assert.strictEqual(box.geometry.boundingBox?.max.x, 55)
    const { instanceDistanceStart: from, instanceDistanceEnd: to } = box.geometry.attributes
    assert.strictEqual(from?.getX(0), 0)
    assert.strictEqual(to?.getX(0), 10)
  })

  it("keeps its dashes the same on screen as the camera backs off", () => {
    const box = new GroupBox()
    box.update(boxAt(), camera, 800)
    const near = box.material.dashScale
    const far = camera.clone()
    far.position.z = 2000
    box.update(boxAt(), far, 800)
    assert.closeTo(box.material.dashScale, near / 2, 1e-9)
  })

  it("quietens for the entered group", () => {
    const box = new GroupBox()
    box.setLook("#ff0000", true)
    assert.isBelow(box.material.opacity, 1)
    assert.isBelow(box.material.linewidth, 2)
    box.setLook("#ff0000", false)
    assert.strictEqual(box.material.opacity, 1)
    assert.strictEqual(box.material.linewidth, 2)
    assert.strictEqual(box.material.color.getHexString(), "ff0000")
  })
})
