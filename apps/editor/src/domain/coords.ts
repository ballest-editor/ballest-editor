/**
 * The one place where the game's frame and the renderer's frame meet.
 *
 * Game (Unreal): left-handed, Z up, X forward, Y right, centimetres.
 * Renderer (three.js): right-handed, Y up. We keep 1 scene unit = 1 cm so positions
 * never get rescaled.
 *
 * Mapping M:  three(x, y, z) = UE(x, z, y)
 *
 * M has determinant -1. That's required: the two frames have opposite handedness, so any
 * mapping that keeps the world looking the way it does in-game (forward, right and up
 * staying forward, right and up) must be a reflection. A proper rotation such as
 * (x, z, -y) would mirror every map left/right. coords.test.ts checks this against UE's
 * axis semantics and sample rotations.
 *
 * Rotations are conjugated by M: R' = M R M^-1. For a quaternion (v, w) the axis is a
 * pseudovector, so v' = det(M) * M v = -M v and w' = w. M is an involution, so both
 * directions use the same formulas.
 */

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface Quat4 {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

export type Tuple3 = readonly [number, number, number]
export type Tuple4 = readonly [number, number, number, number]

/** M applied to a position or direction. */
export const ueToThreeVector = (v: Vec3): Vec3 => ({ x: v.x, y: v.z, z: v.y })
export const threeToUeVector = (v: Vec3): Vec3 => ({ x: v.x, y: v.z, z: v.y })

/** Axis-aligned scale: diag(s) conjugated by a permutation is the permuted diagonal. */
const ueToThreeScale = ueToThreeVector
const threeToUeScale = threeToUeVector

export const ueToThreeQuat = (q: Quat4): Quat4 => ({ x: -q.x, y: -q.z, z: -q.y, w: q.w })
export const threeToUeQuat = (q: Quat4): Quat4 => ({ x: -q.x, y: -q.z, z: -q.y, w: q.w })

export const toTuple3 = (v: Vec3): Tuple3 => [v.x, v.y, v.z]
export const toTuple4 = (q: Quat4): Tuple4 => [q.x, q.y, q.z, q.w]
export const fromTuple3 = (t: Tuple3): Vec3 => ({ x: t[0], y: t[1], z: t[2] })

export interface SceneTransform {
  readonly position: Tuple3
  readonly quaternion: Tuple4
  readonly scale: Tuple3
}

export interface UeTransform {
  readonly rotation: Quat4
  readonly translation: Vec3
  readonly scale3D: Vec3
}

export const ueToScene = (t: UeTransform): SceneTransform => ({
  position: toTuple3(ueToThreeVector(t.translation)),
  quaternion: toTuple4(ueToThreeQuat(t.rotation)),
  scale: toTuple3(ueToThreeScale(t.scale3D))
})

export const sceneToUe = (t: SceneTransform): UeTransform => ({
  translation: threeToUeVector(fromTuple3(t.position)),
  rotation: threeToUeQuat({ x: t.quaternion[0], y: t.quaternion[1], z: t.quaternion[2], w: t.quaternion[3] }),
  scale3D: threeToUeScale(fromTuple3(t.scale))
})

/** UE local-space AABB (cm) -> scene-space box size and centre. */
export const ueBoundsToScene = (min: Tuple3, max: Tuple3): { readonly size: Tuple3; readonly center: Tuple3 } => {
  const size = ueToThreeVector({ x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] })
  const center = ueToThreeVector({ x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 })
  return { size: toTuple3(size), center: toTuple3(center) }
}

/**
 * Piece meshes (`assets/pieces/*.glb`) are exported in Unreal local space (cm, Z up,
 * not converted to glTF's Y-up; see catalog.json `coordinateSystem`). Rendering one means
 * applying M to its vertices: this is M as a row-major 4x4 matrix, for `Matrix4.set(...)`.
 * Its negative determinant makes three.js flip the triangle winding for us.
 */
export const UE_TO_THREE_MATRIX: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
] = [
  1,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1
]
