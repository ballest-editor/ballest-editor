import { assert, describe, it } from "@effect/vitest"
import { gridWhere } from "../../../test/boxTriangles"
import { forEachCellIn, toGridShape } from "../grid/raster"
import type { VoxelGrid } from "../grid/voxelize"
import { IDENTITY_QUAT, type Placement } from "../shapes"
import { rectangularPlates } from "./slabs"

/** A grid of `n` cells of 100 cm, away from the origin, solid where `solid` says so. */
const gridOf = (
  n: readonly [number, number, number],
  solid: (x: number, y: number, z: number) => boolean
): VoxelGrid => ({
  ...gridWhere(n, 100, solid),
  origin: { x: -200, y: 300, z: -100 }
})

/** The axis after each. */
const NEXT = [1, 2, 0] as const

/** The cells `pieces` cover between them. */
const coveredBy = (grid: VoxelGrid, pieces: ReadonlyArray<Placement>): Uint8Array => {
  const covered = new Uint8Array(grid.cells.length)
  for (const piece of pieces) {
    forEachCellIn(grid, toGridShape(grid, piece), (i) => {
      covered[i] = 1
    })
  }
  return covered
}

describe("rectangularPlates", () => {
  it("runs each plate through every layer the model fills, over plates already there", () => {
    // Two layers of 8 by 6 cells, and a 3 by 6 strip on top of them.
    const grid = gridOf([8, 6, 3], (x, _, z) => z < 2 || x < 3)
    assert.deepStrictEqual(rectangularPlates(grid), [
      { kind: "box", center: { x: 200, y: 600, z: 0 }, half: { x: 400, y: 300, z: 100 }, rotation: IDENTITY_QUAT },
      { kind: "box", center: { x: -50, y: 600, z: 50 }, half: { x: 150, y: 300, z: 150 }, rotation: IDENTITY_QUAT }
    ])
  })

  it("cuts layers across the grid's shortest side and covers the model's cells and no others", () => {
    for (const across of [0, 1, 2] as const) {
      const n: [number, number, number] = [6, 6, 6]
      n[across] = 5
      // Along the short side: two full layers of 4 by 4 cells, then a 2 by 2 corner of a third.
      const grid = gridOf(n, (...cell) => {
        const layer = cell[across], a = cell[NEXT[across]], b = cell[NEXT[NEXT[across]]]
        return a >= 1 && a <= 4 && b >= 1 && b <= 4 && (layer >= 1 && layer <= 2 || layer === 3 && a < 3 && b < 3)
      })
      const pieces = rectangularPlates(grid)
      assert.deepStrictEqual(coveredBy(grid, pieces), grid.cells)
      assert.strictEqual(pieces.length, 2)
      assert.deepStrictEqual(pieces.map((piece) => piece.half[(["x", "y", "z"] as const)[across]]), [100, 150])
    }
  })

  it("has no plates for an empty grid", () => {
    assert.deepStrictEqual(rectangularPlates(gridOf([4, 4, 2], () => false)), [])
  })
})
