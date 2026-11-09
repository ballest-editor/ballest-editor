import { assert, describe, it } from "@effect/vitest"
import { BRACKET, GroupBox } from "./groupBox"
import { LINE_WIDTH } from "./screenLines"

/** A box in the game's frame from the origin, `x` by `y` by `z` cm. */
const boxOf = (x: number, y: number, z: number, at = 0) => ({
  min: { x: at, y: 0, z: 0 },
  max: { x: at + x, y, z }
})

/** Each bracket's run along its edge, and whether it leaves a corner of `box`. */
const bracketsOf = (box: GroupBox) => {
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

  it("marks the group's corners: a bracket from each corner along each of its three edges", () => {
    const box = new GroupBox()
    box.update(boxOf(10, 10, 10))
    assert.isTrue(box.visible)
    const brackets = bracketsOf(box)
    assert.lengthOf(brackets, 24)
    for (const { run } of brackets) assert.deepStrictEqual(run, [10 * BRACKET.ofEdge])
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [10, 10, 10])
  })

  it("keeps a long, flat group's brackets to its corners", () => {
    // 5400 long, 800 wide, 300 high: the middle size, 800, sets the most a bracket reaches
    const box = new GroupBox()
    box.update(boxOf(5400, 800, 300))
    const runs = bracketsOf(box).map(({ run }) => run[0] ?? 0)
    assert.closeTo(Math.max(...runs), 800 * BRACKET.ofMiddle, 1e-6)
    assert.closeTo(Math.min(...runs), 300 * BRACKET.ofEdge, 1e-6)
  })

  it("turns the game's frame into the scene's", () => {
    const box = new GroupBox()
    box.update({ min: { x: 0, y: 100, z: 200 }, max: { x: 10, y: 110, z: 220 } })
    box.geometry.computeBoundingBox()
    assert.deepStrictEqual(box.geometry.boundingBox?.min.toArray(), [0, 200, 100])
    assert.deepStrictEqual(box.geometry.boundingBox?.max.toArray(), [10, 220, 110])
  })

  it("follows its items", () => {
    const box = new GroupBox()
    box.update(boxOf(10, 10, 10))
    box.update(boxOf(10, 10, 10, 50))
    box.geometry.computeBoundingBox()
    assert.strictEqual(box.geometry.boundingBox?.max.x, 60)
  })

  it("quietens for the entered group, and is never dashed: dashes mean hidden", () => {
    const box = new GroupBox()
    box.setLook("#ffffff", true)
    assert.isBelow(box.material.opacity, 1)
    assert.strictEqual(box.material.linewidth, LINE_WIDTH.light)
    assert.isFalse(box.material.dashed)
    box.setLook("#ff0000", false)
    assert.strictEqual(box.material.opacity, 1)
    assert.strictEqual(box.material.linewidth, LINE_WIDTH.outline)
    assert.strictEqual(box.material.color.getHexString(), "ff0000")
  })
})
