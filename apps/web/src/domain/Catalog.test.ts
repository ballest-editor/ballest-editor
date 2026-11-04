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
import { defaultProperties, PROPERTY_LISTS } from "./itemProperties"
import { Item, MapFile, objectPathOf, type PropertyList } from "./MapFile"

const catalogPath = path.join(repoRoot, "assets", "catalog.json")
const hasCatalog = fs.existsSync(catalogPath)
const load = () => Schema.decodeSync(Schema.fromJsonString(Catalog))(fs.readFileSync(catalogPath, "utf8"))

const decodeSample = Schema.decodeSync(Schema.fromJsonString(MapFile))
const sampleItems = () => listSamples().flatMap((s) => decodeSample(readSample(s)).items)
/** Untouched items of every class the game can load, as a 0.4.1 game saves them (docs/qa/exposed-properties.md). */
const probeItems = () =>
  listSamples().filter((s) => /(palette|hidden) probe/.test(s.name)).flatMap((s) => decodeSample(readSample(s)).items)

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
    const savedVent = probeItems().find((i) => i.actorToSpawn === vent.classPath)!
    assert.deepStrictEqual(ventItem.meshComponents, sampleVent.meshComponents)
    assert.deepStrictEqual(ventItem.itemTransform.scale3D, sampleVent.itemTransform.scale3D)
    // the sample vent is unedited: the extracted defaults are exactly what the game saves
    for (const list of PROPERTY_LISTS) assert.deepStrictEqual(ventItem[list], savedVent[list])
    assert.isAbove(visibleExtras(vent).length, 0)
    const checkpoint = byName("BP_Checkpoint")
    assert.deepStrictEqual(placementTransform(checkpoint, { x: 0, y: 0, z: 0 }).scale3D, { x: 1.5, y: 1.5, z: 1.5 })
  })

  it("places every class with the property lists the game saves for it untouched", () => {
    const { pieceByClass } = indexCatalog(load())
    const entries = probeItems()
    assert.isAbove(entries.length, 230)
    for (const saved of entries) {
      const piece = pieceByClass.get(saved.actorToSpawn)
      if (piece === undefined) continue
      const fresh = defaultProperties(piece)
      for (const list of PROPERTY_LISTS) {
        const shape = (
          entry: { readonly propertyName: string; readonly currentValue: unknown }
        ) => [entry.propertyName, entry.currentValue]
        assert.deepStrictEqual(fresh[list].map(shape), saved[list].map(shape), `${piece.className} ${list}`)
      }
    }
  })

  it("starts every new light with shadows off, in the layout the game saves, and nothing else differs", () => {
    const catalog = load()
    const shadows = (properties: Pick<Item, "boolProperties">) =>
      properties.boolProperties.find((p) => p.propertyName === "bLightCastsShadows")?.currentValue
    const lights = catalog.pieces.filter((piece) => shadows(defaultProperties(piece)) !== undefined)
    assert.deepStrictEqual(lights.map((p) => p.className).sort(), [
      "MP_PointLightFixture",
      "MP_RawPointLight",
      "MP_RawRectLight",
      "MP_RawSpotLight",
      "MP_SpotLightFixture"
    ])
    for (const piece of catalog.pieces) {
      const classDefaults = defaultProperties(piece)
      const placed = itemFromPiece(piece, placementTransform(piece, { x: 0, y: 0, z: 0 }))
      if (lights.includes(piece)) {
        assert.isTrue(shadows(classDefaults), piece.className)
        assert.isFalse(shadows(placed), piece.className)
      }
      const rest = (properties: Pick<Item, PropertyList>, list: PropertyList) =>
        properties[list].map((p) =>
          p.propertyName === "bLightCastsShadows"
            ? [p.propertyName, p.propertyType]
            : [p.propertyName, p.propertyType, p.currentValue]
        )
      for (const list of PROPERTY_LISTS) {
        assert.deepStrictEqual(rest(placed, list), rest(classDefaults, list), `${piece.className} ${list}`)
      }
    }
    // the one light in the samples that was placed by hand, not loaded or pasted
    const handPlaced = listSamples().filter((s) => s.name.includes("new pieces probe"))
      .flatMap((s) => decodeSample(readSample(s)).items)
      .find((item) => item.actorToSpawn.includes("MP_RawPointLight"))!
    const piece = indexCatalog(catalog).pieceByClass.get(handPlaced.actorToSpawn)!
    const placed = itemFromPiece(piece, placementTransform(piece, { x: 0, y: 0, z: 0 }))
    assert.deepStrictEqual(placed.boolProperties, handPlaced.boolProperties)
  })

  it("leaves no property of a class the game can load unconfirmed", () => {
    const unconfirmed = load().pieces.filter((p) =>
      p.className !== "MP_PinballPaddle" && (p.properties ?? []).some((q) => q.optional === true)
    )
    assert.deepStrictEqual(unconfirmed.map((p) => p.className), [])
  })

  it("carries the game's labels and ranges for the panel's rows", () => {
    const catalog = load()
    const property = (className: string, name: string) =>
      catalog.pieces.find((p) => p.className === className)?.properties?.find((q) => q.name === name)
    assert.strictEqual(property("MP_AirVent", "EntryAssistMinSpeed")?.label, "Entry Boost Speed")
    assert.strictEqual(property("MP_AirVent", "Field Magnitude")?.max, 2250000)
    assert.strictEqual(property("BP_Elevator", "PhysicsElevatorExtensionLength")?.typedMax, 10000)
    assert.isTrue(property("MP_RawPointLight", "LightAttenuationRadius")?.hidden)
    assert.isTrue(property("MP_AirVent", "SurfaceAssignment")?.hidden)
    assert.isFalse(property("BP_Prim_Cube", "SurfaceAssignment")?.hidden)
    assert.strictEqual(property("BP_SpinningCylinder", "PhysicsFlip")?.label, "Flip Y")
    assert.isTrue(property("BP_Checkpoint", "SurfaceAssignment")?.hidden)
  })

  it("lists the properties sample items carry, in the order the game writes them", () => {
    const { pieceByClass } = indexCatalog(load())
    const names = (entries: ReadonlyArray<{ readonly propertyName: string }>) => entries.map((p) => p.propertyName)
    const inOrder = (some: ReadonlyArray<string>, all: ReadonlyArray<string>) => {
      let at = 0
      return some.every((name) => (at = all.indexOf(name, at) + 1) > 0)
    }
    for (const item of sampleItems()) {
      const known = pieceByClass.get(item.actorToSpawn)?.properties ?? []
      // a 0.4.1 save carries the whole layout; an older one the properties its game knew, in the same order
      const by041 = item.intProperties.some((p) => p.propertyName === "SurfaceAssignment")
      for (const list of PROPERTY_LISTS) {
        const listed = known.filter((p) => p.list === list).map((p) => p.name)
        if (by041) assert.deepStrictEqual(names(item[list]), listed)
        else {assert.isTrue(
            inOrder(names(item[list]), listed),
            `${item.actorToSpawn} ${list}: ${names(item[list]).join(", ")}`
          )}
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
    const extrasOnly = new Set(["MP_OrangeSign", "BP_CircularFlexiblePlatform", "MP_MoveableKillzone"])
    for (const piece of catalog.pieces.filter((p) => extrasOnly.has(p.className))) {
      expect(unavailableReasonOf(indexCatalog(catalog), piece)).toBeUndefined()
      expect(visibleExtras(piece).length).toBeGreaterThan(0)
    }
    // a class the game no longer ships (0.4.1 moved the pinball paddle out of the cooked game) is unavailable
    const paddle = catalog.pieces.find((p) => p.className === "MP_PinballPaddle")!
    expect(unavailableReasonOf(indexCatalog(catalog), paddle)).toMatch(/removed from the game/)
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
