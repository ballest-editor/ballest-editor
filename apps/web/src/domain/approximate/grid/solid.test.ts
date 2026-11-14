import { assert, describe, it } from "@effect/vitest"
import { countOf, gridWhere } from "../../../test/boxTriangles"
import { closedGrid, fillSealed, PlateSolid } from "./solid"
import { at, cellIndex } from "./voxelize"

const within = (v: number, from: number, to: number) => v >= from && v < to

describe("fillSealed", () => {
  /** A hollow box 7 cells a side with walls one cell thick, and a hole through its top when `open`. */
  const shell = (open: boolean) =>
    gridWhere([9, 9, 9], 10, (x, y, z) => {
      const inBox = [x, y, z].every((v) => within(v, 1, 8)), inHollow = [x, y, z].every((v) => within(v, 2, 7))
      return inBox && !inHollow && !(open && x === 4 && y === 4 && z === 7)
    })

  it("fills a hollow nothing outside reaches, in place", () => {
    const grid = shell(false)
    const filled = fillSealed(grid, grid.cells)
    assert.strictEqual(filled, grid.cells)
    assert.strictEqual(countOf(filled), 7 ** 3)
  })

  it("leaves a hollow open to the outside", () => {
    const grid = shell(true)
    assert.strictEqual(countOf(fillSealed(grid, grid.cells.slice())), countOf(grid.cells))
  })
})

describe("PlateSolid", () => {
  // A slab 10 cells square and 4 thick, from 20 to 120 cm in x and y and 30 to 70 cm in z, hollow in the middle.
  const slab = gridWhere(
    [14, 14, 10],
    10,
    (x, y, z) => within(x, 2, 12) && within(y, 2, 12) && within(z, 3, 7) && !(x === 7 && y === 7 && z === 5)
  )
  const solid = new PlateSolid(slab)

  it("fills the sealed hollow", () => {
    assert.strictEqual(at(solid.grid.cells, cellIndex(slab, 7, 7, 5)), 1)
    assert.strictEqual(at(slab.cells, cellIndex(slab, 7, 7, 5)), 0)
    assert.strictEqual(solid.deepest, 2)
  })

  it("measures how far outside its cells a point is, in cm", () => {
    assert.strictEqual(solid.outside({ x: 70, y: 70, z: 50 }), 0)
    assert.strictEqual(solid.outside({ x: 70, y: 70, z: 69 }), 0)
    assert.closeTo(solid.outside({ x: 70, y: 70, z: 85 }), 15, 1e-4)
    assert.closeTo(solid.outside({ x: 0, y: 70, z: 50 }), 20, 1e-4)
    // Past the grid, the distance goes on growing.
    assert.closeTo(solid.outside({ x: 70, y: 70, z: 170 }), 100, 1e-4)
  })

  it("reads the thickness along a normal from either side, and from just outside the surface", () => {
    assert.closeTo(solid.thickness({ x: 70, y: 70, z: 70 }, { x: 0, y: 0, z: -1 }), 40, 5)
    assert.closeTo(solid.thickness({ x: 70, y: 70, z: 30 }, { x: 0, y: 0, z: 1 }), 40, 5)
    assert.closeTo(solid.thickness({ x: 70, y: 70, z: 78 }, { x: 0, y: 0, z: -1 }), 40, 5)
  })

  it("calls a place with nothing inward one cell thick", () => {
    assert.strictEqual(solid.thickness({ x: 70, y: 70, z: 70 }, { x: 0, y: 0, z: 1 }), 10)
  })
})

describe("closedGrid", () => {
  // Two blocks 8 cells square and 6 tall, a gap 2 cells wide between them.
  const blocks = gridWhere(
    [16, 12, 10],
    10,
    (x, y, z) => (within(x, 2, 7) || within(x, 9, 14)) && within(y, 2, 10) && within(z, 2, 8)
  )
  const inGap = cellIndex(blocks, 7, 6, 5)

  it("fills a gap narrower than twice the radius and leaves everything else as it was", () => {
    const closed = closedGrid(blocks, 2)
    assert.strictEqual(at(closed.cells, inGap), 1)
    assert.deepStrictEqual(closed.n, blocks.n)
    for (let i = 0; i < blocks.cells.length; i++) {
      const x = i % 16, y = Math.floor(i / 16) % 12, z = Math.floor(i / (16 * 12))
      const inHull = within(x, 2, 14) && within(y, 2, 10) && within(z, 2, 8)
      if (!inHull) assert.strictEqual(at(closed.cells, i), 0, `${x} ${y} ${z}`)
      if (at(blocks.cells, i) === 1) assert.strictEqual(at(closed.cells, i), 1, `${x} ${y} ${z}`)
    }
  })

  it("leaves a gap wider than twice the radius open", () => {
    assert.deepStrictEqual(closedGrid(blocks, 0.5).cells, blocks.cells)
  })
})
