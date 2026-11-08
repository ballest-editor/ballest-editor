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

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

export const vecAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })

export const vecSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

export const sameVec = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z

export const vecScale = (v: Vec3, by: number): Vec3 => ({ x: v.x * by, y: v.y * by, z: v.z * by })

export const vecDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const vecCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})

export const vecLength = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)

export const vecDistance = (a: Vec3, b: Vec3): number => vecLength(vecSub(a, b))

/** `v` at unit length; a zero vector stays one. */
export const vecNormalize = (v: Vec3): Vec3 => {
  const length = vecLength(v)
  return length === 0 ? v : vecScale(v, 1 / length)
}

/** The point `by` of the way from `a` to `b`. */
export const vecLerp = (a: Vec3, b: Vec3, by: number): Vec3 => vecAdd(a, vecScale(vecSub(b, a), by))

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

/** How alike two unit quaternions are: ±1 when they are the same rotation. */
export const quatDot = (a: Quat4, b: Quat4): number => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w

/** The same turn `k` times as far, about the same axis: a turn of 270° stays one, not -90°. */
export const quatPow = (q: Quat4, k: number): Quat4 => {
  const half = Math.acos(Math.max(-1, Math.min(1, q.w)))
  const sin = Math.sin(half)
  if (Math.abs(sin) < 1e-12) return { x: 0, y: 0, z: 0, w: 1 }
  const s = Math.sin(half * k) / sin
  return { x: q.x * s, y: q.y * s, z: q.z * s, w: Math.cos(half * k) }
}

/** The inverse rotation of a unit quaternion. */
export const quatConjugate = (q: Quat4): Quat4 => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })

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
/** A turn of `angle` radians about the unit vector `axis`, in the sense `rotateVec` turns. */
export const quatFromAxisAngle = (axis: Vec3, angle: number): Quat4 => {
  const half = angle / 2
  const s = Math.sin(half)
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) }
}

export const IDENTITY_QUAT: Quat4 = { x: 0, y: 0, z: 0, w: 1 }

/** Any unit vector square to the unit vector `v`. */
export const squareTo = (v: Vec3): Vec3 =>
  vecNormalize(vecCross(v, Math.abs(v.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }))

/** The shortest turn taking the unit vector `from` onto the unit vector `to`. */
export const quatBetween = (from: Vec3, to: Vec3): Quat4 => {
  const d = vecDot(from, to)
  if (d > 1 - 1e-12) return IDENTITY_QUAT
  if (d < -1 + 1e-12) return quatFromAxisAngle(squareTo(from), Math.PI)
  const { x, y, z } = vecCross(from, to)
  return quatNormalize({ x, y, z, w: 1 + d })
}

/**
 * The rotation taking local +X onto `forward` and local +Z onto `up`, as nearly as they allow: `up` is made square to
 * `forward`. Both unit length.
 */
export const quatFromFrame = (forward: Vec3, up: Vec3): Quat4 => {
  const f = vecNormalize(forward)
  const u = vecNormalize(vecSub(up, vecScale(f, vecDot(up, f))))
  const r = vecCross(u, f)
  const [m00, m10, m20] = [f.x, f.y, f.z]
  const [m01, m11, m21] = [r.x, r.y, r.z]
  const [m02, m12, m22] = [u.x, u.y, u.z]
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return quatNormalize({ x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s, w: s / 4 })
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    return quatNormalize({ x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s })
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    return quatNormalize({ x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s, w: (m02 - m20) / s })
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2
  return quatNormalize({ x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4, w: (m10 - m01) / s })
}

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
