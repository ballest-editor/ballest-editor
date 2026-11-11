import { useEffect } from "react"
import { isMovementChord, sharedKeysFlyFreely } from "../domain/flyKeys"
import { chordOf, releasesBinding, resolveChord } from "../domain/Keybinds"
import { commandFor } from "./commands"
import { keyContextOf } from "./keyContext"
import { isEditorKeyEvent } from "./keyTargets"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

/**
 * One-shot actions, matched on the full chord in the editor's context (`keyContextOf`): nothing fires in text fields,
 * dialogs or menus, and a binding fires only where its action works (`actionWhen`), so during a look, a gizmo drag, a
 * body drag or a number-field scrub the one-shots wait (a drag commits as one undo step on release; undo or delete
 * mid-drag would be overwritten or orphan it) and the drag's own keys have the keyboard. A chord bound to nothing that
 * works here falls through to the browser, which is how F5 still reloads in a browser, where Play has no binding. A
 * gesture under way takes its cancel key first, in its own capture listener; the deselect key then steps back one level
 * (`deselect`, docs/DESKTOP.md § Escape). The cheat sheet is the one held action here: it hides when a key of
 * its binding is released or the window blurs.
 */
export function useActionKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isEditorKeyEvent(e) || e.repeat) return
      const chord = chordOf(e)
      const { keybinds, settings } = useEditor.getState()
      // A movement key that is also a tool shortcut (W: forward + translate) joins an ongoing
      // flight instead of switching tool, unless no movement key needs look: then it does both.
      if (
        isMovementChord(keybinds, chord)
        && sceneRegistry.flyKeysActive()
        && !sharedKeysFlyFreely(settings.camera.movementNeedsLook)
      ) return
      const actions = resolveChord(keybinds, keyContextOf(), chord)
      for (const action of actions) {
        const run = commandFor(action)
        if (run === undefined) continue
        e.preventDefault()
        run()
        return
      }
    }
    const hideCheatSheet = () => useEditor.getState().setCheatSheet(false)
    const onKeyUp = (e: KeyboardEvent) => {
      const { cheatSheet, keybinds } = useEditor.getState()
      if (cheatSheet && keybinds.showKeybinds.some((binding) => releasesBinding(binding, e.code))) hideCheatSheet()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", hideCheatSheet)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", hideCheatSheet)
    }
  }, [])
}
