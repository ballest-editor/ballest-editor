import { assert, describe, it } from "@effect/vitest"
import { countOf, gridWhere } from "../../../test/boxTriangles"
import { depthInside, depthOutside, distanceTo, surfaceCells } from "./distance"
import { at, cellIndex } from "./voxelize"

describe("distanceTo", () => {
  it("is the straight-line distance, in cells, to the nearest source", () => {
    const grid = gridWhere([7, 5, 6], 10, () => false)
    const sources = new Uint8Array(grid.cells.length)
    const marked = [[1, 4, 0], [6, 0, 5], [3, 2, 2]] as const
    for (const [x, y, z] of marked) sources[cellIndex(grid, x, y, z)] = 1
    const distance = distanceTo(grid, sources)
    for (let z = 0; z < 6; z++) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) {
          const nearest = Math.min(...marked.map(([sx, sy, sz]) => Math.hypot(x - sx, y - sy, z - sz)))
          assert.closeTo(at(distance, cellIndex(grid, x, y, z)), nearest, 1e-6, `${x} ${y} ${z}`)
        }
      }
    }
  })
})

describe("depthInside and depthOutside", () => {
  // A block of 9 cells a side inside an empty border one cell wide.
  const grid = gridWhere([11, 11, 11], 10, (x, y, z) => Math.min(x, y, z) >= 1 && Math.max(x, y, z) <= 9)

  it("measures a solid cell's depth to the nearest empty cell, and 0 outside", () => {
    const depth = depthInside(grid)
    assert.strictEqual(at(depth, cellIndex(grid, 5, 5, 5)), 5)
    assert.strictEqual(at(depth, cellIndex(grid, 1, 5, 5)), 1)
    assert.strictEqual(at(depth, cellIndex(grid, 0, 5, 5)), 0)
  })

  it("measures an empty cell's distance to the nearest solid cell, and 0 inside", () => {
    const depth = depthOutside(grid)
    assert.strictEqual(at(depth, cellIndex(grid, 0, 5, 5)), 1)
    assert.closeTo(at(depth, cellIndex(grid, 0, 0, 0)), Math.sqrt(3), 1e-6)
    assert.strictEqual(at(depth, cellIndex(grid, 5, 5, 5)), 0)
  })
})

describe("surfaceCells", () => {
  it("keeps the solid cells with an empty neighbour", () => {
    const grid = gridWhere([5, 5, 5], 10, (x, y, z) => Math.min(x, y, z) >= 1 && Math.max(x, y, z) <= 3)
    const shows = surfaceCells(grid, grid.cells)
    assert.strictEqual(countOf(shows), 26)
    assert.strictEqual(at(shows, cellIndex(grid, 2, 2, 2)), 0)
    assert.strictEqual(at(shows, cellIndex(grid, 0, 2, 2)), 0)
  })

  it("counts the grid's edge as empty", () => {
    const grid = gridWhere([3, 3, 3], 10, () => true)
    assert.strictEqual(countOf(surfaceCells(grid, grid.cells)), 26)
  })
})
