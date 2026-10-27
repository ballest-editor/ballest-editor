/**
 * Transforming several items together about a shared pivot, in game space (UE cm, Z up).
 * A gizmo drag measures one delta; every selected item gets it relative to the pivot, so
 * the selection moves, turns and scales as a rigid group.
 */
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { quatConjugate, quatMul, quatNormalize, quatToRotator, rotateVec, rotatorToQuat } from "./ueMath"

/** What a gizmo drag does, independent of how many items it applies to. */
export type GroupDelta =
  | { readonly kind: "translate"; readonly offset: Vec3 }
  /** A rotation about the pivot (game-space unit quaternion). */
  | { readonly kind: "rotate"; readonly rotation: Quat4 }
  /** Scale by `factor` about the pivot: along `axis` (game-space unit vector), or uniformly. */
  | { readonly kind: "scale"; readonly factor: number; readonly axis?: Vec3 }

const MIN_SCALE = 1e-3

/** Keeps the sign (mirroring is allowed in-game) but never reaches zero. */
export const clampScale = (v: number): number => (Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v)

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scaled = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

/**
 * The selection's pivot: the mean of the item origins. For one item that is its own
 * origin, so a single item turns and scales in place exactly as before.
 */
export const selectionPivot = (transforms: ReadonlyArray<UeTransform>): Vec3 | undefined => {
  if (transforms.length === 0) return undefined
  const sum = transforms.reduce((acc, t) => add(acc, t.translation), { x: 0, y: 0, z: 0 })
  return scaled(sum, 1 / transforms.length)
}

/**
 * Scale along a game-space axis. An item can only scale along its own axes, so the
 * stretch goes to the item's local axis closest to `axis` (exact when they line up, as
 * with rotations in 90-degree steps).
 */
const axisScale = (t: UeTransform, axis: Vec3, factor: number): Vec3 => {
  const local = rotateVec(quatConjugate(t.rotation), axis)
  const nearest = (["x", "y", "z"] as const).reduce((best, a) => Math.abs(local[a]) > Math.abs(local[best]) ? a : best)
  return { ...t.scale3D, [nearest]: clampScale(t.scale3D[nearest] * factor) }
}

/** One item's transform after `delta` about `pivot`. */
export const applyGroupDelta = (t: UeTransform, pivot: Vec3, delta: GroupDelta): UeTransform => {
  switch (delta.kind) {
    case "translate":
      return { ...t, translation: add(t.translation, delta.offset) }
    case "rotate":
      return {
        ...t,
        translation: add(pivot, rotateVec(delta.rotation, sub(t.translation, pivot))),
        rotation: quatNormalize(quatMul(delta.rotation, t.rotation))
      }
    case "scale": {
      const { factor, axis } = delta
      const offset = sub(t.translation, pivot)
      if (axis === undefined) {
        const s = t.scale3D
        return {
          ...t,
          translation: add(pivot, scaled(offset, factor)),
          scale3D: { x: clampScale(s.x * factor), y: clampScale(s.y * factor), z: clampScale(s.z * factor) }
        }
      }
      return {
        ...t,
        translation: add(t.translation, scaled(axis, (factor - 1) * dot(offset, axis))),
        scale3D: axisScale(t, axis, factor)
      }
    }
  }
}

/**
 * The transform fields the inspector edits one axis at a time. `rotation` is edited as a
 * rotator in degrees (X roll, Y pitch, Z yaw), the way the game's own editor shows it.
 */
export type TransformField = "translation" | "rotation" | "scale3D"
export type Axis = "x" | "y" | "z"

/** A field's three axis values in the units the inspector edits (cm, degrees, factor). */
export const readField = (t: UeTransform, field: TransformField): Vec3 => {
  if (field !== "rotation") return t[field]
  const r = quatToRotator(t.rotation)
  return { x: r.roll, y: r.pitch, z: r.yaw }
}

export const writeField = (t: UeTransform, field: TransformField, v: Vec3): UeTransform => {
  switch (field) {
    case "translation":
      return { ...t, translation: v }
    case "rotation":
      return { ...t, rotation: rotatorToQuat({ roll: v.x, pitch: v.y, yaw: v.z }) }
    case "scale3D":
      return { ...t, scale3D: { x: clampScale(v.x), y: clampScale(v.y), z: clampScale(v.z) } }
  }
}

/** Set an axis to a value (typed into a field), or offset it (a scrub across a mixed selection). */
export type AxisEdit = { readonly kind: "set"; readonly value: number } | {
  readonly kind: "offset"
  readonly by: number
}

export const editAxis = (t: UeTransform, field: TransformField, axis: Axis, edit: AxisEdit): UeTransform => {
  const current = readField(t, field)
  const value = edit.kind === "set" ? edit.value : current[axis] + edit.by
  return writeField(t, field, { ...current, [axis]: value })
}
