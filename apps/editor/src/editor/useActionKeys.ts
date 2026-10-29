import { useEffect } from "react"
import { isMovementChord, sharedKeysFlyFreely } from "../domain/flyKeys"
import { actionsFor, chordOf, releasesBinding } from "../domain/Keybinds"
import { commandFor } from "./commands"
import { isEditorKeyEvent } from "./FlyCamera"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

const interactionActive = () => sceneRegistry.gizmoDragActive() || useEditor.getState().preview !== null

/**
 * One-shot actions, matched on the full chord. Ignored in text fields, dialogs and menus,
 * while a look drag is active (the fly keys own the keyboard then), and while a gizmo drag
 * or number-field scrub is in progress (it commits as one undo step on release; undo or
 * delete mid-interaction would be overwritten or orphan it). The cheat sheet is the one
 * held action here: it hides when a key of its binding is released or the window blurs.
 */
export function useActionKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isEditorKeyEvent(e) || e.repeat || sceneRegistry.lookDragActive() || interactionActive()) return
      const chord = chordOf(e)
      const { keybinds, settings } = useEditor.getState()
      // A movement key that is also a tool shortcut (W: forward + translate) joins an ongoing
      // flight instead of switching tool, unless no movement key needs look: then it does both.
      if (
        isMovementChord(keybinds, chord)
        && sceneRegistry.flyKeysActive()
        && !sharedKeysFlyFreely(settings.camera.movementNeedsLook)
      ) return
      for (const action of actionsFor(keybinds, chord)) {
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
