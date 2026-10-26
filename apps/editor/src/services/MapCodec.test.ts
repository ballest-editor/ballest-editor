import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { listSamples, readSample } from "../test/samples"
import { MapCodec } from "./MapCodec"

const samples = listSamples()

describe("MapCodec", () => {
  it("finds the samples", () => {
    assert.isAtLeast(samples.filter((s) => s.kind === "balledit").length, 1)
    assert.isAtLeast(samples.filter((s) => s.kind === "ballmap").length, 1)
  })

  it.effect.each(samples.map((s) => [s.name, s] as const))("round-trips %s (JSON-equal)", ([, sample]) =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const text = readSample(sample)
      const map = yield* codec.decode(text)
      const out = yield* codec.encode(map)
      assert.deepStrictEqual(JSON.parse(out), JSON.parse(text))
      assert.strictEqual(map.editorState !== undefined, sample.kind === "balledit")
    }).pipe(Effect.provide(MapCodec.layer)))

  // Current in-game saves are reproduced byte for byte (older Workshop files write short
  // number arrays inline, which the current game no longer does).
  it.effect.each(samples.filter((s) => s.kind === "balledit").map((s) => [s.name, s] as const))(
    "re-encodes %s byte-identically",
    ([, sample]) =>
      Effect.gen(function*() {
        const codec = yield* MapCodec
        const text = readSample(sample)
        const out = yield* codec.encode(yield* codec.decode(text))
        assert.isTrue(out === text, "encoded text differs from the in-game save")
      }).pipe(Effect.provide(MapCodec.layer))
  )

  it.effect("preserves unknown fields at every level and appends them after known fields", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const base = JSON.parse(readSample(samples.find((s) => s.kind === "balledit")!)) as Record<string, any>
      base.futureTopLevel = { a: [1, 2] }
      base.worldSettings.levelData.futureField = "x"
      base.items[0].futureItemField = true
      base.items[0].itemTransform.rotation.extra = 1
      base.items[0].meshComponents[0].futureMesh = null
      base.editorState.futureEditor = { nested: { ok: 1 } }
      const input = JSON.stringify(base)
      const out = JSON.parse(yield* codec.encode(yield* codec.decode(input)))
      assert.deepStrictEqual(out, JSON.parse(input))
      const itemKeys = Object.keys(out.items[0])
      assert.strictEqual(itemKeys[0], "actorToSpawn")
      assert.strictEqual(itemKeys.at(-1), "futureItemField")
    }).pipe(Effect.provide(MapCodec.layer)))

  it.effect("writes tabs and CRLF without BOM, and accepts a BOM on input", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const text = readSample(samples[0]!)
      const out = yield* codec.encode(yield* codec.decode(`\uFEFF${text}`))
      assert.isTrue(out.startsWith("{\r\n\t\"worldSettings\":\r\n\t{"))
      assert.notInclude(out.replaceAll("\r\n", ""), "\n")
      assert.notStrictEqual(out.charCodeAt(0), 0xfeff)
    }).pipe(Effect.provide(MapCodec.layer)))

  it.effect("fails with MapDecodeError on bad input", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const notJson = yield* Effect.flip(codec.decode("{ nope"))
      assert.strictEqual(notJson._tag, "MapDecodeError")
      const wrongShape = yield* Effect.flip(codec.decode(JSON.stringify({ worldSettings: {}, items: [] })))
      assert.strictEqual(wrongShape._tag, "MapDecodeError")
      assert.include(wrongShape.message, "directionalLight")
    }).pipe(Effect.provide(MapCodec.layer)))
})
