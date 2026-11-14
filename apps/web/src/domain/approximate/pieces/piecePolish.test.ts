import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest"
import { upright } from "../../../test/placement"
import { vecDistance } from "../../ueMath"
import { setClock } from "../clock"
import { modelViews, trianglesOfPlacement } from "../look/views"
import { joined } from "../parts/meshParts"
import { chosenSymmetries, mirrorPlacement, movedPlacement, shapeGap, symmetriesOf, tyingOf } from "../parts/symmetry"
import type { Placement } from "../shapes"
import { polishPieces, symmetricOrFree, symmetricStart } from "./piecePolish"

/** A head with a snout on its mirror plane and an ear either side of it. */
const X_PLANE = { normal: { x: 1, y: 0, z: 0 }, offset: 0 }
const head = upright("sphere", [0, 0, 0], [300, 260, 240])
const snout = upright("box", [0, -300, -40], [70, 120, 60])
const ear = upright("box", [230, 40, 260], [60, 30, 140])
const parts = [head, snout, ear, mirrorPlacement(ear, X_PLANE)]
const model = joined(parts.map(trianglesOfPlacement))
const views = modelViews(model)
const symmetries = chosenSymmetries(symmetriesOf(model))

/** Whether every image of every piece under the model's symmetries, as they were measured, is a piece too. */
const isSymmetric = (placements: ReadonlyArray<Placement>): boolean =>
  tyingOf(symmetries, views.frame.radius).group.every((motion) =>
    placements.every((placed) =>
      placements.some((other) => shapeGap(other, movedPlacement(motion, placed)) <= 1e-6 * views.frame.radius)
    )
  )

/** The parts a little lopsided: the head off the plane, and one ear too big. */
const lopsided = [
  { ...head, center: { x: 25, y: 0, z: 0 } },
  snout,
  { ...ear, half: { x: 80, y: 40, z: 170 } },
  mirrorPlacement(ear, X_PLANE)
]

// A clock that ticks a millisecond a read: a polish then stops after so much work, on any machine.
beforeEach(() => {
  let ticks = 0
  setClock(() => ticks++)
})
afterEach(() => setClock(() => performance.now()))

describe("polishPieces", () => {
  it("leaves the pieces alone with no time", () => {
    const polished = polishPieces(views, lopsided, 0)
    assert.deepStrictEqual(polished.placements, lopsided)
    assert.strictEqual(polished.after, polished.before)
  })

  it("moves a piece to where the whole looks more like the model", () => {
    const off = { ...head, center: { x: 60, y: 0, z: 0 } }
    const polished = polishPieces(modelViews(trianglesOfPlacement(head)), [off], 0.1)
    const [moved] = polished.placements
    if (moved === undefined) return assert.fail("the only piece was dropped")
    assert.isAbove(polished.after, polished.before)
    assert.isBelow(vecDistance(moved.center, head.center), 40)
    assert.strictEqual(polished.tied, 0)
  })

  it("drops a piece that shows nowhere, but never the last one", () => {
    const hidden = upright("box", [0, 0, 0], [50, 50, 50])
    const polished = polishPieces(views, [...parts, hidden], 0.006)
    assert.strictEqual(polished.placements.length, parts.length)
    assert.notInclude(polished.placements, hidden)
    assert.strictEqual(polishPieces(views, [hidden], 0.006).placements.length, 1)
  })

  it("polishes tied pieces together, so that the result is exactly symmetric", () => {
    assert.isAbove(symmetries.length, 0)
    const polished = polishPieces(views, lopsided, 0.05, symmetries)
    assert.isAtLeast(polished.tied, 2)
    assert.isFalse(isSymmetric(lopsided))
    assert.isTrue(isSymmetric(polished.placements))
  })
})

describe("symmetricStart", () => {
  it("makes lopsided pieces symmetric, with no more of them", () => {
    const start = symmetricStart(views, lopsided, symmetries)
    assert.isAtMost(start.placements.length, lopsided.length)
    assert.isBelow(start.orbits.length, start.placements.length)
    assert.isTrue(isSymmetric(start.placements))
  })
})

describe("symmetricOrFree", () => {
  it("keeps the symmetric result where it looks as good", () => {
    assert.deepStrictEqual(symmetricOrFree(views, lopsided, parts), { placements: parts, symmetric: true })
  })

  it("keeps the free result where symmetry lost a feature", () => {
    // Without the snout the pieces are as symmetric as before, and look worse.
    const erased = [head, ear, mirrorPlacement(ear, X_PLANE)]
    assert.deepStrictEqual(symmetricOrFree(views, parts, erased), { placements: parts, symmetric: false })
  })
})
