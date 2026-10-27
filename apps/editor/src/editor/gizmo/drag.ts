/**
 * Drag math: start state + current pointer -> the GAME-space delta the drag applies to the
 * selection (domain/groupTransform applies it to each item about the pivot). World-space
 * quantities (rays, axis directions) are only used to measure the pointer; the deltas are
 * converted to game space through coords.ts.
 */
import type * as THREE from "three"
import type { Quat4 } from "../../domain/coords"
import type { GroupDelta } from "../../domain/groupTransform"
import { type GizmoSpace, type HandleSpec, handleWorldDir } from "./handles"
import { axisParamFromRay, planeHit, type Px, screenAngle, worldAxisAngleToGameQuat, worldDirToGame } from "./math"

export interface PointerSample {
  /** World-space pointer ray (unit direction). */
  readonly rayOrigin: THREE.Vector3
  readonly rayDir: THREE.Vector3
  /** Pointer position in viewport pixels (y down). */
  readonly px: Px
}

export interface DragStart {
  readonly spec: HandleSpec
  readonly space: GizmoSpace
  /** The active item's rotation at drag start: the frame of the local axes. */
  readonly frameRotation: Quat4
  /** Selection pivot in world space, and on screen. */
  readonly originWorld: THREE.Vector3
  readonly originPx: Px
  /** Unit vector from the origin toward the camera at drag start. */
  readonly toCamera: THREE.Vector3
  readonly pointer: PointerSample
}

/** The world-space line/plane/rotation axis the drag acts on (for the guide line). */
export const dragAxisWorld = (start: DragStart): THREE.Vector3 | undefined =>
  start.spec.kind === "rotateView"
    ? start.toCamera.clone()
    : handleWorldDir(start.spec, start.frameRotation, start.space)

export const dragDelta = (start: DragStart, now: PointerSample): GroupDelta | undefined => {
  const { spec, originWorld: o } = start
  if (spec.kind === "scaleUniform") {
    const r0 = Math.hypot(start.pointer.px.x - start.originPx.x, start.pointer.px.y - start.originPx.y)
    const r1 = Math.hypot(now.px.x - start.originPx.x, now.px.y - start.originPx.y)
    if (r0 < 1) return undefined
    return { kind: "scale", factor: r1 / r0 }
  }
  const dir = dragAxisWorld(start)
  if (dir === undefined) return undefined
  switch (spec.kind) {
    case "translateAxis": {
      const t0 = axisParamFromRay(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const t1 = axisParamFromRay(o, dir, now.rayOrigin, now.rayDir)
      if (t0 === undefined || t1 === undefined) return undefined
      return { kind: "translate", offset: worldDirToGame(dir.clone().multiplyScalar(t1 - t0)) }
    }
    case "translatePlane": {
      const p0 = planeHit(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const p1 = planeHit(o, dir, now.rayOrigin, now.rayDir)
      if (p0 === undefined || p1 === undefined) return undefined
      return { kind: "translate", offset: worldDirToGame(p1.sub(p0)) }
    }
    case "rotateAxis":
    case "rotateView": {
      // Counter-clockwise on screen is a positive (right-handed) turn about an axis
      // pointing at the viewer; flip when the axis points away.
      const facing = dir.dot(start.toCamera)
      const sign = spec.kind === "rotateView" || facing >= 0 ? 1 : -1
      const angle = sign * screenAngle(start.originPx, start.pointer.px, now.px)
      return { kind: "rotate", rotation: worldAxisAngleToGameQuat(dir, angle) }
    }
    case "scaleAxis": {
      const t0 = axisParamFromRay(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const t1 = axisParamFromRay(o, dir, now.rayOrigin, now.rayDir)
      if (t0 === undefined || t1 === undefined || Math.abs(t0) < 1e-6) return undefined
      return { kind: "scale", factor: t1 / t0, axis: worldDirToGame(dir) }
    }
  }
}
