import { assert, describe, it } from "@effect/vitest"
import { ueToThreeVector, type Vec3 } from "./coords"
import {
  axisOf,
  clampCmPerPixel,
  distanceForScale,
  gridLevels,
  MAX_GRID_LEVELS,
  nearestOrthoView,
  ORTHO_AXES,
  orthoAxesOf,
  orthoFraming,
  orthoPlacementPoint,
  scaleForDistance,
  wheelZoomFactor,
  zoomAtPointer
} from "./orthoView"
import { GRID_SIZES, snapValue } from "./snap"
import { orthoViews } from "./viewLayout"

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
/** The determinant of three directions: +1 for a left-handed frame in game space, -1 for one that's mirrored there. */
const handedness = (a: Vec3, b: Vec3, c: Vec3) =>
  a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)

describe("orthographic views", () => {
  it("looks along the game's axes from the side each is named for", () => {
    const looks = Object.fromEntries(orthoViews.map((view) => [view, axisOf(ORTHO_AXES[view].forward)]))
    assert.deepStrictEqual(looks, {
      top: { axis: "z", positive: false },
      bottom: { axis: "z", positive: true },
      front: { axis: "x", positive: false }, // X is forward: the front faces +X
      back: { axis: "x", positive: true },
      left: { axis: "y", positive: true }, // Y is right: the left side is at -Y, looking toward +Y
      right: { axis: "y", positive: false }
    })
  })

  it("has a left-handed frame in game space, like the game's own forward, right and up", () => {
    assert.strictEqual(handedness(ORTHO_AXES.back.forward, ORTHO_AXES.back.right, ORTHO_AXES.back.up), 1)
    for (const view of orthoViews) {
      const { forward, up, right } = ORTHO_AXES[view]
      assert.strictEqual(dot(forward, up), 0)
      assert.strictEqual(handedness(forward, right, up), 1)
    }
  })

  it("comes out as an unmirrored camera through coords.ts", () => {
    for (const view of orthoViews) {
      const { forward, up, right } = ORTHO_AXES[view]
      // the renderer is right-handed, so the same frame has to flip: any other sign would mirror the map
      assert.strictEqual(handedness(ueToThreeVector(forward), ueToThreeVector(right), ueToThreeVector(up)), -1)
    }
  })

  it("keeps forward up the screen and right to the right looking down from above", () => {
    assert.deepStrictEqual(axisOf(ORTHO_AXES.top.up), { axis: "x", positive: true })
    assert.deepStrictEqual(axisOf(ORTHO_AXES.top.right), { axis: "y", positive: true })
  })

  it("rolls the picture clockwise a quarter turn at a time: what ran up the screen runs to the right", () => {
    // Front: Z up and -Y to the right, upright
    assert.deepStrictEqual(orthoAxesOf("front", 0), ORTHO_AXES.front)
    const once = orthoAxesOf("front", 1)
    assert.deepStrictEqual(axisOf(once.right), { axis: "z", positive: true })
    assert.deepStrictEqual(axisOf(once.up), { axis: "y", positive: true })
    const twice = orthoAxesOf("front", 2)
    assert.deepStrictEqual(axisOf(twice.up), { axis: "z", positive: false })
    assert.deepStrictEqual(axisOf(orthoAxesOf("front", 3).right), { axis: "z", positive: false })
  })

  it("rolls about the view's own direction, never mirroring it", () => {
    for (const view of orthoViews) {
      for (const roll of [0, 1, 2, 3] as const) {
        const { forward, up, right } = orthoAxesOf(view, roll)
        assert.deepStrictEqual(forward, ORTHO_AXES[view].forward)
        assert.strictEqual(dot(forward, up), 0)
        assert.strictEqual(handedness(forward, right, up), 1)
      }
    }
  })

  it("finds the view closest to a direction", () => {
    assert.strictEqual(nearestOrthoView({ x: 0.1, y: 0.2, z: -0.9 }), "top")
    assert.strictEqual(nearestOrthoView({ x: -0.8, y: 0.1, z: 0.3 }), "front")
    assert.strictEqual(nearestOrthoView({ x: 0.3, y: 0.9, z: 0 }), "left")
    assert.strictEqual(nearestOrthoView({ x: 0.3, y: -0.9, z: 0 }), "right")
  })
})

