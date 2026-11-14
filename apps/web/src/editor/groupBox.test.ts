import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import type { Quat4 } from "../domain/coords"
import { IDENTITY_QUAT, ORIGIN, rotatorToQuat } from "../domain/ueMath"
import type { GroupFrame } from "../domain/units"
import { GROUP_DASH, GroupBox } from "./groupBox"
import { DASH, LINE_WIDTH } from "./screenLines"

/** A frame in the game's axes from the origin, `x` by `y` by `z` cm, turned by `rotation`. */
const boxOf = (x: number, y: number, z: number, at = 0, rotation: Quat4 = IDENTITY_QUAT): GroupFrame => ({
  origin: { x: at + x / 2, y: y / 2, z: z / 2 },
  rotation,
  halfExtents: { x: x / 2, y: y / 2, z: z / 2 }
})

/** Each drawn segment's run along the world axes it moves on, and its ends. */
const edgesOf = (box: GroupBox) => {
  const { instanceStart: from, instanceEnd: to } = box.geometry.attributes
  return Array.from({ length: box.geometry.instanceCount }, (_, i) => {
    const a = [from?.getX(i) ?? 0, from?.getY(i) ?? 0, from?.getZ(i) ?? 0]
    const b = [to?.getX(i) ?? 0, to?.getY(i) ?? 0, to?.getZ(i) ?? 0]
    return { run: a.map((v, k) => Math.abs(v - (b[k] ?? 0))).filter((d) => d > 1e-9), a, b }
  })
}

describe("GroupBox", () => {
  it("hides with nothing to go round", () => {
    const box = new GroupBox()
    box.update(undefined)
    assert.isFalse(box.visible)
  })

  it("draws the group's box whole: its 12 edges, corner to corner, with nothing added round it", () => {
    const box = new GroupBox()
    box.update(boxOf(10, 20, 30))
    assert.isTrue(box.visible)
    const edges = edgesOf(box)
    assert.lengthOf(edges, 12)
    const runs = edges.map(({ run }) => run).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
    assert.deepStrictEqual(runs, [[10], [10], [10], [10], [20], [20], [20], [20], [30], [30], [30], [30]])
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.min.toArray(), [0, 0, 0])
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [10, 30, 20])
  })

  it("turns the game's frame into the scene's", () => {
    const box = new GroupBox()
    box.update({ origin: { x: 5, y: 105, z: 210 }, rotation: IDENTITY_QUAT, halfExtents: { x: 5, y: 5, z: 10 } })
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.min.toArray(), [0, 200, 100])
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [10, 220, 110])
  })

  it("turns with the group: its edges run along the group's axes, not the world's", () => {
    const box = new GroupBox()
    // 200 long along the group's x, turned 90 yaw: it runs along the world's y, the scene's z
    box.update({
      origin: ORIGIN,
      rotation: rotatorToQuat({ roll: 0, pitch: 0, yaw: 90 }),
      halfExtents: { x: 100, y: 10, z: 10 }
    })
    box.geometry.computeBoundingBox()
    const size = box.geometry.boundingBox?.getSize(new THREE.Vector3()).toArray().map((v) => Math.round(v))
    assert.deepStrictEqual(size, [20, 20, 200])
    // turned 45: no edge lies along a world axis any more
    box.update({
      origin: ORIGIN,
      rotation: rotatorToQuat({ roll: 0, pitch: 0, yaw: 45 }),
      halfExtents: { x: 100, y: 10, z: 10 }
    })
    const along = edgesOf(box).filter(({ run }) => run.length === 1)
    assert.lengthOf(along, 4, "only the upright edges keep to one world axis")
  })

  it("follows its items", () => {
    const box = new GroupBox()
    box.update(boxOf(10, 10, 10))
    box.update(boxOf(10, 10, 10, 50))
    box.geometry.computeBoundingBox()
    assert.strictEqual(box.geometry.boundingBox?.max.x, 60)
  })

  it("is dashed in a dash of its own, shorter than the hidden one", () => {
    const box = new GroupBox()
    assert.strictEqual(box.material.customProgramCacheKey(), "group-box")
    assert.isBelow(GROUP_DASH.on + GROUP_DASH.off, DASH.on + DASH.off)
  })

  it("quietens for the entered group", () => {
    const box = new GroupBox()
    box.setLook("#ffffff", true)
    assert.isBelow(box.material.opacity, 1)
    assert.strictEqual(box.material.linewidth, LINE_WIDTH.light)
    box.setLook("#ff0000", false)
    assert.strictEqual(box.material.opacity, 1)
    assert.strictEqual(box.material.linewidth, LINE_WIDTH.outline)
    assert.strictEqual(box.material.color.getHexString(), "ff0000")
  })
})
