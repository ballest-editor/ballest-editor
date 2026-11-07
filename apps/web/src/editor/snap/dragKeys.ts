/** The keys that change a drag once it has begun (docs/SNAPPING.md § Modifiers), for the gizmo's and a body drag alike. */
import { chordOf, type Keybinds } from "../../domain/Keybinds"
import type { MoveLock, MoveSession } from "./moveSession"

export interface DragKeyState {
  /** The codes down now. */
  readonly pressed: Set<string>
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

/** The keys as a drag starts: a modifier pressed before it counts. */
export const seedDragKeys = (e: Modifiers): DragKeyState => {
  const state = { pressed: new Set<string>() }
  held(state, e)
  return state
}

/** Keeps up with the modifiers an event reports, as a key can come up while the window isn't looking. */
export const syncDragKeys = (state: DragKeyState, e: Modifiers): void => held(state, e)

const LOCKS = [
  ["snapLockX", { axis: "x", plane: false }],
  ["snapLockY", { axis: "y", plane: false }],
  ["snapLockZ", { axis: "z", plane: false }],
  ["snapPlaneX", { axis: "x", plane: true }],
  ["snapPlaneY", { axis: "y", plane: true }],
  ["snapPlaneZ", { axis: "z", plane: true }]
] as const satisfies ReadonlyArray<readonly [keyof Keybinds, MoveLock]>

/** What a key press has to say, for what a drag does with it. */
export type DragKeyEvent = Pick<
  KeyboardEvent,
  "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopImmediatePropagation"
>

/**
 * A key down during a drag: it's noted, and a lock key sets or clears its lock. True when the drag took the key. Ctrl
 * doesn't stop a lock key, so inverted snapping can be locked too. A turn or scale has no `session` and takes no lock.
 */
export const handleDragKey = (
  state: DragKeyState,
  session: MoveSession | undefined,
  e: DragKeyEvent,
  keybinds: Keybinds
): boolean => {
  state.pressed.add(e.code)
  if (keybinds.snapInvert.includes(e.code) || keybinds.snapHold.includes(e.code)) return true
  if (session === undefined || e.repeat) return false
  const chord = chordOf({ altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, ctrlKey: false, code: e.code })
  const lock = LOCKS.find(([action]) => keybinds[action].includes(chord))
  if (lock === undefined) return false
  e.preventDefault()
  e.stopImmediatePropagation()
  session.toggleLock(lock[1])
  return true
}
