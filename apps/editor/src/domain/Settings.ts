/**
 * Editor settings: one schema, persisted as JSON in localStorage by SettingsStore.
 * Loading is per field: anything missing or invalid falls back to its default, so old
 * or hand-edited saves never break the editor.
 */
import { Option, Predicate, Schema } from "effect"

/** "Custom" uses CameraSettings.customFov instead of a preset's. */
export const CUSTOM_FOV_PRESET = "Custom"

export const GeneralSettings = Schema.Struct({
  /** How lengths are shown in the inspector (the map file always stores cm). */
  units: Schema.Literals(["cm", "m"]),
  /** Your in-game name; written into every exported map's `creatorName` and file name. */
  creatorName: Schema.String
})

export const CameraSettings = Schema.Struct({
  /** Base fly speed in cm/s at camera speed x1. */
  flySpeed: Schema.Finite.check(Schema.isBetween({ minimum: 100, maximum: 20000 })),
  /** Multiplier on mouse look. */
  lookSensitivity: Schema.Finite.check(Schema.isBetween({ minimum: 0.1, maximum: 5 })),
  /** A camera preset row from keybinds.json (`cameraPresets[].row`) or "Custom". */
  fovPreset: Schema.String,
  /** Horizontal FOV (degrees) when the preset is "Custom". */
  customFov: Schema.Finite.check(Schema.isBetween({ minimum: 30, maximum: 140 })),
  invertLookX: Schema.Boolean,
  invertLookY: Schema.Boolean
})

export const AppearanceSettings = Schema.Struct({
  theme: Schema.Literals(["dark", "light", "system"]),
  gridVisible: Schema.Boolean,
  gridCellColor: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  gridSectionColor: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
})

export const Settings = Schema.Struct({
  general: GeneralSettings,
  camera: CameraSettings,
  appearance: AppearanceSettings
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = {
  general: { units: "cm", creatorName: "" },
  camera: { flySpeed: 2000, lookSensitivity: 1, fovPreset: "Default", customFov: 90, invertLookX: false, invertLookY: false },
  appearance: { theme: "dark", gridVisible: true, gridCellColor: "#3a404a", gridSectionColor: "#58606e" }
}

type Section = keyof Settings

const sectionSchemas: { readonly [K in Section]: Schema.Struct<Schema.Struct.Fields> } = {
  general: GeneralSettings,
  camera: CameraSettings,
  appearance: AppearanceSettings
}

/** Stored JSON -> Settings, field by field; invalid or missing fields keep their defaults. */
export const mergeSettings = (stored: unknown, defaults: Settings = defaultSettings): Settings => {
  const out: Record<string, Record<string, unknown>> = {}
  for (const section of Object.keys(sectionSchemas) as Array<Section>) {
    const fields = sectionSchemas[section].fields
    const from = Predicate.isObject(stored) ? (stored as Record<string, unknown>)[section] : undefined
    const merged: Record<string, unknown> = { ...defaults[section] }
    if (Predicate.isObject(from)) {
      for (const [key, schema] of Object.entries(fields)) {
        const value = Schema.decodeUnknownOption(schema as Schema.Codec<unknown>)((from as Record<string, unknown>)[key])
        if (Option.isSome(value)) merged[key] = value.value
      }
    }
    out[section] = merged
  }
  return Schema.decodeUnknownSync(Settings)(out)
}

/**
 * The game's FOV presets are horizontal at the player's screen shape. The editor holds the
 * equivalent *vertical* FOV for a 16:9 screen constant, so resizing the viewport shows more
 * or less at the sides instead of zooming.
 */
export const REFERENCE_ASPECT = 16 / 9

/** UE's FOV is horizontal; three.js wants vertical. */
export const verticalFov = (horizontalDeg: number, aspect: number): number => {
  const h = (horizontalDeg * Math.PI) / 180
  return (2 * Math.atan(Math.tan(h / 2) / Math.max(aspect, 1e-6)) * 180) / Math.PI
}

/** Vertical FOV (degrees) for the editor camera: the preset's horizontal FOV at 16:9. */
export const editorVerticalFov = (settings: Settings, presets: ReadonlyArray<{ readonly id: string; readonly fov: number }>): number =>
  verticalFov(fovOf(settings, presets), REFERENCE_ASPECT)

/** The horizontal FOV for the chosen preset; unknown presets use the first (Default). */
export const fovOf = (settings: Settings, presets: ReadonlyArray<{ readonly id: string; readonly fov: number }>): number => {
  if (settings.camera.fovPreset === CUSTOM_FOV_PRESET) return settings.camera.customFov
  return presets.find((p) => p.id === settings.camera.fovPreset)?.fov ?? presets[0]?.fov ?? 90
}
