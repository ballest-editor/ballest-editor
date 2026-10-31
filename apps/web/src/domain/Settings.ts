/**
 * Editor settings: one schema, persisted as JSON in localStorage by SettingsStore.
 * Loading is per field: anything missing or invalid falls back to its default, so old
 * or hand-edited saves never break the editor.
 */
import { Option, Predicate, Schema } from "effect"
import { movementLookModes } from "./flyKeys"
import { PLACE_DISTANCE } from "./placement"
import { DEFAULT_GRID_SIZE, DEFAULT_ROTATION_STEP, GRID_SIZES, ROTATION_STEPS } from "./snap"

/** "Custom" uses CameraSettings.customFov instead of a preset's. */
export const CUSTOM_FOV_PRESET = "Custom"

export const GeneralSettings = Schema.Struct({
  /** How lengths are shown in the inspector (the map file always stores cm). */
  units: Schema.Literals(["cm", "m"]),
  /** Your in-game name; written into every exported map's `creatorName` and file name. */
  creatorName: Schema.String,
  /** Whether Alt+dragging a translate handle moves a copy and leaves the selection in place, like the game. */
  altDragDuplicates: Schema.Boolean
})

export const EditorSettings = Schema.Struct({
  /** How far from the camera (cm) a palette piece may land; bigger pieces go further (see domain/placement). */
  placeDistance: Schema.Finite.check(Schema.isBetween({ minimum: 500, maximum: 10000 })),
  /** Whether a selection change is its own undo step (edits always restore their selection). */
  undoSelection: Schema.Boolean
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
  invertLookY: Schema.Boolean,
  /** Hide the cursor and keep it in place during look, orbit and pan drags (Pointer Lock). */
  lockPointer: Schema.Boolean,
  /** Which movement keys only fly while the look button is held (see flyKeys). */
  movementNeedsLook: Schema.Literals(movementLookModes)
})

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))

export const AppearanceSettings = Schema.Struct({
  theme: Schema.Literals(["dark", "light", "system"]),
  gridVisible: Schema.Boolean,
  /** The grid's colours; null picks one for what is behind the grid (see autoGridColors). */
  gridCellColor: Schema.NullOr(HexColor),
  gridSectionColor: Schema.NullOr(HexColor),
  /** Whether the level's water (see domain/level) is drawn. */
  waterVisible: Schema.Boolean
})

export const LightingSettings = Schema.Struct({
  /** Light the viewport with the map's sun and sky light instead of fixed studio lights. */
  mapLighting: Schema.Boolean,
  /** Whether the game's sky (with the map's sun in it) is drawn behind the scene. */
  skyVisible: Schema.Boolean
})

/** Changed from the tool bar rather than the settings dialog, but persisted with the rest. */
export const SnappingSettings = Schema.Struct({
  /** Whether gizmo translation lands on the world grid. */
  enabled: Schema.Boolean,
  /** Grid step in cm. */
  gridSize: Schema.Literals(GRID_SIZES),
  /** Whether gizmo rotation turns in whole steps. */
  rotationEnabled: Schema.Boolean,
  /** Rotation step in degrees. */
  rotationStep: Schema.Literals(ROTATION_STEPS)
})

