import { Schema } from "effect"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { Catalog, indexCatalog } from "../../../apps/web/src/domain/Catalog.ts"
import { MapFile } from "../../../apps/web/src/domain/MapFile.ts"
import { validateMap } from "../../../apps/web/src/domain/validateMap.ts"
import { buildablePieces, buildMap, loadedPieces, pieceChanges, summaryOf, VerifiedPieces } from "./maps.ts"

const read = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8")

const catalog = Schema.decodeSync(Schema.fromJsonString(Catalog))(read("assets/catalog.json"))
const index = indexCatalog(catalog)
const pieces = buildablePieces(
  catalog.pieces,
  loadedPieces(Schema.decodeSync(VerifiedPieces)(read("assets/verified.json")))
)
const build = (items: number, seed = 1) => buildMap({ name: "Test", creator: "Seed", items, seed, pieces })

describe("buildMap", () => {
  it("makes a map the game would load, however large", () => {
    expect(pieces.length).toBeGreaterThan(0)
    for (const items of [0, 20, 5000]) expect(validateMap(build(items), index).errors).toEqual([])
  })

  it("adds the items to the player start and goal", () => {
    expect(build(20).items).toHaveLength(22)
  })

  it("builds the same map from the same seed, and another from another", () => {
    expect(build(50)).toEqual(build(50))
    expect(build(50)).not.toEqual(build(50, 2))
  })

  it("survives the round trip through the map schema", () => {
    const map = build(20)
    const encoded = Schema.encodeSync(MapFile)(map)
    expect(Schema.decodeSync(MapFile)(encoded)).toEqual(map)
  })
})

describe("summaryOf", () => {
  it("counts the items and knows every built piece", () => {
    const summary = summaryOf(build(20), 1000, index)
    expect(summary.items).toBe(22)
    expect(summary.unknownPieces).toEqual([])
    expect(summary.topPieces.length).toBeGreaterThan(0)
    expect(summary.extent?.max.x).toBeGreaterThan(summary.extent?.min.x ?? Infinity)
  })
})

describe("pieceChanges", () => {
  it("says nothing of equal maps", () => {
    expect(pieceChanges(build(20), build(20))).toEqual([])
  })

  it("adds up to the difference in items", () => {
    const total = pieceChanges(build(20), build(30)).reduce((sum, { count }) => sum + count, 0)
    expect(total).toBe(10)
  })
})
