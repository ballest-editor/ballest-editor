import { assert, describe, it } from "@effect/vitest"
import { boxAt, cubeAt } from "../test/snapFixtures"
import type { SnapHit } from "./snapFrame"
import { boxMark, cornersOf, itemBoxMark, shownMarks, sideOf, sourceOf } from "./snapRelation"
import { ORIGIN, quatFromAxisAngle } from "./ueMath"

const X = { x: 1, y: 0, z: 0 }
const Z = { x: 0, y: 0, z: 1 }

describe("sideOf", () => {
  it("is a box's face along one of its axes, its corners in order round it", () => {
    const side = sideOf(boxAt(ORIGIN), X, "target")
    assert.strictEqual(side.kind, "face")
    const corners = side.kind === "face" ? side.corners : []
    assert.lengthOf(corners, 4)
    assert.isTrue(corners.every(({ x }) => x === 50))
    // each corner differs from the next in one coordinate: it goes round the face, not across it
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % 4] ?? corner
      assert.strictEqual(Number(corner.y !== next.y) + Number(corner.z !== next.z), 1)
    })
  })

  it("is the edge or corner that stands out furthest off the box's axes", () => {
    assert.strictEqual(sideOf(boxAt(ORIGIN), { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }, "source").kind, "line")
    assert.deepStrictEqual(sideOf(boxAt(ORIGIN), { x: 0.6, y: 0.6, z: 0.52 }, "source"), {
      kind: "dot",
      role: "source",
      at: { x: 50, y: 50, z: 50 }
    })
  })
})

describe("itemBoxMark", () => {
  it("is an item's own bounds where they are known, turned with it, and its world box where they aren't", () => {
    const turned = cubeAt("a", ORIGIN, {
      transform: { ...cubeAt("a", ORIGIN).transform, rotation: quatFromAxisAngle(Z, Math.PI / 4) }
    })
    const mark = itemBoxMark(turned, "target")
    const xs = mark.kind === "box" ? mark.corners.map(({ x }) => x) : []
    // a 100 cm cube turned 45°: its corners reach out along X by half its diagonal
    assert.closeTo(Math.max(...xs), 50 * Math.SQRT2, 1e-9)
    assert.deepStrictEqual(itemBoxMark({ ...turned, bounds: undefined }, "target"), boxMark(turned.box, "target"))
  })
})

describe("sourceOf", () => {
  const box = boxAt(ORIGIN)

  it("is the end itself for a base on an end, a dot for a point, and the box's face for a face base", () => {
    const end = { ref: { item: "own", end: 0 }, position: X, forward: X, up: Z, profile: "Track" }
    assert.deepStrictEqual(sourceOf(box, { start: X, label: "End", end }), [{ kind: "ring", role: "source", at: X }])
    assert.deepStrictEqual(sourceOf(box, { start: ORIGIN, label: "Pivot" }), [
      { kind: "dot", role: "source", at: ORIGIN }
    ])
    const near = sourceOf(box, { start: { x: -50, y: 0, z: 0 }, label: "Near face", stop: { kind: "face", axis: X } })
    assert.deepStrictEqual(near[0], { kind: "box", role: "source", corners: cornersOf(box) })
    assert.isTrue(near[1]?.kind === "face" && near[1].corners.every(({ x }) => x === -50))
  })
})

describe("shownMarks", () => {
  const hit: SnapHit = {
    target: "mesh",
    rank: 0,
    distance: 0,
    base: { start: { x: 50, y: 0, z: 0 }, label: "Corner" },
    landing: { x: 300, y: 0, z: 0 },
    label: "Corner of Cube",
    relation: "coincident",
    marks: [{ kind: "dot", role: "target", at: { x: 300, y: 0, z: 0 } }],
    source: [{ kind: "line", role: "source", from: { x: 50, y: 0, z: 0 }, to: { x: 50, y: 100, z: 0 } }],
    held: { shape: "point", at: { x: 300, y: 0, z: 0 } }
  }

  it("draws the target where it is, the source where the hit takes the base, and the glyph at the landing", () => {
    assert.deepStrictEqual(shownMarks(hit), [
      { kind: "dot", role: "target", at: { x: 300, y: 0, z: 0 } },
      { kind: "line", role: "source", from: { x: 300, y: 0, z: 0 }, to: { x: 300, y: 100, z: 0 } },
      { kind: "glyph", relation: "coincident", at: { x: 300, y: 0, z: 0 } }
    ])
  })

  it("turns the source with a hit that takes a turn, about the base", () => {
    const turned = shownMarks({ ...hit, rotation: quatFromAxisAngle(Z, Math.PI / 2) })[1]
    const to = turned?.kind === "line" ? turned.to : ORIGIN
    assert.closeTo(to.x, 200, 1e-9)
    assert.closeTo(to.y, 0, 1e-9)
  })

  it("draws a box once, however many parts of a landing bring it", () => {
    const box = boxMark(boxAt({ x: 300, y: 0, z: 0 }), "target")
    const twice = shownMarks({ ...hit, marks: [box, box], source: [] })
    assert.deepStrictEqual(twice.map(({ kind }) => kind), ["box", "glyph"])
  })

  it("leaves the source out of a pick, which has no selection", () => {
    assert.deepStrictEqual(shownMarks(hit, { source: false }).map(({ kind }) => kind), ["dot", "glyph"])
  })
})
