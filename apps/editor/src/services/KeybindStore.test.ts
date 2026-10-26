import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { KeyValueStore } from "effect/persistence"
import { chordOf, defaultKeybinds, mergeKeybinds } from "../domain/Keybinds"
import { KEYBINDS_STORAGE_KEY, KeybindStore } from "./KeybindStore"

const gameFile = JSON.stringify({
  contexts: [{
    name: "IMC_FreeCam",
    mappings: [{ action: "IA_Move", key: "I", modifiers: ["InputModifierSwizzleAxis"], modifierSettings: [{ type: "InputModifierSwizzleAxis", settings: { Order: "EInputAxisSwizzle::YXZ" } }] }]
  }]
})

describe("KeybindStore", () => {
  it.effect("falls back when the game file is missing, persists changes, and resets", () =>
    Effect.gen(function*() {
      const store = yield* KeybindStore
      const loaded = yield* store.load
      assert.deepStrictEqual(loaded.keybinds, defaultKeybinds)
      assert.include(loaded.defaults.fellBack, "moveForward")
      yield* store.save({ ...loaded.keybinds, moveForward: "KeyZ" })
      assert.strictEqual((yield* store.load).keybinds.moveForward, "KeyZ")
      assert.deepStrictEqual((yield* store.reset).keybinds, defaultKeybinds)
      assert.deepStrictEqual((yield* store.load).keybinds, defaultKeybinds)
    }).pipe(Effect.provide(KeybindStore.layerTest())))

  it.effect("uses the game's bindings as defaults under user overrides", () =>
    Effect.gen(function*() {
      const kv = yield* KeyValueStore.KeyValueStore
      const store = yield* KeybindStore
      assert.strictEqual((yield* store.load).keybinds.moveForward, "KeyI")
      yield* kv.set(KEYBINDS_STORAGE_KEY, JSON.stringify({ undo: "Ctrl+KeyU", bogus: "KeyX" }))
      const { keybinds } = yield* store.load
      assert.strictEqual(keybinds.undo, "Ctrl+KeyU")
      assert.strictEqual(keybinds.moveForward, "KeyI")
      assert.notProperty(keybinds, "bogus")
      yield* kv.set(KEYBINDS_STORAGE_KEY, "not json")
      assert.strictEqual((yield* store.load).keybinds.undo, defaultKeybinds.undo)
    }).pipe(Effect.provide(KeybindStore.layerTest(gameFile))))

  it("builds chord strings", () => {
    const e = { code: "KeyZ", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }
    assert.strictEqual(chordOf(e), "Ctrl+KeyZ")
    assert.strictEqual(chordOf({ ...e, code: "ShiftLeft", shiftKey: true, ctrlKey: false }), "ShiftLeft")
    assert.deepStrictEqual(mergeKeybinds({}, defaultKeybinds), defaultKeybinds)
  })
})
