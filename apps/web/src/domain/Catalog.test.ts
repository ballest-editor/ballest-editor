/**
 * Checks against the real extractor output (skipped when assets/catalog.json is absent):
 * the catalog decodes, covers every class used in the samples, and items built from it
 * look like the ones the game saved.
 */
import { assert, describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { listSamples, readSample, repoRoot } from "../test/samples"
import { Catalog, HIDDEN_SECTION, indexCatalog, paletteSections, unavailableReasonOf, visibleExtras } from "./Catalog"
import { itemFromPiece, placementTransform, qualifyMaterialPath } from "./factory"
import { PROPERTY_LISTS } from "./itemProperties"
import { Item, MapFile, objectPathOf } from "./MapFile"

const catalogPath = path.join(repoRoot, "assets", "catalog.json")
const hasCatalog = fs.existsSync(catalogPath)
const load = () => Schema.decodeSync(Schema.fromJsonString(Catalog))(fs.readFileSync(catalogPath, "utf8"))

const decodeSample = Schema.decodeSync(Schema.fromJsonString(MapFile))
const sampleItems = () => listSamples().flatMap((s) => decodeSample(readSample(s)).items)

describe.skipIf(!hasCatalog)("assets/catalog.json", () => {
  it("decodes and keeps unknown keys", () => {
    const raw = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ units: Schema.Unknown })))(
      fs.readFileSync(catalogPath, "utf8")
    )
    const catalog = load()
    assert.isAbove(catalog.pieces.length, 0)
    assert.deepStrictEqual(catalog["units"], raw.units)
  })

  it("has a piece for every class in the samples", () => {
    const { pieceByClass } = indexCatalog(load())
    const missing = new Set(sampleItems().map((i) => i.actorToSpawn).filter((c) => !pieceByClass.has(c)))
    assert.deepStrictEqual([...missing], [])
  })

  it("builds a schema-valid item from every piece", () => {
    for (const piece of load().pieces) {
      const item = itemFromPiece(piece, placementTransform(piece, { x: 0, y: 0, z: 0 }))
      assert.doesNotThrow(() => Schema.decodeSync(Item)(item))
    }
  })

  it("emits mesh components and default scales like the game for sample-verified classes", () => {
    const catalog = load()
    const byName = (n: string) => catalog.pieces.find((p) => p.className === n)!
    const vent = byName("MP_AirVent")
    const ventItem = itemFromPiece(vent, placementTransform(vent, { x: 0, y: 0, z: 0 }))
    const sampleVent = sampleItems().find((i) => i.actorToSpawn === vent.classPath)!
    assert.deepStrictEqual(ventItem.meshComponents, sampleVent.meshComponents)
    assert.deepStrictEqual(ventItem.itemTransform.scale3D, sampleVent.itemTransform.scale3D)
    // the sample vent is unedited: the extracted defaults are exactly what the game saves
    for (const list of PROPERTY_LISTS) assert.deepStrictEqual(ventItem[list], sampleVent[list])
    assert.isAbove(visibleExtras(vent).length, 0)
    const checkpoint = byName("BP_Checkpoint")
    assert.deepStrictEqual(placementTransform(checkpoint, { x: 0, y: 0, z: 0 }).scale3D, { x: 1.5, y: 1.5, z: 1.5 })
  })

  it("lists the properties sample items carry, in the order the game writes them", () => {
    const { pieceByClass } = indexCatalog(load())
    const names = (entries: ReadonlyArray<{ readonly propertyName: string }>) => entries.map((p) => p.propertyName)
    for (const item of sampleItems()) {
      const known = pieceByClass.get(item.actorToSpawn)?.properties ?? []
      for (const list of PROPERTY_LISTS) {
        assert.deepStrictEqual(names(item[list]), known.filter((p) => p.list === list).map((p) => p.name))
        for (const entry of item[list]) {
          assert.strictEqual(entry.propertyType, known.find((p) => p.name === entry.propertyName)?.type)
        }
      }
    }
  })

  it("groups the palette in the in-game category order, then Hidden; unresolved pieces are unavailable", () => {
    const catalog = load()
    const sections = paletteSections(catalog.pieces)
    const names = sections.map((s) => s.name)
    expect(names.at(-1)).toBe(HIDDEN_SECTION)
    // categories appear in the order the catalog lists them (the in-game browser order)
    const firstSeen = [
      ...new Set(catalog.pieces.filter((p) => p.inPalette !== false && p.category).map((p) => p.category!))
    ]
    expect(names.slice(0, firstSeen.length)).toEqual(firstSeen)
    const visible = sections.filter((s) => !s.hidden).flatMap((s) => s.pieces)
    const hidden = sections.find((s) => s.hidden)!.pieces
    expect(visible.length + hidden.length).toBe(catalog.pieces.length)
    expect(hidden.every((p) => p.inPalette === false)).toBe(true)
    // every palette piece is placeable; unavailable ones (e.g. unresolved base classes) are only in Hidden
    expect(visible.filter((p) => unavailableReasonOf(indexCatalog(catalog), p) !== undefined)).toEqual([])
    const unavailable = hidden.filter((p) => unavailableReasonOf(indexCatalog(catalog), p) !== undefined).map((p) =>
      p.className
    )
    expect(unavailable.length).toBe((catalog.unresolved ?? []).length)
    // extras-only pieces stay placeable
    const extrasOnly = new Set(["MP_OrangeSign", "MP_PinballPaddle", "BP_CircularFlexiblePlatform"])
    for (const piece of catalog.pieces.filter((p) => extrasOnly.has(p.className))) {
      expect(unavailableReasonOf(indexCatalog(catalog), piece)).toBeUndefined()
      expect(visibleExtras(piece).length).toBeGreaterThan(0)
    }
  })

  // assets/pieces/ is git-ignored extractor output (`nix run .#extract`); absent in CI.
  const hasPieces = fs.existsSync(path.join(repoRoot, "assets", "pieces"))
  it.skipIf(!hasPieces)("every glb referenced by the catalog index exists on disk", () => {
    const { meshes } = indexCatalog(load())
    const missing = [...meshes.values()]
      .filter((m) => m.glb !== undefined && !fs.existsSync(path.join(repoRoot, "assets", m.glb)))
      .map((m) => m.glb)
    assert.deepStrictEqual(missing, [])
  })
})

describe("material paths", () => {
  it("qualifyMaterialPath inverts objectPathOf for every material in the samples", () => {
    const materials = new Set(
      sampleItems().flatMap((i) => i.meshComponents.flatMap((m) => m.materials.map((x) => x.material)))
    )
    for (const material of materials) assert.strictEqual(qualifyMaterialPath(objectPathOf(material)), material)
  })
})
