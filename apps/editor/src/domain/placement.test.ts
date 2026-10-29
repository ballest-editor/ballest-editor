import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "./bundledCatalog.json"
import { Catalog } from "./Catalog"
import { footprintOf, pieceFootprint, PLACE_DISTANCE, placeDistanceFor, placementPoint } from "./placement"
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
