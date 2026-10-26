/** Unreal-frame math (no frame conversion here; see coords.ts for that). */
import type { Quat4 } from "./coords"

/** FRotator::Quaternion (degrees -> unit quaternion), same formula as the engine. */
export const rotatorToQuat = (r: { readonly pitch: number; readonly yaw: number; readonly roll: number }): Quat4 => {
  const half = Math.PI / 360
  const sp = Math.sin(r.pitch * half), cp = Math.cos(r.pitch * half)
  const sy = Math.sin(r.yaw * half), cy = Math.cos(r.yaw * half)
  const sr = Math.sin(r.roll * half), cr = Math.cos(r.roll * half)
  return {
    x: cr * sp * sy - sr * cp * cy,
    y: -cr * sp * cy - sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy
  }
}
