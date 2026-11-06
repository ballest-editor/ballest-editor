import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "./bundledCatalog.json"
import { Catalog } from "./Catalog"
import {
  footprintOf,
  nextInRun,
  pieceFootprint,
  PLACE_DISTANCE,
  placeDistanceFor,
  PLACEMENT_COLUMNS,
  PLACEMENT_GAP,
  placementPoint,
  type PlacementRun,
  type PlacementView,
  runPoint,
  startPlacementRun,
  wouldLandOn
} from "./placement"
import { rotatorToQuat } from "./ueMath"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
const pieceNamed = (className: string) => catalog.pieces.find((p) => p.className === className)!
const unrotated = { rotation: { x: 0, y: 0, z: 0, w: 1 }, scale3D: { x: 1, y: 1, z: 1 } }

const eye = { x: 0, y: 0, z: 500 }
const distance = (p: { x: number; y: number; z: number }) => Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z)
/** Floor at z = 0 and the default cap. */
const place = (origin: typeof eye, direction: typeof eye) => placementPoint(origin, direction, 0, PLACE_DISTANCE)

describe("placementPoint", () => {
  it("lands on the floor when the floor is within the cap", () => {
    assert.deepStrictEqual(place(eye, { x: 0, y: 0, z: -1 }), { x: 0, y: 0, z: 0 })
    assert.deepStrictEqual(place(eye, { x: 1, y: 0, z: -1 }), { x: 500, y: 0, z: 0 })
  })

  it("lands on a raised floor such as the player start's height", () => {
    const high = { x: 0, y: 0, z: 9115 }
    assert.deepStrictEqual(placementPoint(high, { x: 1, y: 0, z: -1 }, 8615, PLACE_DISTANCE), {
      x: 500,
      y: 0,
      z: 8615
    })
    // The world origin's plane is 86 m below: out of reach, so the cap applies.
    assert.deepStrictEqual(placementPoint(high, { x: 0, y: 0, z: -1 }, 0, PLACE_DISTANCE), {
      x: 0,
      y: 0,
      z: 9115 - PLACE_DISTANCE
    })
  })

  it("stops at the cap along the ray when the floor hit is further", () => {
    // Nearly level: the floor is ~57 m away.
    const p = place(eye, { x: 1, y: 0, z: -0.0875 })
    assert.isAtMost(Math.abs(distance(p) - PLACE_DISTANCE), 1)
    assert.isAbove(p.z, 0)
    assert.isAtMost(Math.abs(p.z - (eye.z - 0.0875 * p.x)), 1)
  })

  it("stops at the cap when looking level or up", () => {
    assert.deepStrictEqual(place(eye, { x: 0, y: 2, z: 0 }), { x: 0, y: PLACE_DISTANCE, z: 500 })
    assert.deepStrictEqual(place(eye, { x: 3, y: 0, z: 4 }), { x: 1200, y: 0, z: 2100 })
  })

  it("hits the floor from below and honours a custom cap", () => {
    const below = { x: 0, y: 0, z: -300 }
    assert.deepStrictEqual(place(below, { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: 0 })
    assert.deepStrictEqual(placementPoint(below, { x: 0, y: 0, z: 1 }, 0, 100), { x: 0, y: 0, z: -200 })
    assert.deepStrictEqual(placementPoint(eye, { x: 1, y: 0, z: -1 }, 0, 5000), { x: 500, y: 0, z: 0 })
  })

  it("returns whole centimetres without -0", () => {
    const p = place({ x: -0.2, y: 0.4, z: 0 }, { x: 0, y: 0, z: 1 })
    assert.isFalse(Object.is(p.x, -0))
    assert.deepStrictEqual(p, { x: 0, y: 0, z: 0 })
  })
})

describe("footprintOf", () => {
  // Bevel_T Ring's bounds: a 17.7 m ring on top of a ~70 m column.
  const ring = { min: [-887, -887, -7061], max: [887, 887, 118] } as const

  it("is the longer horizontal side and ignores height", () => {
    assert.strictEqual(footprintOf(ring, unrotated), 1774)
    assert.strictEqual(footprintOf({ min: [0, -100, 0], max: [300, 100, 5000] }, unrotated), 300)
  })

  it("applies the transform's scale and rotation", () => {
    const scaled = { ...unrotated, scale3D: { x: 2, y: 1, z: 1 } }
    assert.strictEqual(footprintOf({ min: [0, 0, 0], max: [300, 100, 10] }, scaled), 600)
    // Pitched 90°, the ring's column lies along X.
    const pitched = { ...unrotated, rotation: rotatorToQuat({ pitch: 90, yaw: 0, roll: 0 }) }
    assert.closeTo(footprintOf(ring, pitched), 7179, 1)
  })

  it("measures a catalog piece as the palette places it", () => {
    assert.strictEqual(pieceFootprint(pieceNamed("BP_Prim_Cube")), 1000)
    // The player start is placed at the game's 0.2765 scale.
    assert.closeTo(pieceFootprint(pieceNamed("MP_PlayerStart")), 276.5, 0.5)
  })
})

describe("placeDistanceFor", () => {
  const fov = Math.PI / 3

  it("keeps the base cap for pieces that fit", () => {
    assert.strictEqual(placeDistanceFor(0, fov), PLACE_DISTANCE)
    assert.strictEqual(placeDistanceFor(1000, fov), PLACE_DISTANCE)
    assert.strictEqual(placeDistanceFor(1000, fov, 3500), 3500)
  })

  it("backs off so a big footprint covers 60% of the view angle", () => {
    const d = placeDistanceFor(1774, fov)
    assert.isAbove(d, PLACE_DISTANCE)
    assert.closeTo((2 * Math.atan(1774 / 2 / d)) / fov, 0.6, 0.05)
    assert.isAbove(placeDistanceFor(1774, fov / 2), d)
  })
})

describe("placement runs", () => {
  /** Looking along +X and down: right is +Y, and up leans towards +X. */
  const down: PlacementView = {
    position: { x: 0, y: 0, z: 2000 },
    right: { x: 0, y: 1, z: 0 },
    up: { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }
  }
  /** Looking level along +X: up has nothing horizontal in it. */
  const level: PlacementView = { ...down, up: { x: 0, y: 0, z: 1 } }
  const start = { x: 2000, y: 0, z: 0 }
  /** A 1000 cm cube standing on `at`. */
  const cubeAt = (at: { x: number; y: number; z: number }) => ({
    min: { x: at.x - 500, y: at.y - 500, z: at.z },
    max: { x: at.x + 500, y: at.y + 500, z: at.z + 1000 }
  })
  const steps = (count: number, view: PlacementView, gridSize = 10) => {
    const runs: Array<PlacementRun> = [startPlacementRun(start)]
    for (let i = 0; i < count; i++) {
      const run = runs.at(-1)!
      runs.push(nextInRun(run, cubeAt(runPoint(run, view)), 1000, view, gridSize))
    }
    return runs
  }

  it("starts on the point it was given", () => {
    assert.deepStrictEqual(runPoint(startPlacementRun(start), down), start)
  })

  it("steps along the view's right by the width and the gap", () => {
    const [, second, third] = steps(2, down).map((run) => runPoint(run, down))
    assert.deepStrictEqual(second, { ...start, y: 1000 + PLACEMENT_GAP })
    assert.deepStrictEqual(third, { ...start, y: 2 * (1000 + PLACEMENT_GAP) })
  })

  it("follows the view's right when the camera has turned", () => {
    const turned = { ...down, right: { x: 0, y: -1, z: 0 }, up: { x: -Math.SQRT1_2, y: 0, z: Math.SQRT1_2 } }
    assert.deepStrictEqual(runPoint(steps(1, turned)[1]!, turned), { ...start, y: -1100 })
  })

  it("rounds a step up to the grid size, so the gap never closes", () => {
    assert.deepStrictEqual(runPoint(steps(1, down, 250)[1]!, down), { ...start, y: 1250 })
    assert.deepStrictEqual(runPoint(steps(1, down, 1000)[1]!, down), { ...start, y: 2000 })
  })

  it("clears the wider of two pieces", () => {
    const wide = { min: { x: 1000, y: -1000, z: 0 }, max: { x: 3000, y: 1000, z: 100 } }
    assert.strictEqual(nextInRun(startPlacementRun(start), wide, 100, down, 10).along, 2100)
    assert.strictEqual(nextInRun(startPlacementRun(start), cubeAt(start), 3000, down, 10).along, 3100)
  })

  it("wraps to a new row along the floor after a few", () => {
    const points = steps(PLACEMENT_COLUMNS + 1, down).map((run) => runPoint(run, down))
    assert.deepStrictEqual(points[PLACEMENT_COLUMNS], { x: 3100, y: 0, z: 0 })
    assert.deepStrictEqual(points[PLACEMENT_COLUMNS + 1], { x: 3100, y: 1100, z: 0 })
  })

  it("wraps upward in a level view, where there is no floor ahead", () => {
    const row = steps(PLACEMENT_COLUMNS, level).at(-1)!
    assert.deepStrictEqual(runPoint(row, level), { ...start, z: 1100 })
  })

  it("stands a row off by the deepest piece before it", () => {
    const deep = { min: { x: 1000, y: -50, z: 0 }, max: { x: 5000, y: 50, z: 100 } }
    const last = { ...startPlacementRun(start), column: PLACEMENT_COLUMNS - 1, depth: 4000 }
    assert.strictEqual(nextInRun(last, cubeAt(start), 1000, down, 10).across, 4100)
    assert.strictEqual(nextInRun({ ...last, depth: 0 }, deep, 1000, down, 10).across, 4100)
  })

  it("lands on a box seen at the same spot on screen, at any depth or height", () => {
    const box = cubeAt(start)
    assert.isTrue(wouldLandOn(start, 100, box, down))
    assert.isTrue(wouldLandOn({ ...start, z: 900 }, 100, box, down))
    assert.isTrue(wouldLandOn({ ...start, x: 2540 }, 100, box, down), "its half width reaches the box")
    assert.isFalse(wouldLandOn({ ...start, x: 2560 }, 100, box, down))
    assert.isFalse(wouldLandOn({ ...start, y: -600 }, 100, box, down))
    assert.isTrue(wouldLandOn({ ...start, x: 9000 }, 100, box, level), "a level view can't see the depth")
    assert.isFalse(wouldLandOn({ ...start, z: 1100 }, 100, box, level))
  })
})
