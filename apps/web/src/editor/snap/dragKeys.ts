/**
 * The keys that change a drag once it has begun (docs/SNAPPING.md § Modifiers), for the gizmo's, a body drag's and a
 * palette drop's alike. Which keys those are is `actionWhen` in domain/Keybinds.ts: the actions live in the drag under
 * way. This file keeps what is pressed, applies the key to the drag, and lists the keys for the status bar.
 */
import {
  actionWhen,
  bindingHeld,
  cancelsGesture,
  chordOf,
  duringDragActions,
  type KeybindAction,
  keybindActionHints,
  keybindActions,
  type Keybinds,
  resolveChord
} from "../../domain/Keybinds"
import { type KeyContext, matches } from "../../domain/keyContext"
import { SNAP_KINDS, type SnapKind } from "../../domain/snapConfig"
import { type DragKeysShown, useEditor } from "../store"
import type { MoveLock, MoveSession } from "./moveSession"

export interface DragKeyState {
  /** The codes down now. */
  readonly pressed: Set<string>
  /** What the drag does, for the keys the status bar offers. */
  readonly transform: DragKeysShown["transform"]
  /** The move's lock, as the status bar shows it. */
  lock: MoveLock | undefined
}

interface Modifiers {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

/** Follows the modifiers an event reports into `pressed`, as a key can come up while the window isn't looking. */
const held = (pressed: Set<string>, { ctrlKey, shiftKey }: Modifiers) => {
  const follow = (down: boolean, left: string, right: string) => {
    if (!down) {
      pressed.delete(left)
      pressed.delete(right)
    } else if (!pressed.has(left) && !pressed.has(right)) {
      pressed.add(left)
    }
  }
  follow(ctrlKey, "ControlLeft", "ControlRight")
  follow(shiftKey, "ShiftLeft", "ShiftRight")
}

/**
 * The context a drag's keys resolve in. A drag key never names a tool or a platform, so the drag is all that counts:
 * the keys don't change with the tool a drag was started in.
 */
const dragContext = (transform: DragKeysShown["transform"]): KeyContext => ({
  drag: transform,
  tool: "select",
  platform: "desktop"
})

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
export const seedDragKeys = (e: Modifiers, transform: DragKeysShown["transform"] = "move"): DragKeyState => {
  const state: DragKeyState = { pressed: new Set<string>(), transform, lock: undefined }
  held(state.pressed, e)
  show(state)
  return state
}

/** Keeps up with the modifiers an event reports, as a key can come up while the window isn't looking. */
export const syncDragKeys = (state: DragKeyState, e: Modifiers): void => {
  held(state.pressed, e)
  show(state)
}

/** A key up during a drag. */
export const releaseDragKey = (state: DragKeyState, code: string): void => {
  state.pressed.delete(code)
  show(state)
}

const LOCKS: Partial<Record<KeybindAction, MoveLock>> = {
  snapLockX: { axis: "x", plane: false },
  snapLockY: { axis: "y", plane: false },
  snapLockZ: { axis: "z", plane: false },
  snapPlaneX: { axis: "x", plane: true },
  snapPlaneY: { axis: "y", plane: true },
  snapPlaneZ: { axis: "z", plane: true }
}

/** The key that narrows snapping to each kind while it is held. */
const ONLY_ACTIONS: Readonly<Record<SnapKind, KeybindAction>> = {
  connectors: "snapOnlyConnectors",
  mesh: "snapOnlyMesh",
  alignment: "snapOnlyAlignment"
}

/** The kinds whose keys are held, of the codes `pressed`. */
export const heldKindsOf = (keybinds: Keybinds, pressed: ReadonlySet<string>): ReadonlyArray<SnapKind> =>
  SNAP_KINDS.filter((kind) => keybinds[ONLY_ACTIONS[kind]].some((binding) => bindingHeld(binding, pressed)))

/**
 * Whether a palette drop lands with snapping held off. A drop is the browser's own drag, which reports its modifiers
 * and no key codes, so only a snapping-off key that is a modifier can be held through one.
 */
export const dropSnapOff = (keybinds: Keybinds, e: Modifiers): boolean => {
  const pressed = new Set<string>()
  held(pressed, e)
  return matches(actionWhen.snapOff, { ...dragContext("move"), drag: "place" }) &&
    keybinds.snapOff.some((binding) => bindingHeld(binding, pressed))
}

/** What a key press has to say, for what a drag does with it. */
export type DragKeyEvent = Pick<
  KeyboardEvent,
  "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopImmediatePropagation"
>

/**
 * The drag key `e` presses, if any: the action bound to its chord that is live in this drag. Ctrl and Shift are drag
 * keys themselves, so the chord is read without Ctrl, and a key is also tried bare, so J narrows with Ctrl held
 * (snapping off, but for the ends) and X locks with Shift held.
 */
const dragActionOf = (state: DragKeyState, e: DragKeyEvent, keybinds: Keybinds): KeybindAction | undefined => {
  const ctx = dragContext(state.transform)
  const chord = chordOf({ altKey: e.altKey, metaKey: false, shiftKey: e.shiftKey, ctrlKey: false, code: e.code })
  for (const candidate of chord === e.code ? [chord] : [chord, e.code]) {
    // cancelling is the drag's own too, but ends it rather than changing it: `cancelsDrag`
    const action = resolveChord(keybinds, ctx, candidate).find((one) =>
      duringDragActions.has(one) && one !== "cancelDrag"
    )
    if (action !== undefined) return action
  }
  return undefined
}

/**
 * A key down during a drag: it's noted, a key the drag takes is the drag's alone, and a lock key sets or clears its
 * lock. True when the drag took the key. A press that is not yet a drag has no `session` and takes no lock.
 */
export const handleDragKey = (
  state: DragKeyState,
  session: MoveSession | undefined,
  e: DragKeyEvent,
  keybinds: Keybinds
): boolean => {
  state.pressed.add(e.code)
  show(state)
  const action = dragActionOf(state, e, keybinds)
  if (action === undefined) return false
  const lock = LOCKS[action]
  // a press that hasn't become a drag has nothing to lock yet
  if (lock !== undefined && session === undefined) return false
  // a fly key or a shortcut on the same key would act on it too
  e.preventDefault()
  e.stopImmediatePropagation()
  if (lock === undefined || session === undefined || e.repeat) return true
  session.toggleLock(lock)
  state.lock = session.lock
  show(state)
  return true
}

/**
 * Whether `e` is the drag's cancel key: `cancelDrag`, live in the drags the gizmo and a body drag make. The key counts
 * bare too, so Escape cancels with Shift (hold), Ctrl (snapping off) or Alt (a copy's drag) still down.
 */
export const cancelsDrag = (state: DragKeyState, e: DragKeyEvent, keybinds: Keybinds): boolean =>
  cancelsGesture(keybinds, state.transform, e)

/** One of the status bar's hints: the keys, and the word for what they do. */
export interface DragHint {
  readonly id: string
  readonly keys: ReadonlyArray<{ readonly binding: string; readonly active: boolean }>
  readonly word: string
  readonly active: boolean
}

/**
 * The keys `shown`'s drag can take, Blender style: every action with a hint word that is live in the drag
 * (`actionWhen`), so a turn offers no lock and a scale only the mesh, with what is held or the axis locked lit. Keys
 * that share a word share a hint (X, Y and Z: lock). An action with no binding has no hint.
 */
export const dragHintsOf = (
  keybinds: Keybinds,
  { lock, pressed, transform }: DragKeysShown
): ReadonlyArray<DragHint> => {
  const down = new Set(pressed)
  const ctx = dragContext(transform)
  const hints: Array<DragHint> = []
  for (const action of keybindActions) {
    const word = keybindActionHints[action]
    const binding = keybinds[action][0]
    if (word === undefined || binding === undefined || !matches(actionWhen[action], ctx)) continue
    const locks = LOCKS[action]
    const active = locks === undefined
      ? keybinds[action].some((one) => bindingHeld(one, down))
      : lock?.axis === locks.axis
    const key = { binding, active }
    const shared = hints.find((hint) => hint.word === word)
    if (shared === undefined) hints.push({ id: word, keys: [key], word, active })
    else hints[hints.indexOf(shared)] = { ...shared, keys: [...shared.keys, key], active: shared.active || active }
  }
  return hints
}
