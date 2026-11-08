import { assert, describe, it } from "@effect/vitest"
import type { WorldEnd } from "../../domain/connectors"
import type { UeTransform, Vec3 } from "../../domain/coords"
import { identityTransform } from "../../domain/factory"
import { quatFromAxisAngle } from "../../domain/ueMath"
import { loadPieces } from "../../test/snapFixtures"
import { assertVec } from "../../test/vec"
import { useEditor } from "../store"
import { ringedEnds } from "./openEnds"

/** Two Track-like slabs, ends at x ± 250 cm and 50 cm up: one at the origin, one 1000 cm along X. */
const twoSlabs = () => {
  const [a = "", b = ""] = loadPieces([{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }])
  return { a, b }
}

const moved = (key: string, transform: UeTransform) =>
  useEditor.setState({ preview: new Map([[key, transform]]), hoveredItem: null })

const positionsOf = (ends: ReadonlyArray<WorldEnd>, key: string): ReadonlyArray<Vec3> =>
  ends.filter(({ ref }) => ref.item === key).toSorted((p, q) => p.ref.end - q.ref.end).map(({ position }) => position)

const ringed = (show: "never" | "hover" | "always") => ringedEnds(useEditor.getState(), show)

describe("the open ends the overlay rings", () => {
  it("are where the document has them with nothing in hand", () => {
    const { a } = twoSlabs()
    useEditor.setState({ preview: null })
    const [first, second] = positionsOf(ringed("always"), a)
    assertVec(first ?? assert.fail("no end"), { x: 250, y: 0, z: 50 }, "first end")
    assertVec(second ?? assert.fail("no end"), { x: -250, y: 0, z: 50 }, "second end")
  })

  it("are at the spot an end connects at, in the document and in hand", () => {
    const { a } = twoSlabs()
    useEditor.getState().setConnectAt(a, 0, "bottomRight")
    useEditor.setState({ preview: null })
    assertVec(positionsOf(ringed("always"), a)[0] ?? assert.fail("no end"), { x: 250, y: 250, z: -50 }, "in the doc")
    moved(a, identityTransform({ x: 0, y: 500, z: 0 }))
    assertVec(positionsOf(ringed("always"), a)[0] ?? assert.fail("no end"), { x: 250, y: 750, z: -50 }, "in hand")
  })

  it("follow a move in hand", () => {
    const { a } = twoSlabs()
    moved(a, identityTransform({ x: 0, y: 500, z: 0 }))
    const [first, second] = positionsOf(ringed("always"), a)
    assertVec(first ?? assert.fail("no end"), { x: 250, y: 500, z: 50 }, "first end")
    assertVec(second ?? assert.fail("no end"), { x: -250, y: 500, z: 50 }, "second end")
  })

  it("follow a turn in hand", () => {
    const { a } = twoSlabs()
    moved(a, {
      ...identityTransform({ x: 0, y: 0, z: 0 }),
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2)
    })
    const [first] = positionsOf(ringed("always"), a)
    assertVec(first ?? assert.fail("no end"), { x: 0, y: 250, z: 50 }, "first end")
  })

  it("follow a scale in hand, a mirroring one too", () => {
    const { a } = twoSlabs()
    moved(a, { ...identityTransform({ x: 0, y: 0, z: 0 }), scale3D: { x: 2, y: 1, z: 1 } })
    assertVec(positionsOf(ringed("always"), a)[0] ?? assert.fail("no end"), { x: 500, y: 0, z: 50 }, "stretched")
    moved(a, { ...identityTransform({ x: 0, y: 0, z: 0 }), scale3D: { x: -1, y: 1, z: 1 } })
    const end = ringed("always").find(({ ref }) => ref.item === a && ref.end === 0) ?? assert.fail("no end")
    assertVec(end.position, { x: -250, y: 0, z: 50 }, "mirrored")
    assertVec(end.forward, { x: -1, y: 0, z: 0 }, "mirrored, it faces the other way")
  })

  it("leave out an end in hand that has come to meet another", () => {
    const { a, b } = twoSlabs()
    moved(a, identityTransform({ x: 500, y: 0, z: 0 }))
    const ends = ringed("always")
    assert.lengthOf(positionsOf(ends, a), 1)
    assert.lengthOf(positionsOf(ends, b), 1)
  })

  it("on hover, are the hovered item's, and in a drag those of what it carries too", () => {
    const { a, b } = twoSlabs()
    useEditor.setState({ preview: null, hoveredItem: b })
    assert.deepStrictEqual([...new Set(ringed("hover").map(({ ref }) => ref.item))], [b])
    useEditor.setState({ preview: new Map([[a, identityTransform({ x: 0, y: 500, z: 0 })]]), hoveredItem: b })
    assert.deepStrictEqual([...new Set(ringed("hover").map(({ ref }) => ref.item))].toSorted(), [a, b].toSorted())
  })

  it("are none when they're never shown", () => {
    twoSlabs()
    assert.lengthOf(ringed("never"), 0)
  })
})
