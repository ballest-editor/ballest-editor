/**
 * Mutable handles shared between the R3F scene and the rest of the UI (not React state:
 * these change every frame or hold three.js objects).
 */
import type { Camera, Object3D } from "three"
import type { Vec3 } from "../domain/coords"
import type { Drag } from "../domain/keyContext"
import type { ViewProjection } from "../domain/viewLayout"

export const sceneRegistry = {
  /** item id -> its root Object3D */
  objects: new Map<string, Object3D>(),
  /** the active pane's camera and the active gizmo (debugging / tests) */
  camera: null as Camera | null,
  gizmo: null as Object3D | null,
  /** parent of all item objects, for click raycasts */
  itemsRoot: null as Object3D | null,
  /** true while the pointer is over (or dragging) a gizmo handle */
  gizmoActive: () => false,
  /** true only while a gizmo handle or an item's body is being dragged (one-shot keybinds such as undo wait) */
  gizmoDragActive: () => false,
  /** true while the selection is being dragged by an item's body */
  bodyDragActive: () => false,
  /** what a gizmo handle's drag does, while one is under way */
  gizmoDragKind: (): Exclude<Drag, "none"> | null => null,
  /** true while the paint tool is in a stroke */
  paintStrokeActive: () => false,
  /** true when a mouse chord ("Mouse2", "Alt+Mouse0") is bound to look/orbit/pan */
  isNavigationChord: (_chord: string) => false,
  /** true while a look/orbit/pan drag is in progress (fly keys then win over tool shortcuts) */
  lookDragActive: () => false,
  /** true while a movement key is flying the camera (a movement key's shortcut then waits) */
  flyKeysActive: () => false,
  /** where a new piece or prefab with this footprint and height (cm) should go, in UE cm */
  placementPoint: (_footprint: number, _height?: number): Vec3 => ({ x: 0, y: 0, z: 0 }),
  /** what the orthographic / perspective toggle turns the active pane to (the menu's chunk can't reach the cameras) */
  toggledProjection: (): ViewProjection => "perspective"
}
