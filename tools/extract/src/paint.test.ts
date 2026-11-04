import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { paintOf } from "./materials.ts"

const repo = path.resolve(import.meta.dirname, "..", "..", "..")
const read = <S extends Schema.Decoder<unknown>>(schema: S, ...parts: ReadonlyArray<string>) =>
  Schema.decodeUnknownSync(schema)(JSON.parse(fs.readFileSync(path.join(repo, ...parts), "utf8")))

const Measured = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    classPath: Schema.String,
    slots: Schema.Finite,
    offPanel: Schema.optionalKey(Schema.Array(Schema.Finite))
  }))
})
const CatalogFile = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    objectPath: Schema.String,
    inPalette: Schema.Boolean,
    paintable: Schema.Boolean,
    offPanelPaint: Schema.optionalKey(Schema.Array(Schema.Finite)),
    materialSlots: Schema.Array(Schema.Unknown)
  }))
})
const MaterialsFile = Schema.Struct({
  paint: Schema.Array(Schema.Struct({
    name: Schema.String,
    colors: Schema.Array(Schema.Struct({ displayColor: Schema.optionalKey(Schema.Array(Schema.Finite)) }))
  }))
})

const COLOR = "EBallestMaterialColors::NewEnumerator"
const colors = (...keys: ReadonlyArray<number>) =>
  keys.map((k) => ({
    Key: `${COLOR}${k}`,
    Value: { ObjectName: `MaterialInstanceConstant'MI_${k}'`, ObjectPath: `/Game/MI_${k}.0` }
  }))
const shown = (key: number, r: number) => ({ Key: `${COLOR}${key}`, Value: { R: r, G: 0, B: 0, A: 1 } })
const names = (...entries: ReadonlyArray<readonly [number, string]>) =>
  entries.map(([k, name]) => ({ Key: `NewEnumerator${k}`, Value: { CultureInvariantString: name } }))

const dump = {
  packages: {
    enums: [
      { Name: "EBallestMaterialCategories", Properties: { DisplayNameMap: names([0, "smooth"], [6, "special"]) } },
      {
        Name: "EBallestMaterialColors",
        Properties: {
          DisplayNameMap: names([0, "White"], [2, "Grey"], [12, "Iron"], [13, "Copper"], [14, "Aluminum"], [
            15,
            "Concrete"
          ])
        }
      }
    ],
    library: [{
      Name: "MaterialCategories_Library",
      Properties: {
        BallestMaterialCategories: [
          { ObjectName: "PDA_MaterialCategory_C'MaterialCategory_Smooth'" },
          { ObjectName: "PDA_MaterialCategory_C'MaterialCategory_Special'" }
        ]
      }
    }],
    defaults: [{
      Name: "Default__PDA_MaterialCategory_C",
      Properties: { ColorColorMap: [shown(0, 0.5), shown(2, 0.25)] }
    }],
    smooth: [{ Name: "MaterialCategory_Smooth", Properties: { ColorMaterialMap: colors(0) } }],
    special: [{
      Name: "MaterialCategory_Special",
      Properties: {
        MaterialCategory: "EBallestMaterialCategories::NewEnumerator6",
        ColorMaterialMap: colors(14, 13, 12, 15, 2),
        ColorColorMap: [shown(2, 0.75)]
      }
    }]
  }
}

describe("the paint picker", () => {
  const [smooth, special] = paintOf(dump)

  it("takes swatch colours from the category, else from the category class default", () => {
    expect(smooth?.colors[0]?.displayColor).toEqual([0.5, 0, 0])
    expect(special?.colors.find((c) => c.color === "Grey")?.displayColor).toEqual([0.75, 0, 0])
  })

  it("lists special's swatches in the game's order, not the cooked map's", () => {
    expect(special?.colors.map((c) => c.color)).toEqual(["Grey", "Concrete", "Iron", "Copper", "Aluminum"])
  })
})

// What the game's details panel showed for each piece on 0.4.1 (tools/extract/paint-measured.json, docs/qa/materials.md).
describe("the catalog against the game", () => {
  const measured = read(Measured, "tools", "extract", "paint-measured.json").pieces
  const pieces = read(CatalogFile, "assets", "catalog.json").pieces
  const byPath = new Map(measured.map((m) => [m.classPath, m]))

  it("has a measurement for every palette piece", () => {
    const missing = pieces.filter((p) => p.inPalette && !byPath.has(p.objectPath)).map((p) => p.objectPath)
    expect(missing).toEqual([])
  })

  it("agrees with the game on which pieces take paint and how many slots they show", () => {
    const wrong = pieces.flatMap((p) => {
      const game = byPath.get(p.objectPath)
      if (game === undefined) return []
      const ours = p.paintable ? p.materialSlots.length : 0
      return ours === game.slots ? [] : [{ piece: p.objectPath, ours, game: game.slots }]
    })
    expect(wrong).toEqual([])
  })

  it("carries the measured off-panel slots, on locked pieces, within their slots", () => {
    const wrong = pieces.filter((p) => {
      const slots = p.offPanelPaint ?? []
      return String(slots) !== String(byPath.get(p.objectPath)?.offPanel ?? [])
        || (slots.length > 0 && p.paintable)
        || slots.some((slot) => slot >= p.materialSlots.length)
    }).map((p) => p.objectPath)
    expect(wrong).toEqual([])
  })

  it("offers the picker the game does: seven finishes, every swatch with the game's colour", () => {
    const { paint } = read(MaterialsFile, "assets", "materials.json")
    expect(paint.map((f) => f.name)).toEqual([
      "smooth",
      "rough",
      "glossy",
      "concrete",
      "tiled",
      "emissive",
      "special"
    ])
    const swatches = paint.flatMap((f) => f.colors)
    expect(swatches).toHaveLength(65)
    expect(swatches.filter((c) => c.displayColor === undefined)).toEqual([])
  })
})