export const Settings = Schema.Struct({
  general: GeneralSettings,
  editor: EditorSettings,
  camera: CameraSettings,
  appearance: AppearanceSettings,
  lighting: LightingSettings,
  snapping: SnappingSettings
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = {
  general: { units: "cm", creatorName: "", altDragDuplicates: true },
  editor: { placeDistance: PLACE_DISTANCE, undoSelection: false },
  camera: {
    flySpeed: 2000,
    lookSensitivity: 1,
    fovPreset: "Default",
    customFov: 90,
    invertLookX: false,
    invertLookY: false,
    lockPointer: true,
    movementNeedsLook: "all"
  },
  appearance: {
    theme: "dark",
    gridVisible: true,
    gridCellColor: null,
    gridSectionColor: null,
    waterVisible: true
  },
  lighting: { mapLighting: true, skyVisible: true },
  snapping: {
    enabled: false,
    gridSize: DEFAULT_GRID_SIZE,
    rotationEnabled: false,
    rotationStep: DEFAULT_ROTATION_STEP
  }
}

type Section = keyof Settings

const sections: ReadonlyArray<Section> = ["general", "editor", "camera", "appearance", "lighting", "snapping"]

/** The fixed grid colours older saves stored; they now mean "automatic". */
const LEGACY_GRID_COLORS = { gridCellColor: "#3a404a", gridSectionColor: "#58606e" } as const

/**
 * Older saves kept `undoSelection` under general (it now lives under editor), and stored the
 * old fixed grid colours whether or not they were chosen (they become automatic).
 */
const migrate = (stored: unknown): unknown => {
  if (!Predicate.isObject(stored)) return stored
  let out: Record<string, unknown> = stored
  const general = out["general"]
  const editor = Predicate.isObject(out["editor"]) ? out["editor"] : {}
  if (Predicate.isObject(general) && "undoSelection" in general && !("undoSelection" in editor)) {
    out = { ...out, editor: { ...editor, undoSelection: general["undoSelection"] } }
  }
  const appearance = out["appearance"]
  if (Predicate.isObject(appearance)) {
    const legacy = Object.entries(LEGACY_GRID_COLORS).filter(([key, hex]) => appearance[key] === hex)
    if (legacy.length > 0) {
      out = { ...out, appearance: { ...appearance, ...Object.fromEntries(legacy.map(([key]) => [key, null])) } }
    }
  }
  return out
}

/**
 * Automatic grid colours per theme. The sky is cut off at the grid's height, so the grid is
 * always seen against the theme's background, or the water over it. Sections stand out more
 * than cells: lighter on the dark background, darker on the light one.
 */
export const AUTO_GRID_COLORS: Readonly<Record<"dark" | "light", { readonly cell: string; readonly section: string }>> =
  {
    dark: { cell: "#474e5a", section: "#5f6877" },
    light: { cell: "#a3b0bd", section: "#7a8a9b" }
  }

/** The grid colours to draw: the user's, else the theme's automatic ones. */
export const gridColorsOf = (
  appearance: Settings["appearance"],
  dark: boolean
): { readonly cell: string; readonly section: string } => {
  const auto = AUTO_GRID_COLORS[dark ? "dark" : "light"]
  return { cell: appearance.gridCellColor ?? auto.cell, section: appearance.gridSectionColor ?? auto.section }
}

/** Stored JSON -> Settings, field by field; invalid or missing fields keep their defaults. */
export const mergeSettings = (raw: unknown, defaults: Settings = defaultSettings): Settings => {
  const stored = migrate(raw)
  const out: Record<string, Record<string, unknown>> = {}
  for (const section of sections) {
    const from = Predicate.isObject(stored) ? stored[section] : undefined
    let merged: Record<string, unknown> = { ...defaults[section] }
    if (Predicate.isObject(from)) {
      // A field is kept when the section still decodes with it in place.
      const decodeSection = Schema.decodeUnknownOption(Settings.fields[section])
      for (const key of Object.keys(merged)) {
        const candidate = { ...merged, [key]: from[key] }
        if (Option.isSome(decodeSection(candidate))) merged = candidate
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
export const editorVerticalFov = (
  camera: Settings["camera"],
  presets: ReadonlyArray<{ readonly id: string; readonly fov: number }>
): number => verticalFov(fovOf(camera, presets), REFERENCE_ASPECT)

/** The horizontal FOV for the chosen preset; unknown presets use the first (Default). */
export const fovOf = (
  camera: Settings["camera"],
  presets: ReadonlyArray<{ readonly id: string; readonly fov: number }>
): number => {
  if (camera.fovPreset === CUSTOM_FOV_PRESET) return camera.customFov
  return presets.find((p) => p.id === camera.fovPreset)?.fov ?? presets[0]?.fov ?? 90
}
