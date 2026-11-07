import { Schema } from "effect"
import { assert, describe, it } from "vitest"
import { readJson } from "./readJson.ts"

const Row = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  names: Schema.optionalKey(Schema.Array(Schema.String)),
  label: Schema.String,
  max: Schema.optionalKey(Schema.Finite),
  typedMax: Schema.optionalKey(Schema.Finite)
})
const Panel = Schema.Struct({
  rowSets: Schema.Record(Schema.String, Schema.Array(Row)),
  pieces: Schema.Record(Schema.String, Schema.Struct({ rows: Schema.optionalKey(Schema.String) }))
})
const Catalog = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    className: Schema.String,
    inPalette: Schema.optionalKey(Schema.Boolean),
    properties: Schema.Array(Schema.Struct({
      name: Schema.String,
      hidden: Schema.optionalKey(Schema.Boolean),
      label: Schema.optionalKey(Schema.String)
    }))
  }))
})

const panel = readJson(Panel, "panel.json")
const catalog = readJson(Catalog, "..", "..", "assets", "catalog.json")

/** The flags and surface a panel offers with its own controls, not with rows. */
const CONTROLS = new Set(["bMirror", "bMirrorX", "PhysicsFlip", "SurfaceAssignment"])

const rowNames = (className: string): ReadonlySet<string> => {
  const rows = panel.rowSets[panel.pieces[className]?.rows ?? ""] ?? []
  return new Set(rows.flatMap((r) => r.names ?? (r.name === undefined ? [] : [r.name])))
}

describe("panel.json", () => {
  it("covers every palette piece", () => {
    const missing = catalog.pieces.filter((p) => p.inPalette === true && !(p.className in panel.pieces))
    assert.deepStrictEqual(missing.map((p) => p.className), [])
  })

  it("names only classes the catalog has and row sets it defines", () => {
    const classes = new Set(catalog.pieces.map((p) => p.className))
    const entries = Object.entries(panel.pieces)
    assert.deepStrictEqual(entries.filter(([className]) => !classes.has(className)), [])
    assert.deepStrictEqual(entries.filter(([, e]) => e.rows !== undefined && !(e.rows in panel.rowSets)), [])
  })

  it("keeps a typed limit past the slider's, never inside it", () => {
    const rows = Object.values(panel.rowSets).flat().filter((r) => r.typedMax !== undefined)
    assert.isAbove(rows.length, 0)
    assert.deepStrictEqual(rows.filter((r) => (r.typedMax ?? 0) <= (r.max ?? Infinity)), [])
  })

  it("reaches the catalog: a row's property carries its label, and nothing else is offered", () => {
    const measured = catalog.pieces.filter((p) => p.className in panel.pieces)
    const shown = measured.flatMap((piece) => {
      const names = rowNames(piece.className)
      const unlabelled = [...names].filter((name) => {
        const property = piece.properties.find((p) => p.name === name)
        return property?.label === undefined || property.hidden === true
      })
      const offered = piece.properties.filter((p) => !names.has(p.name) && !CONTROLS.has(p.name) && p.hidden !== true)
      return [...unlabelled, ...offered.map((p) => p.name)].map((name) => `${piece.className} ${name}`)
    })
    assert.deepStrictEqual(shown, [])
  })
})
