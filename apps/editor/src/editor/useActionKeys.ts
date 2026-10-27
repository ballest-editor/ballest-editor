import { useEffect } from "react"
import { actionsFor, chordOf, type KeybindAction } from "../domain/Keybinds"
import { commands } from "./commands"
import { isEditorKeyEvent } from "./FlyCamera"
import { sceneRegistry } from "./sceneRegistry"
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
      return () => s.openDialog("new")
    case "importMap":
      return () => commands.openImport()
    case "exportMap":
      return () => s.openDialog("export")
    default:
      return undefined // held movement keys and mouse drags are handled by FlyCamera
  }
}

/**
 * One-shot actions, matched on the full chord. Ignored in text fields and dialogs, while a
 * look drag is active (the fly keys own the keyboard then), and while a gizmo drag is in
 * progress (undo mid-drag would be overwritten by the drag's commit on release).
 */
export function useActionKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isEditorKeyEvent(e) || e.repeat || sceneRegistry.lookDragActive() || sceneRegistry.gizmoDragActive()) return
      const chord = chordOf(e)
      const { keybinds } = useEditor.getState()
      for (const action of actionsFor(keybinds, chord)) {
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
