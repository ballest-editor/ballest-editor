import { useEffect } from "react"
import { chordOf, type KeybindAction } from "../domain/Keybinds"
import { exportMap } from "./actions"
import { commands } from "./commands"
import { isEditorKeyEvent } from "./FlyCamera"
import { useEditor } from "./store"

const oneShot = (action: KeybindAction): (() => void) | undefined => {
  const s = useEditor.getState()
  switch (action) {
    case "undo":
      return s.undo
    case "redo":
      return s.redo
    case "deleteSelection":
      return s.deleteSelection
    case "focusSelection":
      return s.requestFocus
    case "deselect":
      return () => s.select(null)
    case "selectMode":
      return () => s.setTool("select")
    case "translateMode":
      return () => s.setTool("translate")
    case "rotateMode":
      return () => s.setTool("rotate")
    case "scaleMode":
      return () => s.setTool("scale")
    case "speedFaster":
      return () => s.changeSpeed(1)
    case "speedSlower":
      return () => s.changeSpeed(-1)
    case "newMap":
      return () => commands.openDialog("new")
    case "importMap":
      return () => commands.openImport()
    case "exportMap":
      return () => void exportMap()
    default:
      return undefined // held movement keys and mouse drags are handled by FlyCamera
  }
}

/** One-shot actions, matched on the full chord. Ignored in text fields and dialogs. */
export function useActionKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isEditorKeyEvent(e) || e.repeat) return
      const chord = chordOf(e)
      const { keybinds } = useEditor.getState()
      for (const [action, binding] of Object.entries(keybinds) as Array<[KeybindAction, string]>) {
        if (binding !== chord) continue
        const run = oneShot(action)
        if (run === undefined) continue
        e.preventDefault()
        run()
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
