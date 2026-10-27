import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { newMapFile } from "../domain/factory"
import { isPlayerStart, MapFile } from "../domain/MapFile"
import { listSamples, readSample } from "../test/samples"
import { MapCodec } from "./MapCodec"
import { MapExporter } from "./MapExporter"

// 2026-10-26 15:04:05 UTC, rendered in UTC+2
const NOW = Date.UTC(2026, 9, 26, 15, 4, 5)
const TestLayer = MapExporter.layerNoDeps.pipe(
  Layer.provideMerge(Layer.mergeAll(MapCodec.layer, DateTime.layerCurrentZoneOffset(2 * 60 * 60 * 1000)))
)

const fresh = () => newMapFile({ displayName: "My Track", creatorName: "spig", createdAt: "2000.01.01-00.00.00" })

describe("MapExporter", () => {
  it.effect("names the file and stamps the level fields the game expects", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(NOW)
      const exporter = yield* MapExporter
      const result = yield* exporter.prepare(fresh())
      assert.strictEqual(result.filename, "Map_LevelEditorMain&My Track_spig.balledit")
      const json = JSON.parse(result.text)
      const levelData = json.worldSettings.levelData
      assert.strictEqual(levelData.systemLevelName, "Map_LevelEditorMain")
      assert.strictEqual(levelData.userLevelName, "My Track_spig")
      assert.strictEqual(levelData.createdAt, "2026.10.26-17.04.05")
      assert.match(levelData.createdAt, /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/)
      assert.isTrue(result.text.startsWith("{\r\n\t\"worldSettings\":\r\n\t{\r\n"))
      assert.strictEqual(result.blob.size, new TextEncoder().encode(result.text).length)
      // the output decodes again and keeps exactly one player start
      const decoded = yield* Schema.decodeUnknownEffect(MapFile)(json)
      assert.strictEqual(decoded.items.filter(isPlayerStart).length, 1)
      assert.isDefined(decoded.editorState)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("adds editorState when exporting an imported .ballmap, keeping everything else", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const exporter = yield* MapExporter
      const sample = listSamples().find((s) => s.kind === "ballmap")!
      const original = JSON.parse(readSample(sample))
      const result = yield* exporter.prepare(yield* codec.decode(readSample(sample)))
      const json = JSON.parse(result.text)
      assert.deepStrictEqual(json.items, original.items)
      assert.deepStrictEqual(json.editorState.pivots, [])
      assert.strictEqual(json.worldSettings.levelData.levelDisplayName, original.worldSettings.levelData.levelDisplayName)
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
