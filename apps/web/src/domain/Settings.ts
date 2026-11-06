/**
 * Editor settings: one schema, persisted as JSON in localStorage by SettingsStore.
 * Loading is per field: anything missing or invalid falls back to its default, so old
 * or hand-edited saves never break the editor.
 */
import { Option, Predicate, Schema } from "effect"
import { movementLookModes } from "./flyKeys"
import { PLACE_DISTANCE } from "./placement"
import { SCENE_COLORS, shadeOf } from "./sceneGround"
import { DEFAULT_GRID_SIZE, DEFAULT_ROTATION_STEP, GRID_SIZES, ROTATION_STEPS } from "./snap"

/** "Custom" uses CameraSettings.customFov instead of a preset's. */
export const CUSTOM_FOV_PRESET = "Custom"

export const GeneralSettings = Schema.Struct({
  /** How lengths are shown in the inspector (the map file always stores cm). */
  units: Schema.Literals(["cm", "m"]),
  /**
   * Your in-game name, as typed in Settings; written into every exported map's `creatorName` and file name. Null (the
   * default) uses the name found on this machine instead, the Steam persona name the game writes (see domain/creator).
   */
  creatorName: Schema.NullOr(Schema.String),
  /** Whether Alt+dragging a translate handle moves a copy and leaves the selection in place, like the game. */
  altDragDuplicates: Schema.Boolean,
  /** Whether every Save also exports the map to the game (desktop), whatever the map's own Export on save says. */
  exportOnSave: Schema.Boolean,
  /**
   * Where a project opens (desktop). `ask`: in this window, with the whereToOpen dialog first while this window has
   * unsaved changes; that dialog's Always do this stores the answer here.
   */
  projectOpensIn: Schema.Literals(["ask", "thisWindow", "newWindow"])
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
  /**
   * When look, orbit and pan drags hide the cursor and keep it in place (Pointer Lock).
   * Browsers announce every lock with a banner, so by default only the desktop app locks.
   */
  lockPointer: Schema.Literals(["desktop", "always", "never"]),
  /** Which movement keys only fly while the look button is held (see flyKeys). */
  movementNeedsLook: Schema.Literals(movementLookModes)
})

/** The animation speeds, as Settings › Appearance offers them, and the factor each applies to every duration. */
export const motionSpeeds = ["off", "fast", "normal", "slow"] as const
export type MotionSpeed = (typeof motionSpeeds)[number]
export const MOTION_SCALE: Record<MotionSpeed, number> = { off: 0, fast: 0.5, normal: 1, slow: 2 }

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))

export const AppearanceSettings = Schema.Struct({
  theme: Schema.Literals(["dark", "light", "system"]),
  gridVisible: Schema.Boolean,
  /** The grid's colours; null picks one for what is behind the grid (see autoGridColors). */
  gridCellColor: Schema.NullOr(HexColor),
  gridSectionColor: Schema.NullOr(HexColor),
  /** Whether the level's water (see domain/level) is drawn. */
  waterVisible: Schema.Boolean,
  /** How fast the interface animates (panels opening, menus, tabs); "off" skips every animation. */
  motion: Schema.Literals(motionSpeeds)
})

export const LightingSettings = Schema.Struct({
  /** Light the viewport with the map's sun and sky light instead of fixed studio lights. */
  mapLighting: Schema.Boolean,
  /** Whether the game's sky (with the map's sun in it) is drawn behind the scene. */
  skyVisible: Schema.Boolean
})

/** Changed from the tool bar rather than the Settings dialog, but persisted with the rest. */
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

/** Changed from a panel's own header rather than the Settings dialog, but persisted with the rest. */
export const PanelSettings = Schema.Struct({
  /** How the Pieces panel lays out its pieces. */
  piecesView: Schema.Literals(["list", "grid"])
})

export const Settings = Schema.Struct({
  general: GeneralSettings,
  editor: EditorSettings,
  camera: CameraSettings,
  appearance: AppearanceSettings,
  lighting: LightingSettings,
  snapping: SnappingSettings,
  panels: PanelSettings
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = {
  general: { units: "cm", creatorName: null, altDragDuplicates: true, exportOnSave: false, projectOpensIn: "ask" },
  editor: { placeDistance: PLACE_DISTANCE, undoSelection: false },
  camera: {
    flySpeed: 2000,
    lookSensitivity: 1,
    fovPreset: "Default",
    customFov: 90,
    invertLookX: false,
    invertLookY: false,
    lockPointer: "desktop",
    movementNeedsLook: "all"
  },
  appearance: {
    theme: "dark",
    gridVisible: true,
    gridCellColor: null,
    gridSectionColor: null,
    waterVisible: true,
    motion: "normal"
  },
  lighting: { mapLighting: true, skyVisible: true },
  snapping: {
    enabled: false,
    gridSize: DEFAULT_GRID_SIZE,
    rotationEnabled: false,
    rotationStep: DEFAULT_ROTATION_STEP
  },
  panels: { piecesView: "list" }
}

type Section = keyof Settings

const sections: ReadonlyArray<Section> = [
  "general",
  "editor",
  "camera",
  "appearance",
  "lighting",
  "snapping",
  "panels"
]

/** The fixed grid colours older saves stored; they now mean "automatic". */
const LEGACY_GRID_COLORS = { gridCellColor: "#3a404a", gridSectionColor: "#58606e" } as const

/**
 * Older saves kept `undoSelection` under general (it now lives under editor), stored the
 * old fixed grid colours whether or not they were chosen (they become automatic), and stored
 * an unset creator as "" (now null: use the name found).
 */
const migrate = (stored: unknown): unknown => {
  if (!Predicate.isObject(stored)) return stored
  let out: Record<string, unknown> = stored
  const general = out["general"]
  const editor = Predicate.isObject(out["editor"]) ? out["editor"] : {}
  if (Predicate.isObject(general) && "undoSelection" in general && !("undoSelection" in editor)) {
    out = { ...out, editor: { ...editor, undoSelection: general["undoSelection"] } }
  }
  if (Predicate.isObject(general) && general["creatorName"] === "") {
    out = { ...out, general: { ...general, creatorName: null } }
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
 * Automatic grid colours per theme, shades of the ground so they follow its hue. The sky is cut
 * off at the grid's height, so the grid is always seen against the ground, or the water over it.
 * Sections stand out more than cells: lighter on the dark ground, darker on the light one.
 */
export const AUTO_GRID_COLORS: Readonly<Record<"dark" | "light", { readonly cell: string; readonly section: string }>> =
  {
    dark: { cell: shadeOf(SCENE_COLORS.dark, "#ffffff", 0.22), section: shadeOf(SCENE_COLORS.dark, "#ffffff", 0.4) },
    light: { cell: shadeOf(SCENE_COLORS.light, "#000000", 0.4), section: shadeOf(SCENE_COLORS.light, "#000000", 0.52) }
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
