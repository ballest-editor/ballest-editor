/**
 * Which movement keys fly the camera right now. The "movement keys need look" setting picks
 * which ones only fly while the look button is held; the rest fly any time. A movement key
 * that is also a one-shot shortcut (W = forward and move mode, as in the game's editor) is
 * resolved separately: it flies while looking or while another movement key is already
 * flying the camera, and otherwise is left to its shortcut.
 */
import { isOneShotChord, type Keybinds } from "./Keybinds"

export const movementLookModes = ["none", "upDown", "all"] as const
export type MovementLookMode = (typeof movementLookModes)[number]

export const movementActions = ["moveForward", "moveBack", "moveLeft", "moveRight", "moveUp", "moveDown"] as const
export type MovementAction = (typeof movementActions)[number]

/** Does this movement action only fly while the look button is held? */
export const needsLook = (mode: MovementLookMode, action: MovementAction): boolean =>
  mode === "all" || (mode === "upDown" && (action === "moveUp" || action === "moveDown"))

/** The movement actions that fly the camera, given which bindings are held. */
export const flyingActions = (
  keybinds: Keybinds,
  mode: MovementLookMode,
  looking: boolean,
  holds: (binding: string) => boolean
): ReadonlySet<MovementAction> => {
  const allowed = movementActions.filter((action) => looking || !needsLook(mode, action))
  const heldWhere = (action: MovementAction, shortcut: boolean): boolean =>
    keybinds[action].some((binding) => holds(binding) && isOneShotChord(keybinds, binding) === shortcut)
  const plain = allowed.filter((action) => heldWhere(action, false))
  // Shortcut keys fly while looking or alongside a plain movement key that is flying.
  const shortcutsFly = looking || plain.length > 0
  return new Set(shortcutsFly ? allowed.filter((action) => plain.includes(action) || heldWhere(action, true)) : plain)
}

/** Is `chord` one of the movement bindings (so it flies instead of firing its shortcut while moving)? */
export const isMovementChord = (keybinds: Keybinds, chord: string): boolean =>
  movementActions.some((action) => keybinds[action].includes(chord))
