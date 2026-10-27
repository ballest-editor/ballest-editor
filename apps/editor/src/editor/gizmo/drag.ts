/**
 * Drag math: start state + current pointer -> new item transform in GAME space.
 * World-space quantities (rays, axis directions) are only used to measure the pointer; the
 * deltas are converted to game space through coords.ts before touching the transform.
 */
import type * as THREE from "three"
import type { UeTransform } from "../../domain/coords"
import { handleWorldDir, type HandleSpec } from "./handles"
import {
  axisParamFromRay,
  type Px,
  planeHit,
  quatMul,
  quatNormalize,
  screenAngle,
  worldAxisAngleToGameQuat,
  worldDirToGame
} from "./math"

export interface PointerSample {
  /** World-space pointer ray (unit direction). */
  readonly rayOrigin: THREE.Vector3
  readonly rayDir: THREE.Vector3
  /** Pointer position in viewport pixels (y down). */
  readonly px: Px
}

export interface DragStart {
  readonly spec: HandleSpec
  readonly transform: UeTransform
  /** Selection origin in world space, and on screen. */
  readonly originWorld: THREE.Vector3
  readonly originPx: Px
  /** Unit vector from the origin toward the camera at drag start. */
  readonly toCamera: THREE.Vector3
  readonly pointer: PointerSample
}

const MIN_SCALE = 1e-3

/** The world-space line/plane/rotation axis the drag acts on (for the guide line). */
export const dragAxisWorld = (start: DragStart): THREE.Vector3 | undefined =>
  start.spec.kind === "rotateView" ? start.toCamera.clone() : handleWorldDir(start.spec, start.transform.rotation)

export const dragTransform = (start: DragStart, now: PointerSample): UeTransform | undefined => {
  const { spec, transform: t, originWorld: o } = start
  if (spec.kind === "scaleUniform") {
    const r0 = Math.hypot(start.pointer.px.x - start.originPx.x, start.pointer.px.y - start.originPx.y)
    const r1 = Math.hypot(now.px.x - start.originPx.x, now.px.y - start.originPx.y)
    if (r0 < 1) return undefined
    const k = r1 / r0
    const s = t.scale3D
    return { ...t, scale3D: { x: clampScale(s.x * k), y: clampScale(s.y * k), z: clampScale(s.z * k) } }
  }
  const dir = dragAxisWorld(start)
  if (dir === undefined) return undefined
  switch (spec.kind) {
    case "translateAxis": {
      const t0 = axisParamFromRay(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const t1 = axisParamFromRay(o, dir, now.rayOrigin, now.rayDir)
      if (t0 === undefined || t1 === undefined) return undefined
      const d = worldDirToGame(dir.clone().multiplyScalar(t1 - t0))
      return { ...t, translation: { x: t.translation.x + d.x, y: t.translation.y + d.y, z: t.translation.z + d.z } }
    }
    case "translatePlane": {
      const p0 = planeHit(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const p1 = planeHit(o, dir, now.rayOrigin, now.rayDir)
      if (p0 === undefined || p1 === undefined) return undefined
      const d = worldDirToGame(p1.sub(p0))
      return { ...t, translation: { x: t.translation.x + d.x, y: t.translation.y + d.y, z: t.translation.z + d.z } }
    }
    case "rotateAxis":
    case "rotateView": {
      // Counter-clockwise on screen is a positive (right-handed) turn about an axis
      // pointing at the viewer; flip when the axis points away.
      const facing = dir.dot(start.toCamera)
      const sign = spec.kind === "rotateView" || facing >= 0 ? 1 : -1
      const angle = sign * screenAngle(start.originPx, start.pointer.px, now.px)
      const delta = worldAxisAngleToGameQuat(dir, angle)
      return { ...t, rotation: quatNormalize(quatMul(delta, t.rotation)) }
    }
    case "scaleAxis": {
      const axis = spec.axis
      const t0 = axisParamFromRay(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const t1 = axisParamFromRay(o, dir, now.rayOrigin, now.rayDir)
      if (axis === undefined || t0 === undefined || t1 === undefined || Math.abs(t0) < 1e-6) return undefined
      const next = { ...t.scale3D, [axis]: clampScale(t.scale3D[axis] * (t1 / t0)) }
      return { ...t, scale3D: next }
    }
  }
}

/** Keeps the sign (mirroring is allowed in-game) but never reaches zero. */
const clampScale = (v: number): number => (Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v)
