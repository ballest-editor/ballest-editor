/**
 * The game's own default bindings (assets/keybinds.json from tools/extract, parsed
 * Enhanced Input contexts) mapped onto editor actions.
 *
 * In the cooked game IMC_LevelEditor / IMC_ModeEditor are empty: the level editor's own
 * hotkeys (gizmo modes, delete, undo...) are compiled into the SKG C++ plugin. So the
 * camera comes from IMC_FreeCam, Escape from IMC_Universal, and everything else uses
 * `defaultKeybinds` (reported as fallbacks). Modifier subobjects with `settings: null`
 * are game-native modifiers the extractor couldn't parse; they're ignored.
 */
import { Schema } from "effect"
import {
  type Bindings,
  defaultKeybinds,
  editorOverlayActions,
  editorOverrides,
  heldActions,
  type KeybindAction,
  type Keybinds,
  uniqueBindings
} from "./Keybinds"

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const
const open = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), Rest)

const Settings = Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)))
export const SubobjectSettings = open({ type: Schema.NullOr(Schema.String), settings: Settings })

export const GameMapping = open({
  action: Schema.NullOr(Schema.String),
  key: Schema.NullOr(Schema.String),
  modifiers: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  triggers: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  modifierSettings: Schema.optionalKey(Schema.Array(SubobjectSettings)),
  triggerSettings: Schema.optionalKey(Schema.Array(SubobjectSettings)),
  ignored: Schema.optionalKey(Schema.Boolean),
  /** Name and section from the game's settings screen, when the extractor provides them. */
  label: Schema.optionalKey(Schema.NullOr(Schema.String)),
  section: Schema.optionalKey(Schema.NullOr(Schema.String))
})
export type GameMapping = typeof GameMapping.Type

export const GameContext = open({ name: Schema.String, mappings: Schema.Array(GameMapping) })

export const GameSection = open({ name: Schema.String })
export const GameCameraPreset = open({ row: Schema.String, label: Schema.String, fov: Schema.Finite })

export const GameKeybindsFile = open({
  contexts: Schema.Array(GameContext),
  actions: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  /** The game's settings-screen sections, in UI order. */
  sections: Schema.optionalKey(Schema.Array(GameSection)),
  /** DT_CameraSettingsPresets rows (fov is horizontal, degrees). */
  cameraPresets: Schema.optionalKey(Schema.Array(GameCameraPreset))
})
export type GameKeybindsFile = typeof GameKeybindsFile.Type

// ---------------------------------------------------------------------------
// UE FKey name -> KeyboardEvent.code (or our Mouse*/Wheel* codes). The one table.

const letters = Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => [c, `Key${c}`]))
const digits = Object.fromEntries(
  ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"].flatMap((name, i) => [
    [name, `Digit${i}`],
    [`NumPad${name}`, `Numpad${i}`]
  ])
)
const functionKeys = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]))

export const UE_KEY_TO_CODE: Readonly<Record<string, string>> = {
  ...letters,
  ...digits,
  ...functionKeys,
  SpaceBar: "Space",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  BackSpace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  LeftShift: "ShiftLeft",
  RightShift: "ShiftRight",
  LeftControl: "ControlLeft",
  RightControl: "ControlRight",
  LeftAlt: "AltLeft",
  RightAlt: "AltRight",
  LeftCommand: "MetaLeft",
  RightCommand: "MetaRight",
  CapsLock: "CapsLock",
  Hyphen: "Minus",
  Equals: "Equal",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  Semicolon: "Semicolon",
  Apostrophe: "Quote",
  Tilde: "Backquote",
  LeftBracket: "BracketLeft",
  RightBracket: "BracketRight",
  Add: "NumpadAdd",
  Subtract: "NumpadSubtract",
  Multiply: "NumpadMultiply",
  Divide: "NumpadDivide",
  Decimal: "NumpadDecimal",
  LeftMouseButton: "Mouse0",
  MiddleMouseButton: "Mouse1",
  RightMouseButton: "Mouse2",
  ThumbMouseButton: "Mouse3",
  ThumbMouseButton2: "Mouse4",
  MouseScrollUp: "WheelUp",
  MouseScrollDown: "WheelDown",
  MouseWheelAxis: "WheelUp"
}

const MODIFIER_PREFIX: Readonly<Record<string, string>> = {
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  MetaLeft: "Ctrl",
  MetaRight: "Ctrl",
  AltLeft: "Alt",
  AltRight: "Alt",
  ShiftLeft: "Shift",
  ShiftRight: "Shift"
}

// ---------------------------------------------------------------------------
// Axis direction of a mapping: the key's value (1 on X) after Enhanced Input modifiers.

type Vec = readonly [number, number, number]

const swizzle = (v: Vec, order: string): Vec => {
  const axes = order.replace(/^.*::/, "").toUpperCase()
  const pick = (c: string) => v["XYZ".indexOf(c)] ?? 0
  return axes.length === 3 ? [pick(axes[0]!), pick(axes[1]!), pick(axes[2]!)] : v
}

