// tools/extract/connectors.json against assets/catalog.json: what was measured in game reaches the catalog unchanged.
import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { readJson } from "./readJson.ts"

const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

const End = Schema.Struct({
  position: Vector,
  forward: Vector,
  up: Vector,
  profile: Schema.String,
  hand: Schema.optionalKey(Schema.Literals(["left", "right"]))
})

const Measured = Schema.Struct({
  game: Schema.String,
  measured: Schema.String,
  method: Schema.String,
  pieces: Schema.Record(Schema.String, Schema.Array(End))
})

const Catalog = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    className: Schema.String,
    connectors: Schema.optionalKey(Schema.Array(End))
  }))
})

const measured = readJson(Measured, "connectors.json")
const catalog = readJson(Catalog, "..", "..", "assets", "catalog.json")

const length = ([x, y, z]: typeof Vector.Type) => Math.hypot(x, y, z)
const dot = (a: typeof Vector.Type, b: typeof Vector.Type) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe("connectors.json", () => {
  it("is what the catalog holds, and only that", () => {
    const inCatalog = catalog.pieces.flatMap((p) => p.connectors === undefined ? [] : [[p.className, p.connectors]])
    assert.deepStrictEqual(Object.fromEntries(inCatalog), measured.pieces)
  })

  it("names classes the catalog has", () => {
    const classes = new Set(catalog.pieces.map((p) => p.className))
    assert.deepStrictEqual(Object.keys(measured.pieces).filter((name) => !classes.has(name)), [])
  })

  it("gives every end unit directions, square to each other", () => {
    for (const end of Object.values(measured.pieces).flat()) {
      assert.closeTo(length(end.forward), 1, 1e-5)
      assert.closeTo(length(end.up), 1, 1e-5)
      assert.closeTo(dot(end.forward, end.up), 0, 1e-5)
    }
  })
})
