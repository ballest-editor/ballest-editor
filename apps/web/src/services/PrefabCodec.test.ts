import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { Catalog, indexCatalog } from "../domain/Catalog"
import { PREFAB_REFUSALS } from "../domain/gameRules"
import { PrefabFile } from "../domain/PrefabFile"
import { changedPrefab as changed, PREFAB_TEXT, type PrefabJson } from "../test/prefabs"
import { repoRoot } from "../test/samples"
import { MapCodec } from "./MapCodec"

const catalog = indexCatalog(
  Schema.decodeUnknownSync(Catalog)(JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "catalog.json"), "utf8")))
)
const BARE_CLASS =
  "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces/BP_Prim_Cube.BP_Prim_Cube_C"

const first = (json: PrefabJson) => json.items[0]!
const second = (json: PrefabJson) => json.items[1]!
const group = (json: PrefabJson) => json.group!

const decode = (text: string) =>
  Effect.gen(function*() {
    return yield* (yield* MapCodec).decodePrefab(text, catalog)
  })

describe("the prefab file", () => {
  it.effect("round-trips byte for byte in the game's layout", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const prefab = yield* codec.decodePrefab(PREFAB_TEXT)
      assert.strictEqual(yield* codec.encodePrefab(prefab), PREFAB_TEXT)
      assert.include(PREFAB_TEXT, "\r\n\t\"format\"")
      assert.notStrictEqual(PREFAB_TEXT.charCodeAt(0), 0xfeff)
    }).pipe(Effect.provide(MapCodec.layer)))

  it.effect("keeps keys it doesn't model, and reads a file with a BOM", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const text = changed((json) => {
        json.fromAPlugin = 1
        first(json).future = "kept"
      })
      const out = yield* codec.encodePrefab(yield* codec.decodePrefab(`\uFEFF${text}`))
      assert.include(out, "\"fromAPlugin\": 1")
      assert.include(out, "\"future\": \"kept\"")
    }).pipe(Effect.provide(MapCodec.layer)))

  it.effect("loads what the game spawns from a hand-written file", () =>
    Effect.gen(function*() {
      const prefab = yield* decode(changed((json) => {
        for (const item of json.items) {
          delete item.paint
          item.properties = {}
          item.meshes = []
        }
        delete group(json).name
        second(json).class = `/Script/Engine.BlueprintGeneratedClass'${BARE_CLASS}'`
      }))
      assert.lengthOf(prefab.items, 2)
    }).pipe(Effect.provide(MapCodec.layer)))

  const refusedShape: ReadonlyArray<readonly [string, (json: PrefabJson) => void]> = [
    ["no group", (json) => delete json.group],
    ["a group without a rotation", (json) => delete group(json).rotation],
    ["a group without a scale", (json) => delete group(json).scale],
    ["another version", (json) => void (json.version = 2)],
    ["another format", (json) => void (json.format = "Prefab")],
    ["an item without properties", (json) => delete first(json).properties],
    ["an item without meshes", (json) => delete first(json).meshes],
    ["four numbers in a rotation", (json) => first(json).transform.rotation.push(1)]
  ]

  it.effect.each(refusedShape)("won't read %s", ([, change]) =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(decode(changed(change)))
      assert.strictEqual(error._tag, "PrefabDecodeError")
      assert.include(error.message, PREFAB_REFUSALS.document)
    }).pipe(Effect.provide(MapCodec.layer)))

  const refused: ReadonlyArray<readonly [string, (json: PrefabJson) => void, string]> = [
    ["one item", (json) => void json.items.pop(), PREFAB_REFUSALS.document],
    ["more than 4096 items", (json) => {
      json.items = Array.from({ length: 4097 }, () => first(json))
    }, PREFAB_REFUSALS.document],
    ["a group scale of 0", (json) => void (group(json).scale = [1, 0, 1]), PREFAB_REFUSALS.document],
    ["an item scale of 0", (json) => void (second(json).transform.scale = [1, 1, 0]), PREFAB_REFUSALS.item(1)],
    ["a name with a space", (json) => void (group(json).name = "Two words"), PREFAB_REFUSALS.groupName],
    ["an empty name", (json) => void (group(json).name = ""), PREFAB_REFUSALS.groupName],
    ["a name of 65 letters", (json) => void (group(json).name = "a".repeat(65)), PREFAB_REFUSALS.groupName],
    ["the player start", (json) => {
      first(json).class = "/Game/MapItems/PlayerStart/MP_PlayerStart.MP_PlayerStart_C"
    }, PREFAB_REFUSALS.playerStart],
    [
      "a class that doesn't exist",
      (json) => void (first(json).class = "/Game/BP_Nope.BP_Nope_C"),
      PREFAB_REFUSALS.itemClass
    ],
    ["a property the class lacks", (json) => void (second(json).properties = { Nope: 1 }), PREFAB_REFUSALS.item(1)],
    ["a number for a bool", (json) => void (first(json).properties = { bMirror: 1 }), PREFAB_REFUSALS.item(0)]
  ]

  it.effect.each(refused)(
    "refuses %s, in the game's words, both ways",
    ([, change, problem]) =>
      Effect.gen(function*() {
        const codec = yield* MapCodec
        const text = changed(change)
        const onRead = yield* Effect.flip(codec.decodePrefab(text, catalog))
        assert.strictEqual(onRead._tag, "PrefabRefusedError")
        assert.include(onRead.message, problem)
        const prefab = Schema.decodeUnknownSync(Schema.fromJsonString(PrefabFile))(text)
        const onWrite = yield* Effect.flip(codec.encodePrefab(prefab, catalog))
        assert.strictEqual(onWrite._tag, "PrefabRefusedError")
      }).pipe(Effect.provide(MapCodec.layer))
  )
})
