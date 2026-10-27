/**
 * Editor keybinds. Each action has a list of bindings (primary first); a binding is a
 * chord string: optional modifiers then a code, e.g. "KeyW", "Ctrl+KeyZ", a mouse button
 * "Mouse0" | "Mouse1" | "Mouse2", or a wheel direction "WheelUp" | "WheelDown". Key codes
 * are `KeyboardEvent.code`, so bindings follow physical key positions. An empty list means
 * unbound.
 */
import { Schema } from "effect"

/**
 * Sections and names follow the game: the level editor's own hotkey overlay ("select
 * mode", "move mode", "focus selection"...) and its settings screen ("mouse and keyboard
 * free camera": "forward", "reverse"...). Game actions that mean nothing in the editor
 * (replay controls, nameplates) are omitted; editor-only actions get plain lower-case
 * names in the same style. keybinds.json `label`/`section` fields, when the extractor
 * provides them, override the camera names (see GameKeybinds); level-editor names come
 * from the in-game overlay and are fixed here.
 */
export const keybindSections = [
  {
    name: "level editor",
    actions: ["selectMode", "translateMode", "rotateMode", "scaleMode", "focusSelection", "deleteSelection", "undo", "redo", "deselect"]
  },
  {
    name: "mouse and keyboard free camera",
    actions: ["moveForward", "moveBack", "moveLeft", "moveRight", "look", "moveUp", "moveDown"]
  },
  { name: "mouse and keyboard bindings", actions: ["lookRight", "lookLeft", "lookUp", "lookDown"] },
  { name: "editor camera", actions: ["fastMove", "speedFaster", "speedSlower", "orbit", "pan"] },
  { name: "file", actions: ["newMap", "importMap", "exportMap"] }
] as const

export type KeybindAction = (typeof keybindSections)[number]["actions"][number]
export const keybindActions: ReadonlyArray<KeybindAction> = keybindSections.flatMap((g) => g.actions)

export const KeybindActionSchema = Schema.Literals(keybindActions as unknown as readonly [KeybindAction, ...Array<KeybindAction>])

/** Actions named by the in-game level editor's hotkey overlay (keybinds.json naming doesn't apply). */
export const editorOverlayActions: ReadonlySet<KeybindAction> = new Set(keybindSections[0].actions)

/** The name shown in the settings (the game's wording where the action exists in-game). */
export const keybindActionLabels: Record<KeybindAction, string> = {
  selectMode: "select mode",
  translateMode: "move mode",
  rotateMode: "rotate mode",
  scaleMode: "scale mode",
  focusSelection: "focus selection",
  deleteSelection: "delete",
  undo: "undo",
  redo: "redo",
  deselect: "deselect",
  moveForward: "forward",
  moveBack: "reverse",
  moveLeft: "left",
  moveRight: "right",
  look: "look",
  moveUp: "up",
  moveDown: "down",
  lookRight: "look right",
  lookLeft: "look left",
  lookUp: "look up",
  lookDown: "look down",
  fastMove: "fly faster",
  speedFaster: "camera speed up",
  speedSlower: "camera speed down",
  orbit: "orbit",
  pan: "pan",
  newMap: "new map",
  importMap: "import map",
  exportMap: "export map"
}

/** What each action does in the editor (binding tooltips). */
export const keybindActionDescriptions: Record<KeybindAction, string> = {
  selectMode: "Select mode: click to select, no gizmo. Q in the game's level editor.",
  translateMode: "Move mode: drag the arrows or plane handles to move the selection. W in the game's level editor; the camera's W only flies while the look button is held.",
  rotateMode: "Rotate mode: drag a ring to rotate the selection. E in the game's level editor.",
  scaleMode: "Scale mode: drag a cube to scale along one axis, or the centre ring to scale uniformly. R in the game's level editor.",
  focusSelection: "Frame the current selection in the viewport. F in the game's level editor; its free camera calls this \"center camera\" (C).",
  deleteSelection: "Delete the selected item. Backspace in the game's level editor; Delete also works.",
  undo: "Undo the last change.",
  redo: "Redo the last undone change.",
  deselect: "Clear the selection. During a gizmo drag it cancels the drag instead. (The game uses Ctrl+click.)",
  moveForward: "Fly the camera forward while held.",
  moveBack: "Fly the camera backward while held.",
  moveLeft: "Fly the camera left while held.",
  moveRight: "Fly the camera right while held.",
  look: "Hold and drag to turn the camera. The game uses plain mouse movement; in the browser a button has to be held. While it's held, the fly keys never trigger tool shortcuts.",
  moveUp: "Fly the camera straight up while held.",
  moveDown: "Fly the camera straight down while held. The game uses Left Ctrl; the editor defaults to Left Shift so Ctrl+Z / Ctrl+Y never move the camera.",
  lookRight: "Turn the camera right while held.",
  lookLeft: "Turn the camera left while held.",
  lookUp: "Tilt the camera up while held.",
  lookDown: "Tilt the camera down while held.",
  fastMove: "Hold to fly several times faster. Unbound by default: the mouse wheel changes camera speed.",
  speedFaster: "Raise the camera's fly speed one step.",
  speedSlower: "Lower the camera's fly speed one step.",
  orbit: "Hold and drag to orbit around the focus point.",
  pan: "Hold and drag to slide the camera sideways and up/down.",
  newMap: "Start a new map.",
  importMap: "Open a .balledit or .ballmap file.",
  exportMap: "Download the map as a .balledit file for the game."
}

