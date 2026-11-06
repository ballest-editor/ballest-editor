import { assert, describe, it } from "@effect/vitest"
import { mainBounds, topDownFraming } from "./mapThumbnails"

describe("mainBounds", () => {
  const box = (x: number, y = 0, z = 0) => [[x, y, z], [x + 10, y + 10, z + 10]] as const

  it("is every item's bounds in a small map", () => {
    assert.deepStrictEqual(mainBounds([box(0), box(5000, 20, 30)]), [[0, 0, 0], [5010, 30, 40]])
  })

  it("leaves out an item far from the others in a large one", () => {
    const track = Array.from({ length: 99 }, (_, i) => box(i * 10))
    const [min, max] = mainBounds([...track, box(100_000)])
    assert.strictEqual(min[0], 20)
    assert.isBelow(max[0], 1000)
  })

  it("keeps the height of all of them", () => {
    const track = Array.from({ length: 99 }, () => box(0))
    const [min, max] = mainBounds([...track, box(0, 900)])
    assert.deepStrictEqual([min[1], max[1]], [0, 910])
  })

  it("has something to say of no items", () => {
    assert.deepStrictEqual(mainBounds([]), [[0, 0, 0], [0, 0, 0]])
  })
})

describe("topDownFraming", () => {
  it("stands over the centre, above the top, and sees down through the box", () => {
    const { far, position } = topDownFraming([-100, 0, 300], [100, 500, 700])
    assert.deepStrictEqual(position, [0, 600, 500])
    assert.strictEqual(far, 700)
  })

  it("fits the longer side, whichever it is, and the height doesn't count", () => {
    const wide = topDownFraming([0, 0, 0], [1000, 9000, 100])
    const deep = topDownFraming([0, 0, 0], [100, 0, 1000])
    assert.strictEqual(wide.halfSide, deep.halfSide)
    assert.isAbove(wide.halfSide, 500)
    assert.isBelow(wide.halfSide, 550)
  })

  it("keeps a frame for a box with no size", () => {
    assert.isAbove(topDownFraming([5, 5, 5], [5, 5, 5]).halfSide, 0)
  })
})
