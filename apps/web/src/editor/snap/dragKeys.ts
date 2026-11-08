/** The keys that change a drag once it has begun (docs/SNAPPING.md § Modifiers), for the gizmo's and a body drag alike. */
import { baseCodeOf, bindingHeld, chordOf, type KeybindAction, type Keybinds } from "../../domain/Keybinds"
import { SNAP_KINDS, SNAP_KINDS_OF, type SnapKind, type SnapTransform } from "../../domain/snapConfig"
import { type DragKeysShown, useEditor } from "../store"
import type { MoveLock, MoveSession } from "./moveSession"

export interface DragKeyState {
  /** The codes down now. */
  readonly pressed: Set<string>
  /** What the drag does, for the keys the status bar offers. */
  readonly transform: SnapTransform
  /** The move's lock, as the status bar shows it. */
  lock: MoveLock | undefined
}

interface Modifiers {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

const held = (state: DragKeyState, { ctrlKey, shiftKey }: Modifiers) => {
  const follow = (down: boolean, left: string, right: string) => {
    if (!down) {
      state.pressed.delete(left)
      state.pressed.delete(right)
    } else if (!state.pressed.has(left) && !state.pressed.has(right)) {
      state.pressed.add(left)
    }
  }
  follow(ctrlKey, "ControlLeft", "ControlRight")
  follow(shiftKey, "ShiftLeft", "ShiftRight")
}

/** Shows the keys in the status bar, when they have changed since it last did. */
const show = ({ lock, pressed, transform }: DragKeyState) => {
  const s = useEditor.getState()
  const next: DragKeysShown = { transform, pressed: [...pressed], lock }
  const now = s.dragKeys
  const same = now?.transform === transform && now.lock?.axis === lock?.axis &&
    now.lock?.plane === lock?.plane && now.pressed.join() === next.pressed.join()
  if (!same) s.setDragKeys(next)
}

/** The keys as a drag starts, or a press that may become one: a modifier pressed before it counts. */
export const seedDragKeys = (e: Modifiers, transform: SnapTransform = "move"): DragKeyState => {
  const state: DragKeyState = { pressed: new Set<string>(), transform, lock: undefined }
  held(state, e)
  show(state)
  return state
}

/** Keeps up with the modifiers an event reports, as a key can come up while the window isn't looking. */
export const syncDragKeys = (state: DragKeyState, e: Modifiers): void => {
  held(state, e)
  show(state)
}

/** A key up during a drag. */
export const releaseDragKey = (state: DragKeyState, code: string): void => {
  state.pressed.delete(code)
  show(state)
}

const LOCKS = [
  ["snapLockX", { axis: "x", plane: false }],
  ["snapLockY", { axis: "y", plane: false }],
  ["snapLockZ", { axis: "z", plane: false }],
  ["snapPlaneX", { axis: "x", plane: true }],
  ["snapPlaneY", { axis: "y", plane: true }],
  ["snapPlaneZ", { axis: "z", plane: true }]
] as const satisfies ReadonlyArray<readonly [keyof Keybinds, MoveLock]>

/** The key that narrows snapping to each kind while it is held. */
const ONLY_ACTIONS: Readonly<Record<SnapKind, KeybindAction>> = {
  grid: "snapOnlyGrid",
  connectors: "snapOnlyConnectors",
  mesh: "snapOnlyMesh",
  alignment: "snapOnlyAlignment",
  step: "snapOnlyStep"
}

/** The kinds whose keys are held, of the codes `pressed`. */
export const heldKindsOf = (keybinds: Keybinds, pressed: ReadonlySet<string>): ReadonlyArray<SnapKind> =>
  SNAP_KINDS.filter((kind) => keybinds[ONLY_ACTIONS[kind]].some((binding) => bindingHeld(binding, pressed)))

/** Whether `code` is the key of one of the bindings that narrow snapping. */
const narrowsWith = (keybinds: Keybinds, code: string) =>
  SNAP_KINDS.some((kind) => keybinds[ONLY_ACTIONS[kind]].some((binding) => baseCodeOf(binding) === code))

/** What a key press has to say, for what a drag does with it. */
export type DragKeyEvent = Pick<
  KeyboardEvent,
  "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopImmediatePropagation"
>

/**
 * A key down during a drag: it's noted, a narrowing key is the drag's alone, and a lock key sets or clears its lock. True
 * when the drag took the key. Ctrl doesn't stop a lock key, so inverted snapping can be locked too. A turn or scale has no
 * `session` and takes no lock.
 */
export const handleDragKey = (
  state: DragKeyState,
  session: MoveSession | undefined,
  e: DragKeyEvent,
  keybinds: Keybinds
): boolean => {
  state.pressed.add(e.code)
  show(state)
  if (keybinds.snapInvert.includes(e.code) || keybinds.snapHold.includes(e.code)) return true
  if (narrowsWith(keybinds, e.code)) {
    // a fly key or a shortcut on the same key would act on it too
    e.preventDefault()
    e.stopImmediatePropagation()
    return true
  }
  if (session === undefined || e.repeat) return false
  const chord = chordOf({ altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, ctrlKey: false, code: e.code })
  const lock = LOCKS.find(([action]) => keybinds[action].includes(chord))
  if (lock === undefined) return false
  e.preventDefault()
  e.stopImmediatePropagation()
  session.toggleLock(lock[1])
  state.lock = session.lock
  show(state)
  return true
}

/** One of the status bar's hints: the keys, and the word for what they do. */
export interface DragHint {
  readonly id: string
  readonly keys: ReadonlyArray<{ readonly binding: string; readonly active: boolean }>
  readonly word: string
  readonly active: boolean
}

const KIND_WORDS: Readonly<Record<SnapKind, string>> = {
  grid: "grid",
  connectors: "connectors",
  mesh: "mesh",
  alignment: "align",
  step: "step"
}

/**
 * The keys `shown`'s drag can take, Blender style: what is held lit, and only what the drag can use, so a turn offers no
 * hold or lock. An action with no binding has no hint.
 */
export const dragHintsOf = (
  keybinds: Keybinds,
  { lock, pressed, transform }: DragKeysShown
): ReadonlyArray<DragHint> => {
  const down = new Set(pressed)
  const firstOf = (action: KeybindAction) => keybinds[action][0]
  const heldHint = (id: string, action: KeybindAction, word: string): ReadonlyArray<DragHint> => {
    const binding = firstOf(action)
    if (binding === undefined) return []
    const active = keybinds[action].some((one) => bindingHeld(one, down))
    return [{ id, keys: [{ binding, active }], word, active }]
  }
  const locks = (["x", "y", "z"] as const).flatMap((axis) => {
    const binding = firstOf(axis === "x" ? "snapLockX" : axis === "y" ? "snapLockY" : "snapLockZ")
    return binding === undefined ? [] : [{ binding, active: lock?.axis === axis }]
  })
  const move = transform === "move"
  return [
    ...heldHint("invert", "snapInvert", "invert"),
    ...(move ? heldHint("hold", "snapHold", "hold") : []),
    ...(move && locks.length > 0
      ? [{ id: "lock", keys: locks, word: "lock", active: lock !== undefined }]
      : []),
    ...SNAP_KINDS_OF[transform].flatMap((kind) => heldHint(kind, ONLY_ACTIONS[kind], KIND_WORDS[kind]))
  ]
}
