import { assert, describe, it } from "@effect/vitest"
import { axisOf, ORTHO_AXES } from "./orthoView"
import { gizmoEnds, gizmoViewOf, sameGizmoEnds, type ScreenAxes } from "./viewGizmo"
import { type OrthoView, orthoViews } from "./viewLayout"

const axesOf = (view: OrthoView): ScreenAxes => {
  const { right, up, forward } = ORTHO_AXES[view]
  return { right, up, toward: { x: -forward.x, y: -forward.y, z: -forward.z } }
}

/** A three-quarter view: every end clear of the centre. */
const threeQuarter: ScreenAxes = {
  right: { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 },
  up: { x: -0.5, y: 0.5, z: Math.SQRT1_2 },
  toward: { x: 0.5, y: -0.5, z: Math.SQRT1_2 }
}

describe("the axis gizmo's views", () => {
  it("snaps X to Right, and each end to its own view", () => {
    assert.strictEqual(gizmoViewOf("x", true), "right")
    assert.strictEqual(gizmoViewOf("x", false), "left")
    assert.strictEqual(gizmoViewOf("y", true), "back")
    assert.strictEqual(gizmoViewOf("y", false), "front")
    assert.strictEqual(gizmoViewOf("z", true), "top")
    assert.strictEqual(gizmoViewOf("z", false), "bottom")
  })

  it("reaches every view, each from one end", () => {
    const views = gizmoEnds(threeQuarter).map((end) => end.view)
    assert.deepStrictEqual([...views].sort(), [...orthoViews].sort())
  })

  it("runs a level axis across the screen to the right in the view it snaps to", () => {
    for (const axis of ["x", "y"] as const) {
      for (const positive of [true, false]) {
        assert.deepStrictEqual(axisOf(ORTHO_AXES[gizmoViewOf(axis, positive)].right), { axis, positive })
      }
    }
  })

  it("looks down on Z from Top and up it from Bottom", () => {
    assert.strictEqual(ORTHO_AXES[gizmoViewOf("z", true)].forward.z, -1)
    assert.strictEqual(ORTHO_AXES[gizmoViewOf("z", false)].forward.z, 1)
  })
})

describe("the axis gizmo's ends", () => {
  it("puts an end where the picture runs: Top has X up the screen and Y to the right", () => {
    const ends = gizmoEnds(axesOf("top"))
    const end = (view: OrthoView) => ends.find((e) => e.view === view)
    assert.deepStrictEqual(end("right"), { axis: "x", positive: true, view: "right", x: 0, y: 1, depth: 0 })
    assert.deepStrictEqual(end("back"), { axis: "y", positive: true, view: "back", x: 1, y: 0, depth: 0 })
    assert.strictEqual(end("left")?.y, -1)
    assert.strictEqual(end("front")?.x, -1)
  })

  it("hides the axis an orthographic pane looks along, leaving the centre clear", () => {
    for (const view of orthoViews) {
      const looked = axisOf(ORTHO_AXES[view].forward).axis
      const ends = gizmoEnds(axesOf(view))
      assert.strictEqual(ends.length, 4)
      assert.isFalse(ends.some((end) => end.axis === looked))
    }
  })

  it("says which end of an axis comes toward the eye", () => {
    const ends = gizmoEnds(threeQuarter)
    const up = ends.find((end) => end.axis === "z" && end.positive)
    const down = ends.find((end) => end.axis === "z" && !end.positive)
    assert.isAbove(up?.depth ?? 0, 0)
    assert.isBelow(down?.depth ?? 0, 0)
  })

  it("counts a reading the same only until it would show", () => {
    const ends = gizmoEnds(threeQuarter)
    assert.isTrue(sameGizmoEnds(ends, gizmoEnds(threeQuarter)))
    const turned = { ...threeQuarter, right: { x: 0.68, y: 0.73, z: 0 } }
    assert.isFalse(sameGizmoEnds(ends, gizmoEnds(turned)))
    assert.isFalse(sameGizmoEnds(ends, gizmoEnds(axesOf("top"))))
  })
})
