import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Connector } from "./Catalog"
import { defaultSpotOf, SPOT_IDS, spotPosition, spotsOf } from "./connectorSpots"

const rounded = (point: ReadonlyArray<number>) => point.map((v) => Math.round(v * 1000) / 1000 + 0)

/** Track S's front end: a 500 by 100 cap whose middle is 50 cm under the end, which sits on its top. */
const TRACK = {
  position: [250, 0, 50],
  forward: [1, 0, 0],
  up: [0, 0, 1],
  cap: { shape: "rect", width: 500, height: 100, centre: [250, 0, 0] }
} as const

/** A tube's end, anchored on its middle. */
const TUBE = {
  position: [0, 400, 0],
  forward: [0, 1, 0],
  up: [0, 0, 1],
  cap: { shape: "annulus", radius: 200, innerRadius: 180 }
} as const

describe("connector spots", () => {
  it("gives a rectangle its corners, the middles of its sides and its centre, left along forward × up", () => {
    const spots = spotsOf(TRACK)
    assert.deepStrictEqual(spots.map(({ id }) => id), [...SPOT_IDS])
    assert.deepStrictEqual(spots.map(({ name }) => name), [
      "Top left",
      "Top",
      "Top right",
      "Left",
      "Center",
      "Right",
      "Bottom left",
      "Bottom",
      "Bottom right"
    ])
    // looking out along +X with +Z up, +Y is to the right
    const at = (id: string) => spots.find((spot) => spot.id === id)?.position ?? []
    assert.deepStrictEqual(rounded(at("topLeft")), [250, -250, 50])
    assert.deepStrictEqual(rounded(at("top")), [250, 0, 50])
    assert.deepStrictEqual(rounded(at("topRight")), [250, 250, 50])
    assert.deepStrictEqual(rounded(at("centre")), [250, 0, 0])
    assert.deepStrictEqual(rounded(at("bottomRight")), [250, 250, -50])
  })

  it("gives a circle or a ring its rim's four cardinal points and its centre", () => {
    const spots = spotsOf(TUBE)
    assert.deepStrictEqual(spots.map(({ id }) => id), ["top", "left", "centre", "right", "bottom"])
    const at = (id: string) => spots.find((spot) => spot.id === id)?.position ?? []
    assert.deepStrictEqual(rounded(at("top")), [0, 400, 200])
    assert.deepStrictEqual(rounded(at("bottom")), [0, 400, -200])
    // looking out along +Y with +Z up, +X is to the left
    assert.deepStrictEqual(rounded(at("left")), [200, 400, 0])
    assert.deepStrictEqual(rounded(at("right")), [-200, 400, 0])
    assert.deepStrictEqual(rounded(at("centre")), [0, 400, 0])
  })

  it("offers nothing on an end without a cap", () => {
    assert.deepStrictEqual(spotsOf({ position: [0, 0, 0], forward: [1, 0, 0], up: [0, 0, 1] }), [])
    assert.strictEqual(defaultSpotOf({ position: [0, 0, 0], forward: [1, 0, 0], up: [0, 0, 1] }), undefined)
  })

  it("defaults to the spot at the measured point: a track's Top, a tube's Centre", () => {
    assert.strictEqual(defaultSpotOf(TRACK), "top")
    assert.strictEqual(defaultSpotOf(TUBE), "centre")
  })

  it("moves an end's point to the chosen spot, and leaves it with none or one its cap lacks", () => {
    assert.deepStrictEqual(rounded(spotPosition(TRACK, "bottomLeft")), [250, -250, -50])
    assert.deepStrictEqual(rounded(spotPosition(TRACK, undefined)), [250, 0, 50])
    assert.deepStrictEqual(rounded(spotPosition(TUBE, "topLeft")), [0, 400, 0])
  })

  it("has every measured end's point as one of its spots", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../tools/extract/connectors.json")
    const Survey = Schema.fromJsonString(
      Schema.Struct({ pieces: Schema.Record(Schema.String, Schema.Array(Connector)) })
    )
    const { pieces } = Schema.decodeSync(Survey)(readFileSync(file, "utf8"))
    const missing = Object.entries(pieces).flatMap(([piece, ends]) =>
      ends.flatMap((end, i) => end.cap === undefined || defaultSpotOf(end) !== undefined ? [] : [`${piece} end ${i}`])
    )
    assert.deepStrictEqual(missing, [])
  })
})
