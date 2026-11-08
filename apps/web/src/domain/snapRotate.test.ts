import { assert, describe, it } from "@effect/vitest"
import type { Vec3 } from "./coords"
import type { SnapMark } from "./snapFrame"
import { type FlushPair, snappedScale, snappedTurn } from "./snapRotate"

const Z = { x: 0, y: 0, z: 1 }
const ORIGIN = { x: 0, y: 0, z: 0 }
const deg = (d: number) => d * Math.PI / 180

/** A face of the selection, or a target, out of `normal`: what flush draws for each. */
const pair = (normal: Vec3, target: Vec3, label = "Face"): FlushPair => ({
  normal,
  target,
  label,
  relation: "flush",
  marks: [{ kind: "face", role: "target", corners: [{ x: 0, y: 100, z: 0 }, { x: 10, y: 100, z: 0 }] }],
  source: [{ kind: "dot", role: "source", at: { x: 50, y: 0, z: 0 } }],
  at: { x: 0, y: 100, z: 0 }
})

const assertNear = (a: Vec3 | undefined, b: Vec3) => {
  assert.isDefined(a)
  assert.closeTo(a.x, b.x, 1e-9)
  assert.closeTo(a.y, b.y, 1e-9)
  assert.closeTo(a.z, b.z, 1e-9)
}

const pointOf = (marks: ReadonlyArray<SnapMark> | undefined, role: "source" | "target") =>
  marks?.flatMap((mark) => mark.kind === "dot" && mark.role === role ? [mark.at] : [])[0]

describe("snappedTurn", () => {
  it("turns in whole steps from where it started", () => {
    assert.closeTo(
      snappedTurn({ free: deg(22), axis: Z, about: ORIGIN, step: 15, flush: [], reach: 0 }).angle,
      deg(15),
      1e-9
    )
    assert.closeTo(
      snappedTurn({ free: deg(23), axis: Z, about: ORIGIN, step: 15, flush: [], reach: 0 }).angle,
      deg(30),
      1e-9
    )
  })

  it("is free with no step and nothing to meet", () => {
    assert.closeTo(snappedTurn({ free: deg(22), axis: Z, about: ORIGIN, flush: [], reach: 0 }).angle, deg(22), 1e-9)
  })

  it("stops where the base face meets a target face, over the step", () => {
    const flush = [pair({ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, "Face of Wall")]
    const turned = snappedTurn({ free: deg(83), axis: Z, about: ORIGIN, step: 15, flush, reach: deg(10) })
    assert.closeTo(turned.angle, deg(90), 1e-9)
    assert.strictEqual(turned.label, "Face of Wall")
  })

  it("draws the target, the base face where the turn takes it, and the flush glyph on the target", () => {
    const flush = [pair({ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })]
    const about = { x: 0, y: 0, z: 0 }
    const { marks, relation } = snappedTurn({ free: deg(83), axis: Z, about, flush, reach: deg(10) })
    assert.strictEqual(relation, "flush")
    assert.deepInclude(marks?.[0], { kind: "face", role: "target" })
    // a quarter turn about Z carries the base face from +X to +Y
    assertNear(pointOf(marks, "source"), { x: 0, y: 50, z: 0 })
    assert.deepStrictEqual(marks?.at(-1), { kind: "glyph", relation: "flush", at: { x: 0, y: 100, z: 0 } })
  })

  it("lets go past the reach", () => {
    const flush = [pair({ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })]
    assert.isUndefined(snappedTurn({ free: deg(50), axis: Z, about: ORIGIN, flush, reach: deg(10) }).label)
  })

  it("leaves out a face that can't meet the target about this axis", () => {
    const flush = [pair({ x: 0, y: 0, z: 1 }, { x: 0, y: -1, z: 0 })]
    assert.isUndefined(snappedTurn({ free: deg(90), axis: Z, about: ORIGIN, flush, reach: deg(10) }).label)
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
    const stops = [{ at: 310, label: "Face of Wall", relation: "flush" as const, marks: [] }]
    const far = snappedScale({ from: 1, free: 1.52, step: 25, face: { reach: 100, range: 20 }, stops })
    assert.closeTo(far.factor, 1.5, 1e-9)
    assert.isUndefined(far.label)
    const near = snappedScale({ from: 1, free: 3.0, step: 25, face: { reach: 100, range: 20 }, stops })
    assert.closeTo(near.factor, 3.1, 1e-9)
    assert.strictEqual(near.label, "Face of Wall")
    assert.strictEqual(near.relation, "flush")
  })
})
