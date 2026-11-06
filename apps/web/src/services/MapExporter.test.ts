import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Catalog, indexCatalog } from "../domain/Catalog"
import { newMapFile } from "../domain/factory"
import { jsonValueCount, LIMITS } from "../domain/limits"
import { isPlayerStart, MapFile } from "../domain/MapFile"
import { objectAt, parseJson } from "../test/json"
import { listSamples, readSample } from "../test/samples"
import { MapCodec } from "./MapCodec"
import { MapExporter } from "./MapExporter"

// 2026-10-26 15:04:05 UTC, on a machine at UTC+2: `createdAt` is UTC whatever the local zone
const NOW = Date.UTC(2026, 9, 26, 15, 4, 5)
const TestLayer = MapExporter.layerNoDeps.pipe(
  Layer.provideMerge(Layer.mergeAll(MapCodec.layer, DateTime.layerCurrentZoneOffset(2 * 60 * 60 * 1000)))
)

const fresh = () => newMapFile({ displayName: "My Track", creatorName: "spig", createdAt: "2000.01.01-00.00.00" })

describe("MapExporter", () => {
  it.effect("counts JSON values the way the written file does, for every sample", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      for (const sample of listSamples()) {
        const text = readSample(sample)
        const written = yield* codec.encode(yield* codec.decode(text))
        assert.strictEqual(jsonValueCount(yield* codec.decode(text)), jsonValueCount(parseJson(written)), sample.name)
      }
    }).pipe(Effect.provide(TestLayer)))

  it.effect("checks the map as written: the editorState it adds counts toward the limit", () =>
    Effect.gen(function*() {
      const exporter = yield* MapExporter
      const { items, worldSettings } = fresh()
      const filler = items[0]!
      const room = LIMITS.jsonValuesPerFile - jsonValueCount({ items, worldSettings })
      const count = Math.floor(room / jsonValueCount(filler))
      // A medal time is one value, so these fill the map to exactly the limit, without editorState.
      const medalTimesByIndex = [
        ...worldSettings.levelData.medalTimesByIndex,
        ...Array.from({ length: room - count * jsonValueCount(filler) }, () => 0)
      ]
      const full: MapFile = {
        worldSettings: { ...worldSettings, levelData: { ...worldSettings.levelData, medalTimesByIndex } },
        items: [...items, ...Array.from({ length: count }, () => filler)]
      }
      assert.strictEqual(jsonValueCount(full), LIMITS.jsonValuesPerFile)
      const error = yield* Effect.flip(exporter.prepare(full))
      assert.match(error.message, /JSON values/)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("passes the catalog on, so the material slot check still runs", () =>
    Effect.gen(function*() {
      const exporter = yield* MapExporter
      const meshAssetPath = "/Game/X/SM_X.SM_X"
      const catalog = indexCatalog(
        yield* Schema.decodeEffect(Catalog)({
          pieces: [],
          meshes: [{ meshAssetPath, materialSlots: [{ index: 0, defaultMaterial: "/Game/A.A" }] }]
        })
      )
      const map = fresh()
      const item = map.items[0]!
      const pastTheEnd = {
        ...item,
        actorToSpawn: "/Game/X/BP_X.BP_X_C",
        meshComponents: [{
          meshComponentTag: "SKGMapEditor",
          meshAssetPath,
          materials: [{ material: "/Game/A.A", materialIndex: 1 }],
          materialAssetPaths: []
        }]
      }
      const error = yield* Effect.flip(exporter.prepare({ ...map, items: [...map.items, pastTheEnd] }, catalog))
      assert.match(error.message, /material slot 2/)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("checks the text it writes: the game's layout counts toward the character limit", () =>
    Effect.gen(function*() {
      const exporter = yield* MapExporter
      const map = fresh()
      const { worldSettings } = map
      // Each is the longest string the game reads. Together they fit as bare strings; the file around them doesn't.
      const tagName = "x".repeat(1_048_576)
      const gameplayTags = Array.from({ length: LIMITS.charactersPerFile / tagName.length }, () => ({ tagName }))
      const { levelData } = worldSettings
      const full: MapFile = {
        ...map,
        worldSettings: {
          ...worldSettings,
          levelData: { ...levelData, mapTags: { ...levelData.mapTags, gameplayTags } }
        }
      }
      const error = yield* Effect.flip(exporter.prepare(full))
      assert.match(error.message, /characters \(maximum 67108864\)/)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("names the file and stamps the level fields the game expects", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(NOW)
      const exporter = yield* MapExporter
      const result = yield* exporter.prepare(fresh())
      assert.strictEqual(result.filename, "Map_LevelEditorMain&My Track_spig.balledit")
      const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(MapFile))(result.text)
      const levelData = decoded.worldSettings.levelData
      assert.strictEqual(levelData.systemLevelName, "Map_LevelEditorMain")
      assert.strictEqual(levelData.userLevelName, "My Track_spig")
      assert.strictEqual(levelData.createdAt, "2026.10.26-15.04.05")
      assert.match(levelData.createdAt, /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/)
      assert.isTrue(result.text.startsWith("{\r\n\t\"worldSettings\":\r\n\t{\r\n"))
      // the output decodes again and keeps exactly one player start
      assert.strictEqual(decoded.items.filter(isPlayerStart).length, 1)
      assert.isDefined(decoded.editorState)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("adds editorState when exporting an imported .ballmap, keeping all but the published flag", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const exporter = yield* MapExporter
      const sample = listSamples().find((s) => s.kind === "ballmap")!
      const original = parseJson(readSample(sample))
      const result = yield* exporter.prepare(yield* codec.decode(readSample(sample)))
      const json = parseJson(result.text)
      const asDraft = parseJson(readSample(sample).replaceAll(/"bIsBaseItem": true/g, "\"bIsBaseItem\": false"))
      assert.deepStrictEqual(objectAt(json)["items"], objectAt(asDraft)["items"])
      assert.deepStrictEqual(objectAt(json, "editorState")["pivots"], [])
      assert.strictEqual(
        objectAt(json, "worldSettings", "levelData")["levelDisplayName"],
        objectAt(original, "worldSettings", "levelData")["levelDisplayName"]
      )
    }).pipe(Effect.provide(TestLayer)))

  it.effect("writes a published map's items as a draft's, which the editor lists", () =>
    Effect.gen(function*() {
      const sample = listSamples().find((s) => s.kind === "ballmap")!
      const published = yield* MapCodec.use((codec) => codec.decode(readSample(sample)))
      assert.isTrue(published.items.every((item) => item.bIsBaseItem))
      const { map } = yield* MapExporter.use((exporter) => exporter.prepare(published))
      assert.isTrue(map.items.every((item) => !item.bIsBaseItem))
      assert.strictEqual(map.items.length, published.items.length)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("refuses maps without exactly one player start, or without a name", () =>
    Effect.gen(function*() {
      const exporter = yield* MapExporter
      const map = fresh()
      const noStart = yield* Effect.flip(exporter.prepare({ ...map, items: [] }))
      assert.strictEqual(noStart._tag, "ExportValidationError")
      const twoStarts = yield* Effect.flip(exporter.prepare({ ...map, items: [map.items[0]!, map.items[0]!] }))
      const start = map.items[0]!
      const skewed = { ...start, itemTransform: { ...start.itemTransform, rotation: { x: 0, y: 0, z: 1, w: 1 } } }
      const badRotation = yield* Effect.flip(exporter.prepare({ ...map, items: [skewed] }))
      assert.strictEqual(badRotation._tag, "ExportValidationError")
      assert.match(badRotation.message, /non-normalized rotation/)
      assert.include(twoStarts.message, "exactly one")
      const unnamed = newMapFile({ displayName: " ", creatorName: "x", createdAt: "" })
      assert.strictEqual((yield* Effect.flip(exporter.prepare(unnamed)))._tag, "ExportValidationError")
      const slash = newMapFile({ displayName: "a/b", creatorName: "x", createdAt: "" })
      assert.strictEqual((yield* Effect.flip(exporter.prepare(slash)))._tag, "ExportValidationError")
    }).pipe(Effect.provide(TestLayer)))
})
