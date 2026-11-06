import { assert, describe, it } from "@effect/vitest"
import { emptyIndexWith } from "../test/catalogIndex"
import { TRACK_ENDS, withFlags } from "../test/snapFixtures"
import { expectVec } from "../test/vec"
import { endsFit, endsMeet, endsOf, meetingTurn, openEndsOf } from "./connectors"
import type { Vec3 } from "./coords"
import { identityTransform, itemFromPiece } from "./factory"
import { MIRROR_X, MIRROR_Y } from "./mirror"
import { rotateVec, rotatorToQuat } from "./ueMath"

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a value")
  return value
}

describe("connectors", () => {
  const { index, piece } = emptyIndexWith({ connectors: TRACK_ENDS })
  const placed = (translation: Vec3, yaw = 0, scale?: Vec3) => {
    const base = identityTransform(translation)
    const transform = {
      ...base,
      rotation: { ...base.rotation, ...rotatorToQuat({ pitch: 0, yaw, roll: 0 }) },
      scale3D: { ...base.scale3D, ...scale }
    }
    return { item: itemFromPiece(piece, transform), transform }
  }

  it("places a piece's ends with its transform", () => {
    const { item, transform } = placed({ x: 1000, y: 0, z: 0 }, 90)
    const [front, back] = endsOf("a", item, transform, index)
    expectVec(must(front).position, { x: 1000, y: 250, z: 50 })
    expectVec(must(front).forward, { x: 0, y: 1, z: 0 })
    expectVec(must(back).position, { x: 1000, y: -250, z: 50 })
  })

  it("scales an end's position, not its directions", () => {
    const { item, transform } = placed({ x: 0, y: 0, z: 0 }, 0, { x: 2, y: 1, z: 1 })
    const [front] = endsOf("a", item, transform, index)
    expectVec(must(front).position, { x: 500, y: 0, z: 50 })
    expectVec(must(front).forward, { x: 1, y: 0, z: 0 })
  })

  it("mirrors its ends with its geometry", () => {
    const { item, transform } = placed({ x: 0, y: 0, z: 0 })
    const [front] = endsOf("a", withFlags(item, MIRROR_X), transform, index)
    expectVec(must(front).position, { x: -250, y: 0, z: 50 })
    expectVec(must(front).forward, { x: -1, y: 0, z: 0 })
  })

  it("turns one end to face the other, up matching up", () => {
    const a = placed({ x: 0, y: 0, z: 0 })
    const b = placed({ x: 400, y: 800, z: 0 }, 37)
    const [own] = endsOf("a", a.item, a.transform, index)
    const [other] = endsOf("b", b.item, b.transform, index)
    if (own === undefined || other === undefined) return assert.fail("no ends")
    const turn = meetingTurn(own, other)
    expectVec(rotateVec(turn, own.forward), { x: -other.forward.x, y: -other.forward.y, z: -other.forward.z })
    expectVec(rotateVec(turn, own.up), other.up)
  })

  it("knows two ends that meet from two that are only close", () => {
    const a = placed({ x: 0, y: 0, z: 0 })
    const b = placed({ x: 500, y: 0, z: 0 })
    const c = placed({ x: 500.5, y: 0, z: 0 })
    const [ownA] = endsOf("a", a.item, a.transform, index)
    const backB = endsOf("b", b.item, b.transform, index)[1]
    const backC = endsOf("c", c.item, c.transform, index)[1]
    if (ownA === undefined || backB === undefined || backC === undefined) return assert.fail("no ends")
    assert.isTrue(endsMeet(ownA, backB))
    assert.isFalse(endsMeet(ownA, backC))
    assert.isFalse(endsMeet(ownA, ownA))
  })

  it("finds the ends no other end meets", () => {
    const a = placed({ x: 0, y: 0, z: 0 })
    const b = placed({ x: 500, y: 0, z: 0 })
    const ends = [...endsOf("a", a.item, a.transform, index), ...endsOf("b", b.item, b.transform, index)]
    const open = openEndsOf(ends)
    assert.deepStrictEqual(open.map(({ ref }) => ref), [{ item: "a", end: 1 }, { item: "b", end: 0 }])
  })

  it("tells a matching profile, and a hand that wants the mirrored twin", () => {
    const end = { ref: { item: "a", end: 0 }, position: { x: 0, y: 0, z: 0 } }
    const directions = { forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }
    const left = { ...end, ...directions, profile: "Bevel_C", hand: "left" } as const
    const right = { ...left, hand: "right" } as const
    assert.deepStrictEqual(endsFit(left, right), { profile: true, hand: true })
    assert.deepStrictEqual(endsFit(left, left), { profile: true, hand: false })
    assert.deepStrictEqual(endsFit(left, { ...end, ...directions, profile: "Track" }), { profile: false, hand: true })
  })
})

describe("hands", () => {
  const { index, piece } = emptyIndexWith({
    connectors: [{ position: [500, 0, 62.5], forward: [1, 0, 0], up: [0, 0, 1], profile: "Bevel_C", hand: "left" }]
  })

  it("swaps with one mirror and comes back with two", () => {
    const transform = identityTransform({ x: 0, y: 0, z: 0 })
    const item = itemFromPiece(piece, transform)
    assert.strictEqual(endsOf("a", item, transform, index)[0]?.hand, "left")
    assert.strictEqual(endsOf("a", withFlags(item, MIRROR_Y), transform, index)[0]?.hand, "right")
    assert.strictEqual(endsOf("a", withFlags(item, MIRROR_X, MIRROR_Y), transform, index)[0]?.hand, "left")
  })
})
