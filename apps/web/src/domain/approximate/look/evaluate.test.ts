import { assert, describe, it } from "@effect/vitest"
import { boxTriangles } from "../../../test/boxTriangles"
import { IDENTITY_QUAT, type Placement } from "../shapes"
import { evaluate, referenceOf } from "./evaluate"

const block = boxTriangles([0, 0, 0], [960, 480, 480])
const reference = referenceOf(block, false)

const cube = (min: readonly [number, number, number], max: readonly [number, number, number]): Placement => ({
  kind: "box",
  center: { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 },
  half: { x: (max[0] - min[0]) / 2, y: (max[1] - min[1]) / 2, z: (max[2] - min[2]) / 2 },
  rotation: IDENTITY_QUAT
})

describe("referenceOf", () => {
  it("reads the model into 96 cells along its longest side, and draws its views", () => {
    assert.deepStrictEqual(reference.grid.n, [98, 50, 50])
    assert.strictEqual(reference.grid.voxel, 10)
    assert.lengthOf(reference.views.pictures, 12)
  })
})

describe("evaluate", () => {
  it("scores the model's own shape as a match", () => {
    const metrics = evaluate(reference, [cube([0, 0, 0], [960, 480, 480])])
    assert.strictEqual(metrics.iou, 1)
    assert.strictEqual(metrics.coverage, 1)
    assert.strictEqual(metrics.spill, 0)
    assert.deepStrictEqual(metrics.missed, { mean: 0, p95: 0 })
    assert.deepStrictEqual(metrics.bulged, { mean: 0, p95: 0 })
    assert.strictEqual(metrics.items, 1)
    assert.deepStrictEqual(metrics.byKind, {
      box: 1,
      sphere: 0,
      cylinder: 0,
      cone: 0,
      pyramid: 0,
      hemisphere: 0,
      capsule: 0
    })
    assert.isAbove(metrics.silhouette, 0.97)
    assert.isBelow(metrics.normalAngle, 1)
  })

  it("measures what half the model misses, and that it bulges nowhere", () => {
    const metrics = evaluate(reference, [cube([0, 0, 0], [480, 480, 480])])
    assert.closeTo(metrics.coverage, 0.5, 1e-9)
    assert.closeTo(metrics.iou, 0.5, 1e-9)
    assert.strictEqual(metrics.spill, 0)
    // The model's far end is 480 cm from the piece; the piece's cut face is inside the model, at most half its
    // width from the model's surface.
    assert.closeTo(metrics.missed.p95, 480, 30)
    assert.isAtMost(metrics.bulged.p95, 240)
    assert.isBelow(metrics.bulged.mean, metrics.missed.mean)
  })

  it("measures what a piece spills past the model", () => {
    // A step: the block's lower half, and a post over half of it. Its box is a quarter empty.
    const step = Float32Array.of(
      ...boxTriangles([0, 0, 0], [960, 480, 240]),
      ...boxTriangles([0, 0, 240], [480, 480, 480])
    )
    const metrics = evaluate(referenceOf(step, false), [cube([0, 0, 0], [960, 480, 480])])
    assert.strictEqual(metrics.coverage, 1)
    assert.closeTo(metrics.spill, 0.25, 1e-9)
    assert.closeTo(metrics.iou, 0.75, 1e-9)
    // The piece's far top edge is 240 cm from the step's faces.
    assert.closeTo(metrics.bulged.p95, 240, 30)
    assert.isAtMost(metrics.missed.p95, 240)
  })

  it("scores a sealed shell of pieces as the solid it looks like", () => {
    const shell = [
      cube([0, 0, 0], [960, 480, 40]),
      cube([0, 0, 440], [960, 480, 480]),
      cube([0, 0, 0], [960, 40, 480]),
      cube([0, 440, 0], [960, 480, 480]),
      cube([0, 0, 0], [40, 480, 480]),
      cube([920, 0, 0], [960, 480, 480])
    ]
    const metrics = evaluate(reference, shell)
    assert.strictEqual(metrics.iou, 1)
    assert.strictEqual(metrics.byKind.box, 6)
    // With one side left off the inside is open, and only the walls count.
    assert.isBelow(evaluate(reference, shell.slice(0, 5)).iou, 0.5)
  })

  it("has no distances to give with no pieces", () => {
    const metrics = evaluate(reference, [])
    assert.strictEqual(metrics.iou, 0)
    assert.strictEqual(metrics.coverage, 0)
    assert.strictEqual(metrics.spill, 0)
    assert.deepStrictEqual(metrics.missed, { mean: Infinity, p95: Infinity })
    assert.deepStrictEqual(metrics.bulged, { mean: Infinity, p95: Infinity })
    assert.strictEqual(metrics.items, 0)
  })
})
