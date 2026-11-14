import { assert, describe, it } from "@effect/vitest"
import { assertVec } from "../../test/vec"
import { quatFromAxisAngle, rotateVec } from "../ueMath"
import { catalogFrame, type Placement, type ShapeKind, shapeKinds, SHAPES } from "./shapes"

type Point = readonly [number, number, number]

/** Points of each shape's normalised box that are in it, and points that are not. */
const landmarks: Readonly<
  Record<ShapeKind, { readonly inside: ReadonlyArray<Point>; readonly outside: ReadonlyArray<Point> }>
> = {
  box: { inside: [[1, 1, 1], [-1, 1, -1], [0, 0, 0]], outside: [] },
  sphere: { inside: [[1, 0, 0], [0, 0, -1], [0.5, 0.5, 0.5]], outside: [[0.6, 0.6, 0.6], [1, 0, 0.1]] },
  // Round in x and y, the same at every height.
  cylinder: { inside: [[1, 0, 1], [0, -1, -1], [0.7, 0.7, 0]], outside: [[0.8, 0.8, 0], [1, 0.1, 1]] },
  // Radius 1 at the base, half that halfway up, a point at the top.
  cone: { inside: [[1, 0, -1], [0, 0.5, 0], [0, 0, 1]], outside: [[0.6, 0, 0], [0.1, 0, 1], [0.8, 0.8, -1]] },
  // A diamond base: its corners are on the axes.
  pyramid: { inside: [[1, 0, -1], [0, -1, -1], [0.5, 0.5, -1], [0, 0, 1]], outside: [[0.6, 0.6, -1], [0.5, 0.1, 0]] },
  // Flat face down at z = -1, pole at z = 1.
  hemisphere: {
    inside: [[1, 0, -1], [0, 0, 1], [0, 0.7, 0.2]],
    outside: [[1, 0, -0.9], [0.9, 0, 0.5], [0.8, 0.8, -1]]
  },
  // Straight sides over the middle half, a cap on each end.
  capsule: {
    inside: [[1, 0, 0.5], [0, 1, -0.5], [0, 0, 1], [0, 0, -1]],
    outside: [[1, 0, 0.6], [0.8, 0, 0.9], [0.8, 0.8, 0]]
  }
}

describe("SHAPES", () => {
  it("holds each shape's landmarks and nothing past them", () => {
    for (const kind of shapeKinds) {
      for (const [x, y, z] of landmarks[kind].inside) {
        assert.isTrue(SHAPES[kind].inside(x, y, z), `${kind} ${x} ${y} ${z}`)
      }
      for (const [x, y, z] of landmarks[kind].outside) {
        assert.isFalse(SHAPES[kind].inside(x, y, z), `${kind} ${x} ${y} ${z}`)
      }
    }
  })

  it("names a different catalog piece for each shape", () => {
    assert.strictEqual(new Set(shapeKinds.map((kind) => SHAPES[kind].className)).size, shapeKinds.length)
  })
})

describe("catalogFrame", () => {
  const placement = (kind: ShapeKind): Placement => ({
    kind,
    center: { x: 10, y: 20, z: 30 },
    half: { x: 100, y: 200, z: 300 },
    rotation: quatFromAxisAngle({ x: 0.6, y: 0, z: 0.8 }, 0.9)
  })

  it("is the fitter's frame for every shape but the half sphere", () => {
    const fitted = shapeKinds.filter((kind) => kind !== "hemisphere").map(placement)
    assert.deepStrictEqual(fitted.map((one) => catalogFrame(one) === one), fitted.map(() => true))
  })

  it("lays the half sphere's dome, the fitter's z, along the catalog piece's x", () => {
    const fitted = placement("hemisphere"), inCatalog = catalogFrame(fitted)
    assert.deepStrictEqual(inCatalog.half, { x: 300, y: 200, z: 100 })
    assert.deepStrictEqual(inCatalog.center, fitted.center)
    assertVec(
      rotateVec(inCatalog.rotation, { x: 1, y: 0, z: 0 }),
      rotateVec(fitted.rotation, { x: 0, y: 0, z: 1 }),
      "dome"
    )
    assertVec(
      rotateVec(inCatalog.rotation, { x: 0, y: 1, z: 0 }),
      rotateVec(fitted.rotation, { x: 0, y: 1, z: 0 }),
      "y"
    )
    assertVec(
      rotateVec(inCatalog.rotation, { x: 0, y: 0, z: 1 }),
      rotateVec(fitted.rotation, { x: -1, y: 0, z: 0 }),
      "z"
    )
  })
})