export const mappingDirection = (mapping: GameMapping): Vec => {
  let v: Vec = [1, 0, 0]
  const settings = mapping.modifierSettings ?? (mapping.modifiers ?? []).map((type) => ({ type, settings: null }))
  for (const modifier of settings) {
    const type = modifier.type ?? ""
    const s = modifier.settings ?? {}
    if (/Negate/i.test(type)) {
      const flag = (k: string) => (s[k] === undefined ? true : s[k] === true)
      v = [flag("bX") ? -v[0] : v[0], flag("bY") ? -v[1] : v[1], flag("bZ") ? -v[2] : v[2]]
    } else if (/Swizzle/i.test(type)) {
      v = swizzle(v, typeof s["Order"] === "string" ? s["Order"] : "YXZ")
    }
  }
  return v
}

// ---------------------------------------------------------------------------
// Game action -> editor action. This table and EDITOR_CONTEXTS are the only things to
// change when the game's real editor hotkeys become available.

interface Binding {
  readonly action: KeybindAction
  /** Overrides the code derived from the mapping's key (for axis keys like the wheel). */
  readonly code?: string
}
type Resolver = (mapping: GameMapping) => ReadonlyArray<Binding>

const fixed = (action: KeybindAction): Resolver => () => [{ action }]
/** A 2D movement axis (WASD): direction after Negate/Swizzle picks the move action. */
const axis2D: Resolver = (m) => {
  const [x, y] = mappingDirection(m)
  if (Math.abs(y) > Math.abs(x)) return [{ action: y > 0 ? "moveForward" : "moveBack" }]
  if (x !== 0) return [{ action: x > 0 ? "moveRight" : "moveLeft" }]
  return []
}
const axis1D = (positive: KeybindAction, negative: KeybindAction): Resolver => (m) => [
  { action: mappingDirection(m)[0] >= 0 ? positive : negative }
]
/** Wheel axis: scrolling up drives the positive action. */
const wheelAxis = (up: KeybindAction, down: KeybindAction): Resolver => (m) =>
  m.key === "MouseWheelAxis" ? [{ action: up, code: "WheelUp" }, { action: down, code: "WheelDown" }] : axis1D(up, down)(m)
const mouseButtonOnly = (action: KeybindAction): Resolver => (m) => (/MouseButton$/.test(m.key ?? "") ? [{ action }] : [])
/** IA_Look: a mouse button is our drag-look; keyboard keys are the arrow-key look actions. */
const lookResolver: Resolver = (m) => {
  const key = m.key ?? ""
  if (/MouseButton$/.test(key)) return [{ action: "look" }]
  if (key.startsWith("Mouse") || key.startsWith("Gamepad") || UE_KEY_TO_CODE[key] === undefined) return []
  const [x, y] = mappingDirection(m)
  if (Math.abs(x) >= Math.abs(y) && x !== 0) return [{ action: x > 0 ? "lookRight" : "lookLeft" }]
  if (y !== 0) return [{ action: y < 0 ? "lookUp" : "lookDown" }] // UE look Y: negative is up
  return []
}

/** Keyed by the game action name without `IA_`, lower-cased. */
const GAME_ACTIONS: Readonly<Record<string, Resolver>> = {
  // IMC_FreeCam: the in-game free camera, the closest thing to the editor's camera.
  pan: axis2D,
  move: axis2D,
  height: axis1D("moveUp", "moveDown"),
  camspeedmodifier: wheelAxis("speedFaster", "speedSlower"),
  cameraspeedfaster: fixed("speedFaster"),
  cameraspeedslower: fixed("speedSlower"),
  camera: mouseButtonOnly("look"), // Mouse2D in game; the browser needs a held button
  look: lookResolver,
  centercamera: fixed("focusSelection"),
  // IMC_Universal
  pause: fixed("deselect"),
  // Editor actions the pak declares but no context maps yet (native SKG plugin hotkeys).
  translate: fixed("translateMode"),
  rotate: fixed("rotateMode"),
  scale: fixed("scaleMode")
}

/**
 * Contexts that apply to the editor, highest priority first. IMC_Default (racing) and
 * the menu/replay contexts reuse the same keys for other things, so they're excluded.
 */
export const EDITOR_CONTEXTS = ["IMC_LevelEditor", "IMC_ModeEditor", "IMC_FreeCam", "IMC_Universal"] as const

const chordFromMapping = (mapping: GameMapping, codeOverride: string | undefined): string | undefined => {
  const code = codeOverride ?? (mapping.key === null ? undefined : UE_KEY_TO_CODE[mapping.key])
  if (code === undefined) return undefined
  // A chord trigger names the action that must be held; take Ctrl/Alt/Shift from its name.
  const chordText = (mapping.triggerSettings ?? [])
    .filter((t) => /Chord/i.test(t.type ?? ""))
    .map((t) => JSON.stringify(t.settings ?? {}))
    .join(" ")
  const mods = [/ctrl|control/i, /alt/i, /shift/i]
    .map((re, i) => (re.test(chordText) ? ["Ctrl", "Alt", "Shift"][i]! : undefined))
    .filter((m): m is string => m !== undefined)
  return [...mods, code].join("+")
}

