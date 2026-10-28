/** Unreal-frame math (no frame conversion here; see coords.ts for that). */
import type { Quat4, Vec3 } from "./coords"

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

// --- quaternions (Hamilton product on raw components) ---------------------------------

export const quatMul = (a: Quat4, b: Quat4): Quat4 => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
})

export const quatNormalize = (q: Quat4): Quat4 => {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n }
}

/** v' = q v q* (same formula as FQuat::RotateVector). */
export const rotateVec = (q: Quat4, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  }
}
/** FQuat::Rotator (unit quaternion -> degrees), same formula and gimbal-lock handling as the engine. */
export const quatToRotator = (q: Quat4): { readonly pitch: number; readonly yaw: number; readonly roll: number } => {
  const r2d = 180 / Math.PI
  const singularity = q.z * q.x - q.w * q.y
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * r2d
  const normalize = (a: number) => {
    const m = ((a % 360) + 360) % 360
    return m > 180 ? m - 360 : m
  }
  if (singularity < -0.4999995) return { pitch: -90, yaw, roll: normalize(-yaw - 2 * Math.atan2(q.x, q.w) * r2d) }
  if (singularity > 0.4999995) return { pitch: 90, yaw, roll: normalize(yaw - 2 * Math.atan2(q.x, q.w) * r2d) }
  return {
    pitch: Math.asin(2 * singularity) * r2d,
    yaw,
    roll: Math.atan2(-2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * r2d
  }
}
