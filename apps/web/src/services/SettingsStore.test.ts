import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { KeyValueStore } from "effect/persistence"
import { FALLBACK_CAMERA_PRESETS } from "../domain/GameKeybinds"
import {
  AUTO_GRID_COLORS,
  defaultSettings,
  fovOf,
  gridColorsOf,
  isDefaultDisplay,
  mergeSettings,
  verticalFov,
  withDefaultDisplay
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

  it("picks automatic grid colours for the theme, or the user's", () => {
    assert.deepStrictEqual(gridColorsOf(defaultSettings.appearance, true), AUTO_GRID_COLORS.dark)
    assert.deepStrictEqual(gridColorsOf(defaultSettings.appearance, false), AUTO_GRID_COLORS.light)
    const chosen = gridColorsOf({ ...defaultSettings.appearance, gridCellColor: "#ff0000" }, false)
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

  it("keeps the gizmo's settings, falling back per field", () => {
    assert.deepStrictEqual(mergeSettings({}).gizmo, { size: "m", showForGroups: true })
    assert.deepStrictEqual(mergeSettings({ gizmo: { size: "l", showForGroups: "no" } }).gizmo, {
      size: "l",
      showForGroups: true
    })
    assert.strictEqual(mergeSettings({ gizmo: { size: "xl" } }).gizmo.size, "m")
  })

  it("keeps a pane's axes size apart from the transform gizmo's", () => {
    assert.strictEqual(mergeSettings({}).camera.axesSize, "m")
    assert.strictEqual(mergeSettings({ camera: { axesSize: "xl" } }).camera.axesSize, "m")
    const merged = mergeSettings({ camera: { axesSize: "l" }, gizmo: { size: "s" } })
    assert.strictEqual(merged.camera.axesSize, "l")
    assert.strictEqual(merged.gizmo.size, "s")
  })

  it("resets what the Display popover shows and nothing else", () => {
    const changed = {
      ...defaultSettings,
      general: { ...defaultSettings.general, units: "m" as const },
      appearance: {
        ...defaultSettings.appearance,
        theme: "light" as const,
        gridVisible: false,
        waterVisible: false,
        gridCellColor: "#112233"
      },
      lighting: { mapLighting: false, skyVisible: false },
      gizmo: { size: "s" as const, showForGroups: false }
    }
    assert.isFalse(isDefaultDisplay(changed))
    const reset = withDefaultDisplay(changed)
    assert.isTrue(isDefaultDisplay(reset))
    assert.deepInclude(reset.appearance, { theme: "light", gridVisible: true, waterVisible: true, gridCellColor: null })
    assert.deepStrictEqual(reset.lighting, defaultSettings.lighting)
    assert.deepStrictEqual(reset.gizmo, defaultSettings.gizmo)
    assert.strictEqual(reset.general.units, "m")
    assert.isTrue(isDefaultDisplay(defaultSettings))
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

describe("snapping settings", () => {
  it("keeps what an older save chose, and fills in what it never had", () => {
    const merged = mergeSettings({ snapping: { enabled: true, gridSize: 25, rotationEnabled: true, rotationStep: 5 } })
    assert.strictEqual(merged.snapping.enabled, true)
    assert.strictEqual(merged.snapping.gridSize, 25)
    assert.strictEqual(merged.snapping.rotationStep, 5)
    assert.deepStrictEqual(merged.snapping.targets, defaultSettings.snapping.targets)
    assert.strictEqual(merged.snapping.scaleStep, defaultSettings.snapping.scaleStep)
  })

  it("takes a typed step, and turns down one that can't be", () => {
    assert.strictEqual(mergeSettings({ snapping: { gridSize: 37 } }).snapping.gridSize, 37)
    assert.strictEqual(
      mergeSettings({ snapping: { gridSize: -5 } }).snapping.gridSize,
      defaultSettings.snapping.gridSize
    )
  })
})
