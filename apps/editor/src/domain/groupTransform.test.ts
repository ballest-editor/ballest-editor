import { describe, expect, it } from "@effect/vitest"
import type { UeTransform, Vec3 } from "./coords"
import { applyGroupDelta, editAxis, readField, selectionPivot } from "./groupTransform"
import { rotateVec } from "./ueMath"

const at = (x: number, y: number, z: number, rotation = { x: 0, y: 0, z: 0, w: 1 }): UeTransform => ({
  translation: { x, y, z },
  rotation,
  scale3D: { x: 1, y: 1, z: 1 }
})
const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } // game X turns to game Y
const expectVec = (actual: Vec3, expected: Vec3) => {
  expect(actual.x).toBeCloseTo(expected.x, 9)
  expect(actual.y).toBeCloseTo(expected.y, 9)
  expect(actual.z).toBeCloseTo(expected.z, 9)
}

describe("group transforms", () => {
  it("pivots on the mean of the item origins", () => {
    expect(selectionPivot([at(0, 0, 0), at(100, 50, 30)])).toEqual({ x: 50, y: 25, z: 15 })
    expect(selectionPivot([at(7, 8, 9)])).toEqual({ x: 7, y: 8, z: 9 })
    expect(selectionPivot([])).toBeUndefined()
  })

  it("translates every item by the same offset", () => {
    const out = applyGroupDelta(at(10, 0, 0), { x: 0, y: 0, z: 0 }, {
      kind: "translate",
      offset: { x: 5, y: 6, z: 7 }
    })
    expect(out.translation).toEqual({ x: 15, y: 6, z: 7 })
  })

  it("rotates items about the pivot, turning each one", () => {
    const pivot = { x: 0, y: 0, z: 0 }
    const out = applyGroupDelta(at(100, 0, 0), pivot, { kind: "rotate", rotation: yaw90 })
    expectVec(out.translation, { x: 0, y: 100, z: 0 }) // orbits the pivot
    expectVec(rotateVec(out.rotation, { x: 1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 }) // and turns with it
    // an item on the pivot only turns
    expect(applyGroupDelta(at(0, 0, 0), pivot, { kind: "rotate", rotation: yaw90 }).translation).toEqual(pivot)
  })

  it("scales uniformly about the pivot", () => {
    const out = applyGroupDelta(at(100, 0, 0), { x: 50, y: 0, z: 0 }, { kind: "scale", factor: 2 })
    expect(out.translation).toEqual({ x: 150, y: 0, z: 0 })
    expect(out.scale3D).toEqual({ x: 2, y: 2, z: 2 })
  })

  it("scales along an axis: spreads positions and stretches the matching local axis", () => {
    const pivot = { x: 0, y: 0, z: 0 }
    const axisX = { kind: "scale", factor: 3, axis: { x: 1, y: 0, z: 0 } } as const
    const aligned = applyGroupDelta(at(10, 20, 0), pivot, axisX)
    expect(aligned.translation).toEqual({ x: 30, y: 20, z: 0 })
    expect(aligned.scale3D).toEqual({ x: 3, y: 1, z: 1 })
    // turned 90 degrees: game X is that item's local Y
    const turned = applyGroupDelta(at(0, 0, 0, yaw90), pivot, axisX)
    expectVec(turned.scale3D, { x: 1, y: 3, z: 1 })
  })

  it("never scales to zero", () => {
    const out = applyGroupDelta(at(0, 0, 0), { x: 0, y: 0, z: 0 }, { kind: "scale", factor: 0 })
    expect(out.scale3D.x).toBeGreaterThan(0)
  })

  it("edits one axis by value or by offset", () => {
    const t = at(10, 20, 30)
    expect(editAxis(t, "translation", "y", { kind: "set", value: 5 }).translation).toEqual({ x: 10, y: 5, z: 30 })
    expect(editAxis(t, "translation", "z", { kind: "offset", by: -5 }).translation).toEqual({ x: 10, y: 20, z: 25 })
    expect(editAxis(t, "scale3D", "x", { kind: "set", value: 0 }).scale3D.x).toBeGreaterThan(0)
    // rotation is edited in rotator degrees; a yaw of 90 is the quaternion (0, 0, sin 45, cos 45)
    const turned = editAxis(t, "rotation", "z", { kind: "set", value: 90 })
    expect(turned.rotation.z).toBeCloseTo(Math.SQRT1_2, 6)
    expect(turned.rotation.w).toBeCloseTo(Math.SQRT1_2, 6)
    expect(readField(turned, "rotation").z).toBeCloseTo(90, 6)
    expect(readField(editAxis(turned, "rotation", "z", { kind: "offset", by: -30 }), "rotation").z).toBeCloseTo(60, 6)
  })
})
