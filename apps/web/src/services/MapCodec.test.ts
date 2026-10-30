import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { setLevelData, setSlotMaterials, type SlotMaterial, withLevelNames } from "../domain/edits"
import { objectPathOf } from "../domain/MapFile"
import { hasTag, TAG_GROUPS, tagNameOf, unknownTags, withDifficulty, withTag } from "../domain/mapTags"
import { parsePaint } from "../domain/Paint"
import { objectAt, parseJson } from "../test/json"
import { listSamples, readSample, repoRoot } from "../test/samples"
import { MapCodec } from "./MapCodec"

const samples = listSamples()
const paintChoices = parsePaint(JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "materials.json"), "utf8")))
  .flatMap((finish) => finish.colors.map((c) => c.material))

describe("MapCodec", () => {
  it("finds the samples", () => {
    assert.isAtLeast(samples.filter((s) => s.kind === "balledit").length, 1)
    assert.isAtLeast(samples.filter((s) => s.kind === "ballmap").length, 1)
  })

  it.effect.each(samples.map((s) => [s.name, s] as const))(
    "round-trips %s (JSON-equal)",
    ([, sample]) =>
      Effect.gen(function*() {
        const codec = yield* MapCodec
        const text = readSample(sample)
        const map = yield* codec.decode(text)
        const out = yield* codec.encode(map)
        assert.deepStrictEqual(JSON.parse(out), JSON.parse(text))
        assert.strictEqual(map.editorState !== undefined, sample.kind === "balledit")
      }).pipe(Effect.provide(MapCodec.layer))
  )

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

  // Paint every slot of every item, cycling through the game's picker, and the file still
  // round-trips: each slot and its materialAssetPaths entry carry the chosen material.
  it.effect.each(samples.map((s) => [s.name, s] as const))(
    "round-trips %s with every slot painted",
    ([, sample]) =>
      Effect.gen(function*() {
        assert.isAbove(paintChoices.length, 0)
        const codec = yield* MapCodec
        const map = yield* codec.decode(readSample(sample))
        let n = 0
        const edits: Array<SlotMaterial> = map.items.flatMap((item, index) =>
          item.meshComponents.flatMap((mesh, component) =>
            mesh.materials.map(({ materialIndex: slot }) => ({
              index,
              component,
              slot,
              material: paintChoices[n++ % paintChoices.length]!
            }))
          )
        )
        const painted = Option.getOrThrow(setSlotMaterials(map, edits))
        const text = yield* codec.encode(painted)
        const decoded = yield* codec.decode(text)
        assert.deepStrictEqual(decoded, painted)
        assert.deepStrictEqual(parseJson(yield* codec.encode(decoded)), parseJson(text))
        for (const { index, component, slot, material } of edits) {
          const mesh = decoded.items[index]!.meshComponents[component]!
          assert.strictEqual(mesh.materials.find((m) => m.materialIndex === slot)?.material, material)
          if (mesh.materialAssetPaths !== undefined) {
            assert.strictEqual(mesh.materialAssetPaths[slot], objectPathOf(material))
          }
        }
      }).pipe(Effect.provide(MapCodec.layer))
  )

  // Set every map setting the editor offers, and the file still round-trips: the new names,
  // difficulty and tags are written, and tags the editor doesn't know come back untouched.
  it.effect.each(samples.map((s) => [s.name, s] as const))(
    "round-trips %s with its map settings changed",
    ([, sample]) =>
      Effect.gen(function*() {
        const codec = yield* MapCodec
        const map = yield* codec.decode(readSample(sample))
        const before = map.worldSettings.levelData
        let levelData = withLevelNames(withDifficulty(before, "baller"), "Renamed Map", before.creatorName)
        for (const { group, tags } of TAG_GROUPS) {
          for (const tag of tags) {
            levelData = withTag(levelData, tagNameOf(group, tag), !hasTag(levelData, tagNameOf(group, tag)))
          }
        }
        const edited = setLevelData(map, levelData)
        const text = yield* codec.encode(edited)
        const decoded = yield* codec.decode(text)
        assert.deepStrictEqual(decoded, edited)
        const out = decoded.worldSettings.levelData
        assert.strictEqual(out.userLevelName, `Renamed Map_${before.creatorName}`)
        assert.strictEqual(out.levelDifficulty, "Baller")
        assert.deepStrictEqual(unknownTags(out), unknownTags(before))
        assert.deepStrictEqual(decoded.items, map.items)
      }).pipe(Effect.provide(MapCodec.layer))
  )

  it.effect("preserves unknown fields at every level and appends them after known fields", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const base = parseJson(readSample(samples.find((s) => s.kind === "balledit")!))
      objectAt(base)["futureTopLevel"] = { a: [1, 2] }
      objectAt(base, "worldSettings", "levelData")["futureField"] = "x"
      objectAt(base, "items", 0)["futureItemField"] = true
      objectAt(base, "items", 0, "itemTransform", "rotation")["extra"] = 1
      objectAt(base, "items", 0, "meshComponents", 0)["futureMesh"] = null
      objectAt(base, "editorState")["futureEditor"] = { nested: { ok: 1 } }
      const input = JSON.stringify(base)
      const out = parseJson(yield* codec.encode(yield* codec.decode(input)))
      assert.deepStrictEqual(out, parseJson(input))
      const itemKeys = Object.keys(objectAt(out, "items", 0))
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
