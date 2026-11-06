import { assert, describe, it } from "@effect/vitest"
import { endAlongX } from "../test/snapFixtures"
import { connectedKeys, jointsAfterMove } from "./joints"

const end = endAlongX

const joint = (a: string, ae: number, b: string, be: number) => ({
  a: { item: a, end: ae },
  b: { item: b, end: be }
})

describe("jointsAfterMove", () => {
  it("records the ends a connector snap brought together", () => {
    const ends = [end("a", 0, 500, 1), end("b", 1, 500, -1), end("c", 0, 900, 1)]
    assert.deepStrictEqual(jointsAfterMove([], ends, new Set(["b"]), true), [joint("b", 1, "a", 0)])
  })

  it("records nothing on a move that wasn't a connector snap", () => {
    const ends = [end("a", 0, 500, 1), end("b", 1, 500, -1)]
    assert.deepStrictEqual(jointsAfterMove([], ends, new Set(["b"]), false), [])
  })

  it("drops a joint whose ends no longer meet", () => {
    const ends = [end("a", 0, 500, 1), end("b", 1, 520, -1)]
    assert.deepStrictEqual(jointsAfterMove([joint("a", 0, "b", 1)], ends, new Set(["b"]), false), [])
  })

  it("keeps a joint both of whose items moved together", () => {
    const ends = [end("a", 0, 700, 1), end("b", 1, 700, -1)]
    const joints = [joint("a", 0, "b", 1)]
    assert.deepStrictEqual(jointsAfterMove(joints, ends, new Set(["a", "b"]), false), joints)
  })

  it("doesn't record a pair twice", () => {
    const ends = [end("a", 0, 500, 1), end("b", 1, 500, -1)]
    const joints = [joint("a", 0, "b", 1)]
    assert.deepStrictEqual(jointsAfterMove(joints, ends, new Set(["b"]), true), joints)
  })
})

describe("connectedKeys", () => {
  it("walks the joints from the selection to the whole track", () => {
    const joints = [joint("a", 0, "b", 1), joint("b", 0, "c", 1), joint("x", 0, "y", 1)]
    assert.deepStrictEqual([...connectedKeys(joints, ["c"])].sort(), ["a", "b", "c"])
  })
})
