import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { KeyValueStore } from "effect/persistence"
import { parseMapPrefs } from "../domain/MapPrefs"
import { MAP_PREFS_STORAGE_KEY, MapPrefsStore } from "./MapPrefsStore"

describe("MapPrefsStore", () => {
  it("drops stored entries that don't decode", () => {
    assert.deepStrictEqual(
      parseMapPrefs({ "A_b": { gridHeight: 500 }, "C_d": { gridHeight: "high" }, "E_f": 3 }),
      { "A_b": { gridHeight: 500 } }
    )
    assert.deepStrictEqual(parseMapPrefs([1]), {})
  })

  it.effect("keeps each map's prefs under its name, and forgets empty ones", () =>
    Effect.gen(function*() {
      const store = yield* MapPrefsStore
      assert.deepStrictEqual(yield* store.load("A_b"), {})
      yield* store.save("A_b", { gridHeight: 1234.5 })
      yield* store.save("C_d", { gridHeight: -20 })
      assert.deepStrictEqual(yield* store.load("A_b"), { gridHeight: 1234.5 })
      assert.deepStrictEqual(yield* store.load("C_d"), { gridHeight: -20 })
      yield* store.save("A_b", {})
      assert.deepStrictEqual(yield* store.load("A_b"), {})
      const kv = yield* KeyValueStore.KeyValueStore
      assert.deepStrictEqual(JSON.parse((yield* kv.get(MAP_PREFS_STORAGE_KEY))!), { "C_d": { gridHeight: -20 } })
      // a key that collides with Object.prototype is just another name
      assert.deepStrictEqual(yield* store.load("constructor"), {})
      yield* kv.set(MAP_PREFS_STORAGE_KEY, "{broken")
      assert.deepStrictEqual(yield* store.load("C_d"), {})
      yield* store.save("C_d", { gridHeight: 7 })
      assert.deepStrictEqual(yield* store.load("C_d"), { gridHeight: 7 })
    }).pipe(Effect.provide(MapPrefsStore.layerTest)))
})
