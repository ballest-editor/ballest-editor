import { assert, describe, it } from "@effect/vitest"
import { upright } from "../../../test/placement"
import { forEachCellIn, type GridShape } from "../grid/raster"
import { at, gridOver, trianglesBox, type VoxelGrid, voxelize } from "../grid/voxelize"
import { trianglesOfPlacement } from "../look/views"
import { DEFAULT_SETTINGS } from "../settings"
import { IDENTITY_QUAT, type ShapeKind } from "../shapes"
import { climbShape, greedyOrder, polish } from "./greedy"

/** A grid, 24 cells along its longest side, of one catalog shape 2000 cm wide and deep and 1200 cm tall. */
const gridOf = (kind: ShapeKind): VoxelGrid => {
  const triangles = trianglesOfPlacement(upright(kind, [0, 0, 0], [1000, 1000, 600]))
  return voxelize(triangles, gridOver(trianglesBox(triangles), 24), { surface: true })
}
const ball = gridOf("sphere"), block = gridOf("box")

const options = { ...DEFAULT_SETTINGS.pieces, kinds: ["box", "sphere", "cylinder", "cone"] as const }

const cellsOf = (grid: VoxelGrid, shape: GridShape): Array<number> => {
  const cells: Array<number> = []
  forEachCellIn(grid, shape, (i) => cells.push(i))
  return cells
}

/** The share of the model's cells `shapes` cover, and how many empty cells they cover. */
const coverOf = (grid: VoxelGrid, shapes: ReadonlyArray<GridShape>) => {
  const covered = new Set(shapes.flatMap((shape) => cellsOf(grid, shape)))
  const solid = grid.cells.reduce((sum, cell) => sum + cell, 0)
  const inside = [...covered].filter((i) => at(grid.cells, i) === 1).length
  return { share: inside / solid, spilled: covered.size - inside }
}

describe("greedyOrder", () => {
  it("covers a block with one cube and stops when nothing is left to add", () => {
    const order = greedyOrder(block, { ...options, kinds: ["box"], rotation: false, budget: 20 })
    assert.isBelow(order.length, 20)
    assert.strictEqual(order[0]?.kind, "box")
    assert.isAbove(coverOf(block, order.slice(0, 1)).share, 0.9)
  })

  it("picks the shape the model is", () => {
    const [first] = greedyOrder(ball, { ...options, budget: 1 })
    assert.strictEqual(first?.kind, "sphere")
    assert.isAbove(coverOf(ball, first === undefined ? [] : [first]).share, 0.8)
  })

  it("places a smaller budget's pieces first in a larger budget's order", () => {
    const few = greedyOrder(ball, { ...options, kinds: ["box"], budget: 4 })
    const many = greedyOrder(ball, { ...options, kinds: ["box"], budget: 9 })
    assert.strictEqual(few.length, 4)
    assert.deepStrictEqual(many.slice(0, 4), few)
  })

  it("repeats with the same seed and differs with another", () => {
    const run = (seed: number) => greedyOrder(ball, { ...options, kinds: ["box"], seed, budget: 3 })
    assert.deepStrictEqual(run(1), run(1))
    assert.notDeepEqual(run(2), run(1))
  })

  it("keeps every piece upright with rotation off, and no thinner than the least size", () => {
    const order = greedyOrder(ball, { ...options, kinds: ["box", "cylinder"], rotation: false, minSize: 4, budget: 6 })
    for (const { h, q } of order) {
      assert.isTrue([q.x, q.y, q.z].filter((part) => Math.abs(part) > 1e-9).length <= 1)
      assert.isAtLeast(Math.min(...h), 2)
    }
  })

  it("places cubes when no shape is enabled", () => {
    const order = greedyOrder(block, { ...options, kinds: [], budget: 2 })
    assert.deepStrictEqual(order.map((shape) => shape.kind), ["box", "box"].slice(0, order.length))
    assert.isAbove(order.length, 0)
  })

  it("reports the pieces so far", () => {
    const seen: Array<number> = []
    const now = Date.now
    // A clock that jumps a second a read, so that every piece is due a report.
    let time = 0
    Date.now = () => time += 1000
    try {
      greedyOrder(ball, { ...options, kinds: ["box"], budget: 3, onProgress: (shapes) => seen.push(shapes.length) })
    } finally {
      Date.now = now
    }
    assert.deepStrictEqual(seen, [1, 2, 3])
  })
})

describe("polish", () => {
  const noSweeps = { ...options, sweeps: 0 }

  it("prunes a piece that covers nothing of its own", () => {
    const [first] = greedyOrder(block, { ...options, kinds: ["box"], budget: 1 })
    if (first === undefined) return assert.fail("no piece")
    const speck: GridShape = { kind: "box", c: [-50, -50, -50], h: [1, 1, 1], q: IDENTITY_QUAT }
    assert.deepStrictEqual(polish(block, [first, speck], noSweeps), [first])
    // Of two pieces on the same cells, the later one is all that covers them once the first is gone.
    assert.strictEqual(polish(block, [first, first], noSweeps).length, 1)
  })

  it("scores no worse after its sweeps, with no more pieces", () => {
    const order = greedyOrder(ball, { ...options, budget: 12 })
    const before = coverOf(ball, polish(ball, order, noSweeps))
    const seen: Array<number> = []
    const swept = polish(ball, order, { ...options, sweeps: 2, onProgress: (shapes) => seen.push(shapes.length) })
    const after = coverOf(ball, swept)
    assert.isAtMost(swept.length, order.length)
    assert.strictEqual(seen.length, 2)
    assert.strictEqual(seen[1], swept.length)
    // A cell of the model is worth 1 and an empty one at least nothing: the sweeps trade the one for the other.
    const penalty = options.outsidePenalty
    assert.isAtLeast(after.share * 1000 - penalty * after.spilled, before.share * 1000 - penalty * before.spilled - 50)
  })

  it("covers no empty cell with no spill", () => {
    const noSpill = { ...options, noSpill: true, sweeps: 1 }
    const pieces = polish(ball, greedyOrder(ball, { ...noSpill, budget: 12 }), noSpill)
    assert.isAbove(pieces.length, 3)
    assert.strictEqual(coverOf(ball, pieces).spilled, 0)
  })
})

describe("climbShape", () => {
  const start: GridShape = { kind: "box", c: [0, 0, 0], h: [2, 2, 2], q: IDENTITY_QUAT }
  /** Higher the nearer a shape is to 4 by 3 by 2 half extents about (5, 6, 7). */
  const value = ({ c, h }: GridShape) =>
    -Math.hypot(c[0] - 5, c[1] - 6, c[2] - 7) - Math.hypot(h[0] - 4, h[1] - 3, h[2] - 2)
  const limits = { minHalf: 0.5, maxHalf: 30 }

  it("climbs toward what the measure asks for, and gives the value it reached", () => {
    const found = climbShape(start, value, { ...limits, steps: 3000, seed: 1 })
    assert.strictEqual(found.value, value(found.shape))
    assert.isAbove(found.value, -0.5)
    assert.isBelow(value(start), -10)
  })

  it("stays where it is when no change scores better, and within its limits when one does", () => {
    assert.deepStrictEqual(climbShape(start, () => 0, { ...limits, steps: 50, seed: 1 }), { shape: start, value: 0 })
    const grown = climbShape(start, ({ h }) => h[0] + h[1] + h[2], { minHalf: 0.5, maxHalf: 3, steps: 2000, seed: 1 })
    assert.closeTo(grown.value, 9, 1e-9)
  })
})