/** Actions bound to a mouse button held while dragging. */
export const mouseDragActions: ReadonlySet<KeybindAction> = new Set(["look", "orbit", "pan"])
/** Actions that are held down rather than fired once. */
export const heldActions: ReadonlySet<KeybindAction> = new Set([
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "moveUp",
  "moveDown",
  "lookRight",
  "lookLeft",
  "lookUp",
  "lookDown",
  "fastMove"
])

export type Bindings = ReadonlyArray<string>
export type Keybinds = Readonly<Record<KeybindAction, Bindings>>

/**
 * The defaults: the game's own bindings (its level-editor hotkey overlay and its settings
 * screen), plus editor-only actions. GameKeybinds overlays whatever assets/keybinds.json
 * defines on top.
 */
export const defaultKeybinds: Keybinds = {
  selectMode: ["KeyQ"],
  translateMode: ["KeyW"],
  rotateMode: ["KeyE"],
  scaleMode: ["KeyR"],
  focusSelection: ["KeyF", "KeyC"],
  deleteSelection: ["Backspace", "Delete"],
  undo: ["Ctrl+KeyZ"],
  redo: ["Ctrl+KeyY"],
  deselect: ["Escape"],
  moveForward: ["KeyW"],
  moveBack: ["KeyS"],
  moveLeft: ["KeyA"],
  moveRight: ["KeyD"],
  look: ["Mouse2"],
  moveUp: ["Space"],
  moveDown: ["ShiftLeft"],
  lookRight: ["ArrowRight"],
  lookLeft: ["ArrowLeft"],
  lookUp: ["ArrowUp"],
  lookDown: ["ArrowDown"],
  fastMove: [],
  speedFaster: ["WheelUp"],
  speedSlower: ["WheelDown"],
  orbit: ["Alt+Mouse0"],
  pan: ["Mouse1"],
  newMap: ["Alt+KeyN"],
  importMap: ["Ctrl+KeyO"],
  exportMap: ["Ctrl+KeyS"]
}

/**
 * Editor decisions that win over the game's mappings in keybinds.json:
 * "down" is Left Shift (the game's Left Ctrl collides with Ctrl+Z / Ctrl+Y).
 */
export const editorOverrides: Partial<Keybinds> = { moveDown: ["ShiftLeft"] }

/** What's persisted: any subset, unknown actions ignored. Older saves stored one string. */
export const StoredKeybinds = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String)]))
export type StoredKeybinds = typeof StoredKeybinds.Type

export const uniqueBindings = (bindings: ReadonlyArray<string>): Bindings => [...new Set(bindings.filter((b) => b.length > 0))]

export const mergeKeybinds = (stored: StoredKeybinds, defaults: Keybinds = defaultKeybinds): Keybinds => {
  const out: Record<string, Bindings> = { ...defaults }
  for (const action of keybindActions) {
    const value = stored[action]
    if (value === undefined) continue
    out[action] = uniqueBindings(typeof value === "string" ? [value] : value)
  }
  return out as Keybinds
}

export const sameBindings = (a: Bindings, b: Bindings): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** True when the action's bindings are exactly its defaults. */
export const isDefaultBinding = (keybinds: Keybinds, defaults: Keybinds, action: KeybindAction): boolean =>
  sameBindings(keybinds[action], defaults[action])

/** Is `chord` one of the action's bindings? */
export const isBound = (keybinds: Keybinds, action: KeybindAction, chord: string): boolean => keybinds[action].includes(chord)

/** The action(s) a chord is bound to. */
export const actionsFor = (keybinds: Keybinds, chord: string): ReadonlyArray<KeybindAction> =>
  keybindActions.filter((action) => keybinds[action].includes(chord))

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight"
])

