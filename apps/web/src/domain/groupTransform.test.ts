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

  it("scales along each item's own axis about the one pivot, as the game does", () => {
    const pivot = { x: 50, y: 0, z: 0 }
    const uniform = applyGroupDelta(at(100, 0, 0), pivot, { kind: "scale", factor: 2 })
    expect(uniform.translation).toEqual({ x: 150, y: 0, z: 0 })
    expect(uniform.scale3D).toEqual({ x: 2, y: 2, z: 2 })
    const axisX = { kind: "scale", factor: 3, axis: "x" } as const
    const aligned = applyGroupDelta(at(10, 20, 0), { x: 0, y: 0, z: 0 }, axisX)
    expect(aligned.translation).toEqual({ x: 30, y: 20, z: 0 })
    expect(aligned.scale3D).toEqual({ x: 3, y: 1, z: 1 })
    // turned 90, its own X lies along game Y, so that's the way it spreads
    const turned = applyGroupDelta(at(10, 20, 0, yaw90), { x: 0, y: 0, z: 0 }, axisX)
    expectVec(turned.translation, { x: 10, y: 60, z: 0 })
    expect(turned.scale3D).toEqual({ x: 3, y: 1, z: 1 })
    const mirrored = applyGroupDelta({ ...at(0, 0, 0), scale3D: { x: -1, y: 1, z: 1 } }, pivot, axisX)
    expect(mirrored.scale3D).toEqual({ x: -3, y: 1, z: 1 })
  })

  it("leaves an item on the pivot where it is, and keeps a pivot on the item in place", () => {
    const turned = { ...at(10, 20, 30, yaw90), scale3D: { x: 2, y: 1, z: 0.5 } }
    const top = { x: 0, y: 0, z: 100 }
    const pivot = localToWorld(turned, top)
    for (const delta of [{ kind: "scale", factor: 3 }, { kind: "scale", factor: 0.5, axis: "z" }] as const) {
      expect(applyGroupDelta(turned, turned.translation, delta).translation).toEqual(turned.translation)
      expectVec(localToWorld(applyGroupDelta(turned, pivot, delta), top), pivot)
    }
    // a pivot along X doesn't move under a Z scale
    const back = localToWorld(turned, { x: 250, y: 0, z: 0 })
    expectVec(applyGroupDelta(turned, back, { kind: "scale", factor: 4, axis: "z" }).translation, turned.translation)
  })

  it("stays finite for an item with a scale of 0 on the axis", () => {
    const flat = { ...at(10, 0, 0), scale3D: { x: 0, y: 1, z: 1 } }
    const out = applyGroupDelta(flat, { x: 0, y: 0, z: 0 }, { kind: "scale", factor: 2, axis: "x" })
    expect(out.translation).toEqual({ x: 10, y: 0, z: 0 })
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

  it("takes an axis to a typed value on the active item and the rest along by the change, like the gizmo", () => {
    const t = at(10, 20, 30)
    const set = (field: TransformField, axis: Axis, value: number, item = t) =>
      selectionAxisEdit(t, field, axis, { kind: "set", value })(item)
    const offset = (field: TransformField, axis: Axis, by: number, item = t) =>
      selectionAxisEdit(t, field, axis, { kind: "offset", by })(item)
    expect(set("translation", "y", 5).translation).toEqual({ x: 10, y: 5, z: 30 })
    // another item moves by what the active one did, not to the value
    expect(set("translation", "y", 5, at(0, 0, 0)).translation).toEqual({ x: 0, y: -15, z: 0 })
    expect(offset("translation", "z", -5).translation).toEqual({ x: 10, y: 20, z: 25 })
    expect(set("scale3D", "x", 0).scale3D.x).toBeGreaterThan(0)
    expect(offset("scale3D", "x", 0.5).scale3D).toEqual({ x: 1.5, y: 1, z: 1 })
    // another item takes the active one's ratio, not its amount
    expect(offset("scale3D", "x", 0.5, { ...t, scale3D: { x: 2, y: 1, z: 1 } }).scale3D).toEqual({ x: 3, y: 1, z: 1 })
    // a value typed on the active item is that value, not that value through a ratio's rounding
    const third = { ...t, scale3D: { x: 3, y: 1, z: 1 } }
    expect(selectionAxisEdit(third, "scale3D", "x", { kind: "set", value: 0.7 })(third).scale3D.x).toBe(0.7)
    // an active item with a 0 there has no ratio to give, so every item takes the value
    const flat = { ...t, scale3D: { x: 0, y: 1, z: 1 } }
    expect(selectionAxisEdit(flat, "scale3D", "x", { kind: "set", value: 2 })(t).scale3D.x).toBe(2)
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

/**
 * Real drags and typed values in the game (docs/qa/gizmo-scale.md), to within what the game's read-outs round to. Each
 * cube is one at its measured place and turn; the factors are read from the panel, so they carry their own rounding.
 */
describe("a scale of several items, against the game", () => {
  const cube = (x: number, y: number, z: number, pitch: number, yaw: number, roll: number, sx = 1): UeTransform => ({
    ...at(x, y, z, rotatorToQuat({ pitch, yaw, roll })),
    scale3D: { x: sx, y: 1, z: 1 }
  })
  const flat = cube(0, 0, 5000, 0, 0, 0)
  const diagonal = cube(0, 3000, 5000, 0, 45, 0)
  const side = cube(0, -3000, 5500, 0, 90, 0)
  const tilted = cube(-2000, 1500, 6000, 30, 20, 10, 2)
  const active = cube(3000, 0, 5000, 0, 30, 0)
  const near = (a: UeTransform, x: number, y: number, z: number) => expectVec(a.translation, { x, y, z }, 0)

  it("matches a Y handle drag on a loose selection, about the active item", () => {
    const delta = { kind: "scale", factor: 2.37281, axis: "y" } as const
    const scaled = (t: UeTransform) => applyGroupDelta(t, active.translation, delta)
    near(scaled(flat), 0, 0, 5000)
    near(scaled(diagonal), -4118.43, 7118.43, 5000)
    near(scaled(side), -4118.43, -3000, 5500)
    near(scaled(tilted), -2896.46, 4854.63, 5471.81)
    near(scaled(active), 3000, 0, 5000)
    expectVec(scaled(tilted).scale3D, { x: 2, y: 2.37281, z: 1 })
  })

  it("matches the uniform handle: a plain scale about the pivot", () => {
    const delta = { kind: "scale", factor: 2.28601 } as const
    const out = applyGroupDelta(cube(-2896.46, 4854.63, 5471.81, 30, 20, 10), active.translation, delta)
    near(out, -10479.4, 11097.7, 6078.56)
    expect(out.scale3D).toEqual({ x: 2.28601, y: 2.28601, z: 2.28601 })
  })

  it("matches an X handle drag on a group, about its frame, without a shear", () => {
    const frame = { x: 109.749, y: 103.553, z: 6214.03 }
    const scaled = (t: UeTransform) => applyGroupDelta(t, frame, { kind: "scale", factor: 3.8843, axis: "x" })
    near(scaled(flat), -316.548, 0, 5000)
    near(scaled(diagonal), 4018.83, 7018.83, 5000)
    near(scaled(side), 0, -11951.6, 5500)
    near(scaled(tilted), -5310.3, 295.149, 3966.14)
    near(scaled(active), 9122.92, 3535.07, 5000)
    expect(scaled(tilted).rotation).toEqual(tilted.rotation)
    expectVec(scaled(tilted).scale3D, { x: 7.7686, y: 1, z: 1 }, 3)
  })

  it("matches a group whose frame is turned: the members still go by their own axes", () => {
    const frame = { x: 1103.553, y: 603.553, z: 5500 }
    const scaled = (t: UeTransform) => applyGroupDelta(t, frame, { kind: "scale", factor: 2.36546, axis: "y" })
    const first = scaled(cube(449.625, -470.916, 5000, 0, 30, 0))
    near(first, 861.69, -1184.63, 5000)
    near(scaled(cube(1681.676, 1395.11, 5000, 0, 75, 0)), 2147.99, 1270.16, 5000)
    expect(first.scale3D).toEqual({ x: 1, y: 2.36546, z: 1 })
  })

  it("matches a scale typed in the panel: a ratio from the active item, not a value for each", () => {
    const typed = selectionAxisEdit(active, "scale3D", "x", { kind: "set", value: 2 }, active.translation)
    near(typed(flat), -3000, 0, 5000)
    near(typed(diagonal), 0, 3000, 5000)
    near(typed(tilted), -4542.87, 574.472, 4437.65)
    expect(typed(tilted).scale3D.x).toBe(4)
    expect(typed(active).scale3D.x).toBe(2)
  })

  it("matches the active item's pivot standing in for everyone's", () => {
    const top = { x: 3000, y: 0, z: 6000 }
    near(applyGroupDelta(side, top, { kind: "scale", factor: 2, axis: "z" }), 0, -3000, 5000)
    const typed = selectionAxisEdit(active, "scale3D", "z", { kind: "set", value: 2 }, top)(cube(0, 0, 5000, 0, 90, 0))
    near(typed, 0, 0, 4000)
    expect(typed.scale3D).toEqual({ x: 1, y: 1, z: 2 })
  })
})
