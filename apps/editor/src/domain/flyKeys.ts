/**
 * Which movement keys fly the camera right now. The "movement keys need look" setting picks
 * which ones only fly while the look button is held; the rest fly any time. A movement key
 * that is also a one-shot shortcut (W = forward and translate, as in the game's editor) is
 * resolved separately: unless the setting is "nothing", it flies while looking or while
 * another movement key is already flying the camera, and otherwise is left to its shortcut.
 * Under "nothing" it does both: it always flies, and its shortcut fires on press too.
 */
import { isOneShotChord, type Keybinds } from "./Keybinds"

/** "all" matches the game: every movement key waits for the look button. */
export const movementLookModes = ["all", "upDown", "conflicting", "nothing"] as const
export type MovementLookMode = (typeof movementLookModes)[number]

export const movementActions = ["moveForward", "moveBack", "moveLeft", "moveRight", "moveUp", "moveDown"] as const
export type MovementAction = (typeof movementActions)[number]

/** Does this movement action only fly while the look button is held? */
export const needsLook = (mode: MovementLookMode, action: MovementAction): boolean =>
  mode === "all" || (mode === "upDown" && (action === "moveUp" || action === "moveDown"))

/** Do movement keys that are also shortcuts fly any time (and fire their shortcut as well)? */
export const sharedKeysFlyFreely = (mode: MovementLookMode): boolean => mode === "nothing"

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
  const plain = allowed.filter((action) =>
    heldWhere(action, false) || (sharedKeysFlyFreely(mode) && heldWhere(action, true))
  )
  // Shortcut keys fly while looking or alongside a plain movement key that is flying.
  const shortcutsFly = looking || plain.length > 0
  return new Set(shortcutsFly ? allowed.filter((action) => plain.includes(action) || heldWhere(action, true)) : plain)
}

/** Is `chord` one of the movement bindings (so it flies instead of firing its shortcut while moving)? */
export const isMovementChord = (keybinds: Keybinds, chord: string): boolean =>
  movementActions.some((action) => keybinds[action].includes(chord))
