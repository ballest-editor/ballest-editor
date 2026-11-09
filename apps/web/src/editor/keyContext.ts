/** The editor's state as the keybinds see it (domain/keyContext.ts), read off the store and the scene in one place. */
import type { Drag, KeyContext } from "../domain/keyContext"
import { sceneRegistry } from "./sceneRegistry"
import { type EditorState, useEditor } from "./store"

/**
 * What is being dragged: a look, orbit or pan; a gizmo handle's move, turn or scale, or the selection's body (a move);
 * a box or lasso; a paint stroke; a number field's scrub, which previews a transform with no pointer drag of its own.
 */
const dragOf = (s: EditorState): Drag => {
  if (sceneRegistry.lookDragActive()) return "camera"
  const gizmo = sceneRegistry.gizmoDragKind()
  if (gizmo !== null) return gizmo
  if (sceneRegistry.bodyDragActive()) return "move"
  if (sceneRegistry.areaDragActive()) return "area"
  if (sceneRegistry.paintStrokeActive()) return "stroke"
  return s.preview !== null ? "scrub" : "none"
}

export const keyContextOf = (s: EditorState = useEditor.getState()): KeyContext => ({
  drag: dragOf(s),
  tool: s.tool,
  platform: s.capabilities.play ? "desktop" : "browser"
})
