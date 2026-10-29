import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { KeyValueStore } from "effect/persistence"
import { FALLBACK_CAMERA_PRESETS } from "../domain/GameKeybinds"
import {
  AUTO_GRID_COLORS,
  defaultSettings,
  fovOf,
  gridBackdropOf,
  gridColorsOf,
  mergeSettings,
  verticalFov
} from "../domain/Settings"
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

  it("carries undoSelection over from general to editor in older saves", () => {
    assert.isTrue(mergeSettings({ general: { undoSelection: true } }).editor.undoSelection)
    assert.isFalse(
      mergeSettings({ general: { undoSelection: true }, editor: { undoSelection: false } }).editor.undoSelection
    )
    assert.strictEqual(mergeSettings({ editor: { placeDistance: 4000 } }).editor.placeDistance, 4000)
    assert.strictEqual(
      mergeSettings({ editor: { placeDistance: 50 } }).editor.placeDistance,
      defaultSettings.editor.placeDistance
    )
  })

  it("reads the old fixed grid colours as automatic, keeping colours the user chose", () => {
    const old = mergeSettings({ appearance: { gridCellColor: "#3a404a", gridSectionColor: "#58606e" } })
    assert.strictEqual(old.appearance.gridCellColor, null)
    assert.strictEqual(old.appearance.gridSectionColor, null)
    const chosen = mergeSettings({ appearance: { gridCellColor: "#3a404a", gridSectionColor: "#123456" } })
    assert.strictEqual(chosen.appearance.gridSectionColor, "#123456")
    assert.strictEqual(mergeSettings({ appearance: { gridCellColor: null } }).appearance.gridCellColor, null)
  })

  it("picks automatic grid colours for what the grid is seen against", () => {
    assert.strictEqual(gridBackdropOf(true, false, 30), "dark")
    assert.strictEqual(gridBackdropOf(false, false, -60), "light")
    assert.strictEqual(gridBackdropOf(false, true, 30), "day sky") // the theme doesn't matter under the sky
    assert.strictEqual(gridBackdropOf(true, true, -3), "day sky") // twilight still counts as day
    assert.strictEqual(gridBackdropOf(true, true, -30), "night sky")
    const auto = gridColorsOf(defaultSettings.appearance, "light")
    assert.deepStrictEqual(auto, AUTO_GRID_COLORS.light)
    const chosen = gridColorsOf({ ...defaultSettings.appearance, gridCellColor: "#ff0000" }, "light")
    assert.deepStrictEqual(chosen, { cell: "#ff0000", section: AUTO_GRID_COLORS.light.section })
  })

  it("uses the game's FOV presets (horizontal) converted to three's vertical FOV", () => {
    const presets = FALLBACK_CAMERA_PRESETS
    const withPreset = (fovPreset: string, customFov = 90) => ({
      ...defaultSettings,
      camera: { ...defaultSettings.camera, fovPreset, customFov }
    })
    assert.strictEqual(fovOf(withPreset("WideAngle").camera, presets), 110)
    assert.strictEqual(fovOf(defaultSettings.camera, presets), 90)
    assert.strictEqual(fovOf(withPreset("Custom", 75).camera, presets), 75)
    assert.strictEqual(fovOf(withPreset("Gone").camera, presets), 90)
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