describe("framing an orthographic pane", () => {
  const bounds = { min: { x: -1000, y: -500, z: 100 }, max: { x: 3000, y: 500, z: 300 } }

  it("centres on the bounds", () => {
    assert.deepStrictEqual(orthoFraming(bounds, "top", 800, 600).center, { x: 1000, y: 0, z: 200 })
  })

  it("fits the side that runs out of room first, with a margin", () => {
    // Top: X (4000 cm) up 600 px, Y (1000 cm) across 800 px
    const { cmPerPixel } = orthoFraming(bounds, "top", 800, 600)
    assert.isAbove(cmPerPixel, 4000 / 600)
    assert.isBelow(cmPerPixel, (4000 / 600) * 1.3)
    assert.isAtMost(1000 / cmPerPixel, 800)
  })

  it("measures along the view's own axes", () => {
    // Front: Y (1000 cm) across, Z (200 cm) up
    const { cmPerPixel } = orthoFraming(bounds, "front", 800, 600)
    assert.closeTo(cmPerPixel, (1.15 * 1000) / 800, 1e-9)
  })

  it("measures along a rolled view's axes", () => {
    // Front rolled a quarter turn: Z (200 cm) across, Y (1000 cm) up
    const { cmPerPixel } = orthoFraming(bounds, "front", 800, 600, 0, 1)
    assert.closeTo(cmPerPixel, (1.15 * 1000) / 600, 1e-9)
  })

  it("doesn't let a small piece fill the pane", () => {
    const piece = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }
    assert.closeTo(orthoFraming(piece, "top", 300, 300, 300).cmPerPixel, 1.15, 1e-9)
  })

  it("copes with a pane that has no size yet", () => {
    assert.isTrue(Number.isFinite(orthoFraming(bounds, "top", 0, 0).cmPerPixel))
  })
})

describe("zooming an orthographic pane", () => {
  it("zooms in on a wheel up and out on a wheel down, about 1.2 a notch", () => {
    assert.isBelow(wheelZoomFactor(-120), 1)
    assert.closeTo(wheelZoomFactor(120), 1.2, 0.01)
    assert.closeTo(wheelZoomFactor(120) * wheelZoomFactor(-120), 1, 1e-12)
  })

  it("leaves the point under the pointer where it is", () => {
    const before = 10
    const pointer = { x: 120, y: -40 }
    const zoom = zoomAtPointer(before, 0.5, pointer)
    assert.strictEqual(zoom.cmPerPixel, 5)
    // that point, from the old centre and from the new one
    assert.closeTo(pointer.x * before, zoom.right + pointer.x * zoom.cmPerPixel, 1e-9)
    assert.closeTo(pointer.y * before, zoom.up + pointer.y * zoom.cmPerPixel, 1e-9)
  })

  it("stays put when it can't zoom further", () => {
    const zoom = zoomAtPointer(clampCmPerPixel(1e9), 2, { x: 100, y: 100 })
    assert.strictEqual(zoom.right, 0)
    assert.strictEqual(zoom.up, 0)
  })

  it("matches a perspective pane's distance to the same scale and back", () => {
    const distance = distanceForScale(4, 700, 59)
    assert.closeTo(scaleForDistance(distance, 700, 59), 4, 1e-9)
  })
})

describe("placing a piece in an orthographic pane", () => {
  const center = { x: 123.4, y: -56.7, z: 890.1 }

  it("lands at the pane's centre, on the floor when the pane looks at the floor", () => {
    assert.deepStrictEqual(orthoPlacementPoint(center, "top", 500), { x: 123, y: -57, z: 500 })
    assert.deepStrictEqual(orthoPlacementPoint(center, "bottom", 500), { x: 123, y: -57, z: 500 })
    assert.deepStrictEqual(orthoPlacementPoint(center, "front", 500), { x: 123, y: -57, z: 890 })
  })
})

describe("grid levels", () => {
  const sizes = (cmPerPixel: number, snap?: number) => gridLevels(cmPerPixel, snap).map((level) => level.size)
  const levelAt = (cmPerPixel: number, size: number) => gridLevels(cmPerPixel).find((level) => level.size === size)

  it("shows 1 m lines and 10 m sections at a working zoom, at full strength", () => {
    assert.deepStrictEqual(levelAt(2, 100), { size: 100, opacity: 1, section: false })
    assert.deepStrictEqual(levelAt(2, 1000), { size: 1000, opacity: 1, section: true })
  })

  it("adds finer lines zooming in", () => {
    assert.notInclude(sizes(5), 10)
    assert.include(sizes(0.5), 10)
    assert.include(sizes(0.05), 1)
  })

  it("drops fine lines zooming out, keeping coarser ones", () => {
    assert.notInclude(sizes(50), 100)
    assert.include(sizes(50), 1000)
    assert.isAbove(sizes(5000).length, 0)
  })

  it("fades a level in with its spacing", () => {
    const fading = [10, 5, 3, 1.5].map((cmPerPixel) => levelAt(cmPerPixel, 100)?.opacity ?? 0)
    assert.deepStrictEqual(fading, [...fading].sort((a, b) => a - b))
    assert.isAbove(fading[1] ?? 0, 0)
    assert.isBelow(fading[1] ?? 1, 1)
  })

  it("orders levels finest first and never outgrows the shader's array", () => {
    for (const cmPerPixel of [0.02, 0.5, 2, 50, 5000]) {
      for (const snap of [undefined, ...GRID_SIZES]) {
        const levels = sizes(cmPerPixel, snap)
        assert.deepStrictEqual(levels, [...levels].sort((a, b) => a - b))
        assert.isAtMost(levels.length, MAX_GRID_LEVELS)
      }
    }
  })

  it("draws the snapping grid: every snapped position has a line through it", () => {
    for (const step of GRID_SIZES) {
      assert.include(sizes(step / 40, step), step)
      const snapped = snapValue(1234.5, step)
      const on = gridLevels(step / 40, step).some((level) => Math.abs(snapped % level.size) < 1e-9)
      assert.isTrue(on)
    }
  })
})
