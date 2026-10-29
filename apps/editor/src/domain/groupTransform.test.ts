import { describe, expect, it } from "@effect/vitest"
import { expectVec } from "../test/vec"
import type { UeTransform } from "./coords"
import { applyGroupDelta, type Axis, readField, selectionAxisEdit, type TransformField } from "./groupTransform"
import { localToWorld } from "./pivot"
import { rotateVec, rotatorToQuat } from "./ueMath"

const at = (x: number, y: number, z: number, rotation = { x: 0, y: 0, z: 0, w: 1 }): UeTransform => ({
  translation: { x, y, z },
  rotation,
  scale3D: { x: 1, y: 1, z: 1 }
})
const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } // game X turns to game Y

describe("group transforms", () => {
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

  it("scales uniformly in place, as the game does: the pivot doesn't move items", () => {
    const out = applyGroupDelta(at(100, 0, 0), { x: 50, y: 0, z: 0 }, { kind: "scale", factor: 2 })
    expect(out.translation).toEqual({ x: 100, y: 0, z: 0 })
    expect(out.scale3D).toEqual({ x: 2, y: 2, z: 2 })
  })

  it("scales along each item's own axis, wherever it is and however it's turned", () => {
    const pivot = { x: 0, y: 0, z: 0 }
    const axisX = { kind: "scale", factor: 3, axis: "x" } as const
    const aligned = applyGroupDelta(at(10, 20, 0), pivot, axisX)
    expect(aligned.translation).toEqual({ x: 10, y: 20, z: 0 })
    expect(aligned.scale3D).toEqual({ x: 3, y: 1, z: 1 })
    const turned = applyGroupDelta(at(5, 5, 5, yaw90), pivot, axisX)
    expect(turned.translation).toEqual({ x: 5, y: 5, z: 5 })
    expect(turned.scale3D).toEqual({ x: 3, y: 1, z: 1 })
    // a mirrored item keeps its sign
    const mirrored = applyGroupDelta({ ...at(0, 0, 0), scale3D: { x: -1, y: 1, z: 1 } }, pivot, axisX)
    expect(mirrored.scale3D).toEqual({ x: -3, y: 1, z: 1 })
  })

  it("scales about each item's own pivot, which stays put", () => {
    const top = { x: 0, y: 0, z: 100 }
    const turned = { ...at(10, 20, 30, yaw90), scale3D: { x: 2, y: 1, z: 0.5 } }
    for (const delta of [{ kind: "scale", factor: 3 }, { kind: "scale", factor: 0.5, axis: "z" }] as const) {
      const out = applyGroupDelta(turned, { x: 999, y: 0, z: 0 }, delta, top)
      expectVec(localToWorld(out, top), localToWorld(turned, top))
    }
    // a pivot along X doesn't move under a Z scale
    const back = { x: 250, y: 0, z: 0 }
    const out = applyGroupDelta(turned, { x: 0, y: 0, z: 0 }, { kind: "scale", factor: 4, axis: "z" }, back)
    expectVec(out.translation, turned.translation)
  })

  it("turns the group about the active item's pivot point", () => {
    const pivot = localToWorld(at(100, 0, 0), { x: 0, y: 0, z: 50 })
    const out = applyGroupDelta(at(100, 0, 0), pivot, { kind: "rotate", rotation: yaw90 })
    expectVec(out.translation, { x: 100, y: 0, z: 0 }) // the pivot sits above the origin, so it only turns
    const other = applyGroupDelta(at(200, 0, 0), pivot, { kind: "rotate", rotation: yaw90 })
    expectVec(other.translation, { x: 100, y: 100, z: 0 })
  })

  it("never scales to zero", () => {
    const out = applyGroupDelta(at(0, 0, 0), { x: 0, y: 0, z: 0 }, { kind: "scale", factor: 0 })
    expect(out.scale3D.x).toBeGreaterThan(0)
  })

  it("sets one axis on every item, or offsets the selection like the gizmo", () => {
    const t = at(10, 20, 30)
    const set = (field: TransformField, axis: Axis, value: number) =>
      selectionAxisEdit(t, field, axis, { kind: "set", value })(t)
    const offset = (field: TransformField, axis: Axis, by: number, item = t) =>
      selectionAxisEdit(t, field, axis, { kind: "offset", by })(item)
    expect(set("translation", "y", 5).translation).toEqual({ x: 10, y: 5, z: 30 })
    expect(offset("translation", "z", -5).translation).toEqual({ x: 10, y: 20, z: 25 })
    expect(set("scale3D", "x", 0).scale3D.x).toBeGreaterThan(0)
    expect(offset("scale3D", "x", 0.5, { ...t, scale3D: { x: 2, y: 1, z: 1 } }).scale3D).toEqual({ x: 2.5, y: 1, z: 1 })
    // rotation is edited in rotator degrees; a yaw of 90 is the quaternion (0, 0, sin 45, cos 45)
    const turned = set("rotation", "z", 90)
    expect(turned.rotation.z).toBeCloseTo(Math.SQRT1_2, 6)
    expect(turned.rotation.w).toBeCloseTo(Math.SQRT1_2, 6)
    expect(readField(turned, "rotation").z).toBeCloseTo(90, 6)
    const back = selectionAxisEdit(turned, "rotation", "z", { kind: "offset", by: -30 })(turned)
    expectVec(readField(back, "rotation"), { x: 0, y: 0, z: 60 })
    // another item turns with the active one about its origin
    const other = selectionAxisEdit(turned, "rotation", "z", { kind: "offset", by: 90 })(
      at(110, 20, 30, turned.rotation)
    )
    expectVec(other.translation, { x: 10, y: 120, z: 30 })
    expectVec(rotateVec(other.rotation, { x: 1, y: 0, z: 0 }), { x: -1, y: 0, z: 0 }) // yaw 180
  })

  it("offsets one rotator angle of the active item, even at gimbal lock", () => {
    for (const rotator of [{ roll: 0, pitch: 90, yaw: 30 }, { roll: 40, pitch: -90, yaw: -60 }]) {
      const t = at(0, 0, 0, rotatorToQuat(rotator))
      const start = readField(t, "rotation")
      for (const axis of ["x", "y", "z"] as const) {
        const out = selectionAxisEdit(t, "rotation", axis, { kind: "offset", by: 5 })(t)
        const want = rotatorToQuat({
          roll: start.x + (axis === "x" ? 5 : 0),
          pitch: start.y + (axis === "y" ? 5 : 0),
          yaw: start.z + (axis === "z" ? 5 : 0)
        })
        for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]) {
          expectVec(rotateVec(out.rotation, v), rotateVec(want, v))
        }
      }
    }
  })
})