interface ModifierState {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

const withModifiers = (e: ModifierState, code: string): string => {
  const mods: Array<string> = []
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl")
  if (e.altKey) mods.push("Alt")
  if (e.shiftKey) mods.push("Shift")
  return [...mods, code].join("+")
}

/** Chord string for a key event. Modifier keys pressed on their own produce just their code. */
export const chordOf = (e: ModifierState & { readonly code: string }): string =>
  MODIFIER_CODES.has(e.code) ? e.code : withModifiers(e, e.code)

export const mouseChordOf = (e: ModifierState & { readonly button: number }): string => withModifiers(e, `Mouse${e.button}`)
export const wheelChordOf = (e: ModifierState & { readonly deltaY: number }): string =>
  withModifiers(e, e.deltaY < 0 ? "WheelUp" : "WheelDown")

/** The key code a binding waits for, ignoring modifiers (used for held movement keys). */
export const baseCodeOf = (binding: string): string => binding.slice(binding.lastIndexOf("+") + 1)

/** True when `chord` is bound to a one-shot action (anything that isn't held or a drag). */
export const isOneShotChord = (keybinds: Keybinds, chord: string): boolean =>
  actionsFor(keybinds, chord).some((action) => !heldActions.has(action) && !mouseDragActions.has(action))

/** True when `chord` (from chordOf) is bound to a one-shot action with a modifier, e.g. Ctrl+KeyZ. */
export const isBoundChord = (keybinds: Keybinds, chord: string): boolean => chord.includes("+") && isOneShotChord(keybinds, chord)

export const isModifierCode = (code: string): boolean => MODIFIER_CODES.has(code)

/** How long a bare modifier must be held alone before it drives a held action (fly down on Ctrl). */
export const MODIFIER_HOLD_MS = 120

/**
 * Tracks held keys for continuous actions. A bare modifier (Ctrl/Shift/Alt) bound to a
 * held action only counts once it has been held for MODIFIER_HOLD_MS; pressing a key that
 * completes a bound chord while it's down (Ctrl+Z when "down" is Left Ctrl) suppresses it
 * until it's released. Other keys (Shift+W flying down and forward) don't. So chords take
 * precedence over a modifier used as a movement key.
 */
export class HeldKeys {
  private readonly downAt = new Map<string, number>()
  private readonly suppressed = new Set<string>()

  /** `completesChord`: this press formed a bound one-shot chord with the held modifiers. */
  press(code: string, now: number, completesChord = false): void {
    if (!this.downAt.has(code)) this.downAt.set(code, now)
    if (completesChord && !MODIFIER_CODES.has(code)) {
      for (const held of this.downAt.keys()) if (MODIFIER_CODES.has(held)) this.suppressed.add(held)
    }
  }

  release(code: string): void {
    this.downAt.delete(code)
    this.suppressed.delete(code)
  }

  clear(): void {
    this.downAt.clear()
    this.suppressed.clear()
  }

  has(code: string): boolean {
    return this.downAt.has(code)
  }

  anyModifierHeld(): boolean {
    for (const code of this.downAt.keys()) if (MODIFIER_CODES.has(code)) return true
    return false
  }

  /** Is one of the action's bindings held? (bare modifiers obey the chord rule) */
  holdsAny(bindings: Bindings, now: number): boolean {
    return bindings.some((binding) => this.holds(binding, now))
  }

  /** Is the binding's key held, for a held action? (bare modifiers obey the chord rule) */
  holds(binding: string, now: number): boolean {
    if (binding.length === 0) return false
    const code = baseCodeOf(binding)
    const since = this.downAt.get(code)
    if (since === undefined) return false
    if (!MODIFIER_CODES.has(code)) return true
    return !this.suppressed.has(code) && now - since >= MODIFIER_HOLD_MS
  }
}

/** Display form of one chord, e.g. "Ctrl + Z", "RMB", "←". */
export const formatBinding = (binding: string): string =>
  binding.length === 0 ? "Unbound" : binding
    .split("+")
    .map((part) => {
      if (part.startsWith("Key")) return part.slice(3)
      if (part.startsWith("Digit")) return part.slice(5)
      if (part === "Mouse0") return "LMB"
      if (part === "Mouse1") return "MMB"
      if (part === "Mouse2") return "RMB"
      if (part.startsWith("Mouse")) return `Mouse ${Number(part.slice(5)) + 1}`
      const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }
      if (arrows[part] !== undefined) return arrows[part]
      if (part === "WheelUp") return "Wheel up"
      if (part === "WheelDown") return "Wheel down"
      if (part.endsWith("Left") && MODIFIER_CODES.has(part)) return part.replace("Left", "")
      if (part.endsWith("Right") && MODIFIER_CODES.has(part)) return `Right ${part.replace("Right", "")}`
      return part
    })
    .join(" + ")

/** Display form of an action's bindings ("Q / F", or "Unbound"). */
export const formatBindings = (bindings: Bindings): string =>
  bindings.length === 0 ? "Unbound" : bindings.map(formatBinding).join(" / ")
