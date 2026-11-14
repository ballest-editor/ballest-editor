import { assert, describe, it } from "@effect/vitest"
import { gridWhere } from "../../../test/boxTriangles"
import { IDENTITY_QUAT } from "../shapes"
import { mergeBoxes, surfaceCubes } from "./boxMerge"
import { forEachCellIn, toGridShape } from "./raster"
import { at, type VoxelGrid } from "./voxelize"

const within = (v: number, from: number, to: number) => v >= from && v < to

/** How many pieces cover each cell. */
const coverOf = (grid: VoxelGrid, pieces: ReturnType<typeof mergeBoxes>) => {
  const cover = new Uint8Array(grid.cells.length)
  for (const piece of pieces) {
    forEachCellIn(grid, toGridShape(grid, piece), (i) => {
      cover[i] = at(cover, i) + 1
    })
  }
  return cover
}

describe("mergeBoxes", () => {
  it("covers a block with one cube", () => {
    const grid = gridWhere([8, 7, 6], 10, (x, y, z) => within(x, 1, 7) && within(y, 2, 5) && within(z, 1, 3))
    assert.deepStrictEqual(mergeBoxes(grid), [{
      kind: "box",
      center: { x: 40, y: 35, z: 20 },
      half: { x: 30, y: 15, z: 10 },
      rotation: IDENTITY_QUAT
    }])
  })

  it("covers an L with two cubes, the larger first, and no empty cell", () => {
    // A bar 8 by 2 with a leg 2 by 5 on one end, 3 cells deep: its deepest cells are where the two meet.
    const grid = gridWhere(
      [10, 9, 5],
      10,
      (x, y, z) => within(z, 1, 4) && ((within(x, 1, 9) && within(y, 1, 3)) || (within(x, 1, 3) && within(y, 1, 8)))
    )
    const boxes = mergeBoxes(grid)
    assert.lengthOf(boxes, 2)
    assert.deepStrictEqual(boxes[0]?.half, { x: 40, y: 10, z: 15 })
    assert.deepStrictEqual(boxes[1]?.half, { x: 10, y: 35, z: 15 })
    const cover = coverOf(grid, boxes)
    for (let i = 0; i < cover.length; i++) assert.strictEqual(at(cover, i) > 0, at(grid.cells, i) === 1)
  })

  it("makes nothing of an empty grid", () => {
    assert.deepStrictEqual(mergeBoxes(gridWhere([3, 3, 3], 10, () => false)), [])
  })
})

describe("surfaceCubes", () => {
  it("makes one cube a cell that shows, each cell's size", () => {
    const grid = gridWhere([5, 5, 5], 10, (x, y, z) => Math.min(x, y, z) >= 1 && Math.max(x, y, z) <= 3)
    const cubes = surfaceCubes(grid)
    assert.lengthOf(cubes, 26)
    assert.deepStrictEqual(cubes[0], {
      kind: "box",
      center: { x: 15, y: 15, z: 15 },
      half: { x: 5, y: 5, z: 5 },
      rotation: IDENTITY_QUAT
    })
    const cover = coverOf(grid, cubes)
    for (let i = 0; i < cover.length; i++) assert.isAtMost(at(cover, i), at(grid.cells, i))
  })
})