export interface ActionNaming {
  readonly label?: string
  readonly section?: string
}

export interface DerivedKeybinds {
  readonly keybinds: Keybinds
  /** Labels/sections from keybinds.json (override the built-in table when present). */
  readonly naming: ReadonlyMap<KeybindAction, ActionNaming>
  readonly fromGame: ReadonlyMap<KeybindAction, { readonly context: string; readonly action: string }>
  readonly fellBack: ReadonlyArray<KeybindAction>
  /** The game's section names in its settings-screen order (gamepad sections excluded). */
  readonly sectionOrder: ReadonlyArray<string>
  readonly cameraPresets: ReadonlyArray<CameraPreset>
}

export interface CameraPreset {
  readonly id: string
  readonly label: string
  /** Horizontal field of view, degrees. */
  readonly fov: number
}

/** Used when keybinds.json has no cameraPresets (values from DT_CameraSettingsPresets). */
export const FALLBACK_CAMERA_PRESETS: ReadonlyArray<CameraPreset> = [
  { id: "Default", label: "Default", fov: 90 },
  { id: "WideAngle", label: "Wide Angle", fov: 110 },
  { id: "OverTheShoulder", label: "Over the Shoulder", fov: 90 },
  { id: "Orbital", label: "Orbital", fov: 110 }
]

export const deriveKeybinds = (file: GameKeybindsFile | undefined): DerivedKeybinds => {
  const out: Record<string, Bindings> = { ...defaultKeybinds }
  const fromGame = new Map<KeybindAction, { context: string; action: string }>()
  const naming = new Map<KeybindAction, ActionNaming>()
  for (const name of EDITOR_CONTEXTS) {
    const context = file?.contexts.find((c) => c.name === name)
    for (const mapping of context?.mappings ?? []) {
      if (mapping.ignored === true || mapping.action === null) continue
      const resolver = GAME_ACTIONS[mapping.action.replace(/^IA_/, "").toLowerCase()]
      for (const { action, code } of resolver?.(mapping) ?? []) {
        const chord = chordFromMapping(mapping, code)
        if (chord === undefined) continue
        const base = chord.slice(chord.lastIndexOf("+") + 1)
        // Mouse-drag actions need a button.
        if ((action === "look" || action === "orbit" || action === "pan") && !base.startsWith("Mouse")) continue
        // A bare modifier key only works for held actions (e.g. LeftControl = fly down).
        if (MODIFIER_PREFIX[base] !== undefined && !heldActions.has(action)) continue
        // The first game mapping replaces the editor default; later ones become secondary
        // bindings. Level-editor overlay hotkeys stay primary (F focus, then the camera's C).
        const first = !fromGame.has(action)
        const keep = first && !editorOverlayActions.has(action) ? [] : out[action]!
        out[action] = uniqueBindings([...keep, chord])
        if (first) fromGame.set(action, { context: name, action: mapping.action })
      }
    }
  }
  // Names come from any context (the game shows them on its settings screen), free cam
  // first so e.g. "forward" is filed under the free camera. Labels are lower-cased like
  // the game's menus.
  const namingContexts = [
    ...EDITOR_CONTEXTS.map((name) => file?.contexts.find((c) => c.name === name)),
    ...(file?.contexts ?? []).filter((c) => !(EDITOR_CONTEXTS as ReadonlyArray<string>).includes(c.name))
  ]
  for (const context of namingContexts) {
    for (const mapping of context?.mappings ?? []) {
      if (mapping.action === null || !(mapping.label || mapping.section)) continue
      // Gamepad rows name gamepad controls; the editor is mouse and keyboard.
      if ((mapping.key ?? "").startsWith("Gamepad") || /gamepad/i.test(mapping.section ?? "")) continue
      const resolver = GAME_ACTIONS[mapping.action.replace(/^IA_/, "").toLowerCase()]
      for (const { action } of resolver?.(mapping) ?? []) {
        if (naming.has(action) || editorOverlayActions.has(action)) continue
        naming.set(action, {
          ...(mapping.label ? { label: mapping.label.toLowerCase() } : {}),
          ...(mapping.section ? { section: mapping.section } : {})
        })
      }
    }
  }
  for (const [action, bindings] of Object.entries(editorOverrides) as Array<[KeybindAction, Bindings]>) {
    out[action] = bindings
    fromGame.delete(action)
  }
  const fellBack = (Object.keys(defaultKeybinds) as Array<KeybindAction>).filter((a) => !fromGame.has(a))
  const sectionOrder = (file?.sections ?? []).map((s) => s.name).filter((name) => !/gamepad/i.test(name))
  const cameraPresets = file?.cameraPresets !== undefined && file.cameraPresets.length > 0
    ? file.cameraPresets.map((p) => ({ id: p.row, label: p.label, fov: p.fov }))
    : FALLBACK_CAMERA_PRESETS
  return { keybinds: out as Keybinds, naming, fromGame, fellBack, sectionOrder, cameraPresets }
}
