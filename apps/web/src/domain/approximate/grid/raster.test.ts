import { assert, describe, it } from "@effect/vitest"
import { gridWhere } from "../../../test/boxTriangles"
import { quatFromAxisAngle, rotateVec } from "../../ueMath"
import { IDENTITY_QUAT, type Placement } from "../shapes"
import {
  boundingCells,
  forEachCellIn,
  type GridShape,
  reachOf,
  rotationMatrix,
  toGridShape,
  toPlacement
} from "./raster"
import { cellIndex, type GridFrame } from "./voxelize"

const frame: GridFrame = { n: [12, 12, 12], origin: { x: -60, y: 20, z: 0 }, voxel: 10 }
const quarterTurn = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2)

const cellsIn = (shape: GridShape, stride?: number) => {
  const cells: Array<number> = []
  const count = forEachCellIn(frame, shape, (i) => cells.push(i), stride)
  assert.strictEqual(count, cells.length)
  return cells
}

describe("toGridShape and toPlacement", () => {
  it("turn cm into cells and back", () => {
    const placement: Placement = {
      kind: "cone",
      center: { x: -10, y: 80, z: 55 },
      half: { x: 20, y: 30, z: 45 },
      rotation: quarterTurn
    }
    const shape = toGridShape(frame, placement)
    assert.deepStrictEqual(shape, { kind: "cone", c: [5, 6, 5.5], h: [2, 3, 4.5], q: quarterTurn })
    assert.deepStrictEqual(toPlacement(frame, shape), placement)
  })
})

describe("rotationMatrix", () => {
  it("turns a vector as the quaternion does", () => {
    const q = quatFromAxisAngle({ x: 0.6, y: 0.8, z: 0 }, 0.7)
    const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotationMatrix(q)
    const turned = rotateVec(q, { x: 1, y: 2, z: 3 })
    assert.closeTo(r00 + 2 * r01 + 3 * r02, turned.x, 1e-12)
    assert.closeTo(r10 + 2 * r11 + 3 * r12, turned.y, 1e-12)
    assert.closeTo(r20 + 2 * r21 + 3 * r22, turned.z, 1e-12)
  })
})

describe("forEachCellIn", () => {
  it("visits the cells whose centres a box holds, x first, then y, then z", () => {
    const cells = cellsIn({ kind: "box", c: [5, 6.5, 7], h: [2, 1.5, 1], q: IDENTITY_QUAT })
    assert.lengthOf(cells, 4 * 3 * 2)
    assert.deepStrictEqual(
      cells.slice(0, 5),
      [3, 4, 5, 6].map((x) => cellIndex(frame, x, 5, 6)).concat(cellIndex(frame, 3, 6, 6))
    )
  })

  it("turns the shape: a quarter turn about z swaps a box's x and y", () => {
    const flat = cellsIn({ kind: "box", c: [6, 6, 6], h: [4, 1, 1], q: quarterTurn })
    assert.deepStrictEqual(
      flat.toSorted((a, b) => a - b),
      cellsIn({ kind: "box", c: [6, 6, 6], h: [1, 4, 1], q: IDENTITY_QUAT })
    )
  })

  it("stops at the grid's edge", () => {
    assert.lengthOf(cellsIn({ kind: "box", c: [0, 0, 0], h: [2, 2, 2], q: IDENTITY_QUAT }), 8)
    assert.lengthOf(cellsIn({ kind: "box", c: [40, 0, 0], h: [2, 2, 2], q: IDENTITY_QUAT }), 0)
  })

  it("keeps to the shape inside its box", () => {
    const ball = cellsIn({ kind: "sphere", c: [6, 6, 6], h: [5, 5, 5], q: IDENTITY_QUAT })
    assert.closeTo(ball.length, 4 / 3 * Math.PI * 125, 30)
    // A cone's apex is up: more of it is in the lower half of its box.
    const grid = gridWhere(frame.n, frame.voxel, () => false)
    const cone = cellsIn({ kind: "cone", c: [6, 6, 6], h: [5, 5, 5], q: IDENTITY_QUAT })
    const low = cone.filter((i) => i < cellIndex(grid, 0, 0, 6)).length
    assert.isAbove(low, 3 * (cone.length - low))
  })

  it("tries every stride'th cell along each axis for a quick estimate", () => {
    const shape: GridShape = { kind: "box", c: [6, 6, 6], h: [4, 4, 4], q: IDENTITY_QUAT }
    const all = new Set(cellsIn(shape)), some = cellsIn(shape, 2)
    assert.lengthOf(some, 4 * 4 * 4)
    assert.isTrue(some.every((i) => all.has(i)))
    // It starts mid-stride.
    assert.strictEqual(some[0], cellIndex(frame, 3, 3, 3))
  })
})

describe("reachOf", () => {
  it("is half the turned shape's bounding box", () => {
    const shape: GridShape = { kind: "box", c: [0, 0, 0], h: [4, 1, 2], q: quarterTurn }
    const [x, y, z] = reachOf(shape)
    assert.closeTo(x, 1, 1e-12)
    assert.closeTo(y, 4, 1e-12)
    assert.closeTo(z, 2, 1e-12)
    assert.closeTo(boundingCells(shape), 8 * 4 * 2, 1e-9)
    const eighth = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4)
    assert.closeTo(reachOf({ ...shape, q: eighth })[0], 5 * Math.SQRT1_2, 1e-12)
  })
})
