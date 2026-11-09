// tools/extract/connectors.json against assets/catalog.json: the ends the survey read off the meshes reach the catalog
// unchanged. connectorMeshes.test.ts holds them against the meshes.
import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { ConnectorsFile, End, type Vector } from "./connectorsFile.ts"
import { readJson } from "./readJson.ts"

const Catalog = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    className: Schema.String,
    connectors: Schema.optionalKey(Schema.Array(End))
  }))
})

const measured = readJson(ConnectorsFile, "connectors.json")
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

  it("gives a profile's ends a hand on all of them or none", () => {
    const ends = Object.values(measured.pieces).flat()
    const handed = new Set(ends.filter((end) => end.hand !== undefined).map((end) => end.profile))
    assert.deepStrictEqual(ends.filter((end) => handed.has(end.profile) !== (end.hand !== undefined)), [])
  })
})
