import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { KeyValueStore } from "effect/persistence"
import { FALLBACK_CAMERA_PRESETS } from "../domain/GameKeybinds"
import { defaultSettings, fovOf, mergeSettings, verticalFov } from "../domain/Settings"
import { SETTINGS_STORAGE_KEY, SettingsStore } from "./SettingsStore"

describe("Settings", () => {
  it("merges stored settings field by field, keeping defaults for bad values", () => {
    const merged = mergeSettings({
      camera: { flySpeed: 5000, lookSensitivity: 99, fovPreset: "WideAngle", invertLookY: "yes" },
      appearance: { gridCellColor: "#ff0000", theme: "neon" },
      bogus: 1
    })
    assert.strictEqual(merged.camera.flySpeed, 5000)
    assert.strictEqual(merged.camera.lookSensitivity, defaultSettings.camera.lookSensitivity) // out of range
    assert.strictEqual(merged.camera.invertLookY, false)
    assert.strictEqual(merged.appearance.gridCellColor, "#ff0000")
    assert.strictEqual(merged.appearance.theme, "dark")
    assert.deepStrictEqual(mergeSettings("nope"), defaultSettings)
  })

  it("uses the game's FOV presets (horizontal) converted to three's vertical FOV", () => {
    const presets = FALLBACK_CAMERA_PRESETS
    const withPreset = (fovPreset: string, customFov = 90) => ({ ...defaultSettings, camera: { ...defaultSettings.camera, fovPreset, customFov } })
    assert.strictEqual(fovOf(withPreset("WideAngle"), presets), 110)
    assert.strictEqual(fovOf(defaultSettings, presets), 90)
    assert.strictEqual(fovOf(withPreset("Custom", 75), presets), 75)
    assert.strictEqual(fovOf(withPreset("Gone"), presets), 90)
    assert.closeTo(verticalFov(90, 1), 90, 1e-9)
    assert.closeTo(verticalFov(90, 16 / 9), 58.715507, 1e-5)
  })

  it.effect("persists, reloads and resets", () =>
    Effect.gen(function*() {
      const store = yield* SettingsStore
      assert.deepStrictEqual(yield* store.load, defaultSettings)
      const changed = { ...defaultSettings, camera: { ...defaultSettings.camera, fovPreset: "WideAngle" } }
      yield* store.save(changed)
      assert.deepStrictEqual(yield* store.load, changed)
      const kv = yield* KeyValueStore.KeyValueStore
      yield* kv.set(SETTINGS_STORAGE_KEY, "{broken")
      assert.deepStrictEqual(yield* store.load, defaultSettings)
      yield* store.save(changed)
      assert.deepStrictEqual(yield* store.reset, defaultSettings)
      assert.deepStrictEqual(yield* store.load, defaultSettings)
    }).pipe(Effect.provide(SettingsStore.layerTest)))
})
