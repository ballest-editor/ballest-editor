import { assert, describe, it } from "@effect/vitest"
import { snappedScale, snappedTurn } from "./snapRotate"

const Z = { x: 0, y: 0, z: 1 }
const deg = (d: number) => d * Math.PI / 180

describe("snappedTurn", () => {
  it("turns in whole steps from where it started", () => {
    assert.closeTo(snappedTurn({ free: deg(22), axis: Z, step: 15, flush: [], reach: 0 }).angle, deg(15), 1e-9)
    assert.closeTo(snappedTurn({ free: deg(23), axis: Z, step: 15, flush: [], reach: 0 }).angle, deg(30), 1e-9)
  })

  it("is free with no step and nothing to meet", () => {
    assert.closeTo(snappedTurn({ free: deg(22), axis: Z, flush: [], reach: 0 }).angle, deg(22), 1e-9)
  })

  it("stops where the base face meets a target face, over the step", () => {
    const flush = [{
      normal: { x: 1, y: 0, z: 0 },
      target: { x: 0, y: -1, z: 0 },
      label: "Face of Wall",
      marks: [],
      source: "mesh" as const
    }]
    const turned = snappedTurn({ free: deg(83), axis: Z, step: 15, flush, reach: deg(10) })
    assert.closeTo(turned.angle, deg(90), 1e-9)
    assert.strictEqual(turned.label, "Face of Wall")
  })

  it("lets go past the reach", () => {
    const flush = [{
      normal: { x: 1, y: 0, z: 0 },
      target: { x: 0, y: -1, z: 0 },
      label: "Face",
      marks: [],
      source: "mesh" as const
    }]
    assert.isUndefined(snappedTurn({ free: deg(50), axis: Z, flush, reach: deg(10) }).label)
  })

  it("leaves out a face that can't meet the target about this axis", () => {
    const flush = [{
      normal: { x: 0, y: 0, z: 1 },
      target: { x: 0, y: -1, z: 0 },
      label: "Face",
      marks: [],
      source: "mesh" as const
    }]
    assert.isUndefined(snappedTurn({ free: deg(90), axis: Z, flush, reach: deg(10) }).label)
  })
})

describe("snappedScale", () => {
  it("lands the active item's scale on the step along its axis", () => {
    assert.closeTo(snappedScale({ from: 1, free: 1.37, step: 25 }).factor, 1.25, 1e-9)
    assert.closeTo(snappedScale({ from: 2, free: 2.6, step: 50 }).factor, 1.25, 1e-9)
  })

  it("never lands on nothing", () => {
    assert.closeTo(snappedScale({ from: 1, free: 0.02, step: 25 }).factor, 0.25, 1e-9)
    assert.closeTo(snappedScale({ from: 1, free: -0.02, step: 25 }).factor, -0.25, 1e-9)
  })

  it("stops the scaled face on a plane in range, over the step", () => {
    const stops = [{ at: 310, label: "Face of Wall", marks: [] }]
    const far = snappedScale({ from: 1, free: 1.52, step: 25, face: { reach: 100, range: 20 }, stops })
    assert.closeTo(far.factor, 1.5, 1e-9)
    assert.isUndefined(far.label)
    const near = snappedScale({ from: 1, free: 3.0, step: 25, face: { reach: 100, range: 20 }, stops })
    assert.closeTo(near.factor, 3.1, 1e-9)
    assert.strictEqual(near.label, "Face of Wall")
  })
})
