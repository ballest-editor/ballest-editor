import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { GroupBox, meshBoundsOf } from "./groupBox"

const cube = (x: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10))
  mesh.position.x = x
  return mesh
}

const item = (...children: ReadonlyArray<THREE.Object3D>) => new THREE.Group().add(...children)

const camera = new THREE.PerspectiveCamera(60)
camera.position.set(0, 0, 1000)

describe("meshBoundsOf", () => {
  it("takes in every mesh, wherever its item is", () => {
    const moved = item(cube(0))
    moved.position.y = 100
    const { min, max } = meshBoundsOf([item(cube(0)), moved], new THREE.Box3())
    assert.deepStrictEqual(min.toArray(), [-5, -5, -5])
    assert.deepStrictEqual(max.toArray(), [5, 105, 5])
  })

  it("leaves out what isn't shown, and a laser's beam", () => {
    const hidden = cube(500)
    hidden.visible = false
    const beam = new THREE.Group().add(cube(9000))
    beam.userData["beam"] = true
    const bounds = meshBoundsOf([item(cube(0), hidden, beam)], new THREE.Box3())
    assert.strictEqual(bounds.max.x, 5)
  })

  it("is empty before a mesh has loaded", () => {
    assert.isTrue(meshBoundsOf([new THREE.Group()], new THREE.Box3()).isEmpty())
  })
})

describe("GroupBox", () => {
  it("hides with nothing to go round", () => {
    const box = new GroupBox()
    box.update([], camera, 800)
    assert.isFalse(box.visible)
  })

  it("draws 12 edges just outside the items, each corner to a neighbour", () => {
    const box = new GroupBox()
    box.update([item(cube(0))], camera, 800)
    assert.isTrue(box.visible)
    const { instanceStart: from, instanceEnd: to } = box.geometry.attributes
    assert.strictEqual(from?.count, 12)
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [13, 13, 13])
    for (let i = 0; i < 12; i++) {
      const differ = [
        from?.getX(i) !== to?.getX(i),
        from?.getY(i) !== to?.getY(i),
        from?.getZ(i) !== to?.getZ(i)
      ]
      assert.strictEqual(differ.filter(Boolean).length, 1)
    }
  })

  it("follows its items, and measures its dashes along each edge", () => {
    const box = new GroupBox()
    const moving = item(cube(0))
    box.update([moving], camera, 800)
    moving.position.x = 50
    box.update([moving], camera, 800)
    box.geometry.computeBoundingBox()
    assert.strictEqual(box.geometry.boundingBox?.max.x, 63)
    const { instanceDistanceStart: from, instanceDistanceEnd: to } = box.geometry.attributes
    assert.strictEqual(from?.getX(0), 0)
    assert.strictEqual(to?.getX(0), 26)
  })

  it("keeps its dashes the same on screen as the camera backs off", () => {
    const box = new GroupBox()
    const objects = [item(cube(0))]
    box.update(objects, camera, 800)
    const near = box.material.dashScale
    const far = camera.clone()
    far.position.z = 2000
    box.update(objects, far, 800)
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
