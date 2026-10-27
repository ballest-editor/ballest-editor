/**
 * Mutable handles shared between the R3F scene and the rest of the UI (not React state:
 * these change every frame or hold three.js objects).
 */
import type { Camera, Object3D } from "three"
import type { Vec3 } from "../domain/coords"

export const sceneRegistry = {
  /** item id -> its root Object3D */
  objects: new Map<string, Object3D>(),
  /** the viewport camera and the active gizmo (debugging / tests) */
  camera: null as Camera | null,
  gizmo: null as Object3D | null,
  /** parent of all item objects, for click raycasts */
  itemsRoot: null as Object3D | null,
  /** true while the pointer is over (or dragging) a gizmo handle */
  gizmoActive: () => false,
  /** true when a mouse chord ("Mouse2", "Alt+Mouse0") is bound to look/orbit/pan */
  isNavigationChord: (_chord: string) => false,
  /** true while a look/orbit/pan drag is in progress (fly keys then win over tool shortcuts) */
  lookDragActive: () => false,
  /** where a palette click should place a new piece, in UE cm */
  placementPoint: (): Vec3 => ({ x: 0, y: 0, z: 0 })
}
