/**
 * Gizmo math. Directions handed to the renderer are three.js world vectors; every value
 * written back to the map is in game (UE) space. The two meet only through coords.ts.
 */
import * as THREE from "three"
import { type Quat4, threeToUeQuat, ueToThreeVector, type Vec3 } from "../../domain/coords"
import { rotateVec } from "../../domain/ueMath"

export type Axis = "x" | "y" | "z"

export const GAME_BASIS: Readonly<Record<Axis, Vec3>> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 }
}

const toThree = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z)

/** A game-space direction expressed in three.js world space (through the coords mapping). */
export const gameDirToWorld = (v: Vec3): THREE.Vector3 => toThree(ueToThreeVector(v))

/** World-space direction of a game axis, optionally in the item's local frame (game rotation). */
export const axisWorldDir = (axis: Axis, localRotation?: Quat4): THREE.Vector3 =>
  gameDirToWorld(localRotation === undefined ? GAME_BASIS[axis] : rotateVec(localRotation, GAME_BASIS[axis]))
    .normalize()

/** A rotation by `angle` (right-handed) about a world axis, expressed as a game quaternion. */
export const worldAxisAngleToGameQuat = (worldAxis: THREE.Vector3, angle: number): Quat4 => {
  const q = new THREE.Quaternion().setFromAxisAngle(worldAxis.clone().normalize(), angle)
  return threeToUeQuat({ x: q.x, y: q.y, z: q.z, w: q.w })
}

// --- projections ----------------------------------------------------------------------

/**
 * Parameter t of the point on the line `origin + t * dir` closest to the ray. Undefined when
 * the ray is (nearly) parallel to the line. `dir` and `rayDir` must be unit length.
 */
export const axisParamFromRay = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3
): number | undefined => {
  const w0 = origin.clone().sub(rayOrigin)
  const b = dir.dot(rayDir)
  const d = dir.dot(w0)
  const e = rayDir.dot(w0)
  const denom = 1 - b * b
  if (denom < 1e-6) return undefined
  return (b * e - d) / denom
}

/** Intersection of a ray with the plane through `origin` with `normal`; undefined if parallel or behind. */
export const planeHit = (
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3
): THREE.Vector3 | undefined => {
  const denom = normal.dot(rayDir)
  if (Math.abs(denom) < 1e-6) return undefined
  const t = origin.clone().sub(rayOrigin).dot(normal) / denom
  return t < 0 ? undefined : rayOrigin.clone().addScaledVector(rayDir, t)
}

export interface Px {
  readonly x: number
  readonly y: number
}

/** Signed angle from `start` to `current` around `center`, counter-clockwise as seen on screen (pixel y points down). */
export const screenAngle = (center: Px, start: Px, current: Px): number => {
  const a0 = Math.atan2(-(start.y - center.y), start.x - center.x)
  const a1 = Math.atan2(-(current.y - center.y), current.x - center.x)
  let d = a1 - a0
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** World units per screen pixel at `point` for a perspective camera, for constant screen-size gizmos. */
export const worldPerPixel = (
  camera: THREE.PerspectiveCamera,
  point: THREE.Vector3,
  viewportHeightPx: number
): number => {
  const forward = camera.getWorldDirection(new THREE.Vector3())
  const depth = Math.max(point.clone().sub(camera.position).dot(forward), camera.near)
  return (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(viewportHeightPx, 1)
}
