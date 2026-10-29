/**
 * Transforming several items together, in game space (UE cm, Z up), the way the game's
 * editor does it. A gizmo drag measures one delta; a move or turn applies to every selected
 * item about the pivot (the active item's origin), so the selection moves and turns as a
 * rigid group. A scale is per item: each one scales about its own origin along its own axes,
 * and nothing changes position.
 */
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { quatConjugate, quatMul, quatNormalize, quatToRotator, rotateVec, rotatorToQuat } from "./ueMath"

/** What a gizmo drag does, independent of how many items it applies to. */
export type GroupDelta =
  | { readonly kind: "translate"; readonly offset: Vec3 }
  /** A rotation about the pivot (game-space unit quaternion). */
  | { readonly kind: "rotate"; readonly rotation: Quat4 }
  /** Scale each item in place by `factor`: along its own `axis`, or uniformly. */
  | { readonly kind: "scale"; readonly factor: number; readonly axis?: Axis }

const MIN_SCALE = 1e-3

/** Keeps the sign (mirroring is allowed in-game) but never reaches zero. */
export const clampScale = (v: number): number => (Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v)

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

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
      const s = t.scale3D
      if (axis !== undefined) return { ...t, scale3D: { ...s, [axis]: clampScale(s[axis] * factor) } }
      return {
        ...t,
        scale3D: { x: clampScale(s.x * factor), y: clampScale(s.y * factor), z: clampScale(s.z * factor) }
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

/** Set an axis to a value (typed into a field), or offset it (a scrub). */
export type AxisEdit = { readonly kind: "set"; readonly value: number } | {
  readonly kind: "offset"
  readonly by: number
}

const setAxis = (t: UeTransform, field: TransformField, axis: Axis, value: number): UeTransform =>
  writeField(t, field, { ...readField(t, field), [axis]: value })

/**
 * The gizmo delta that turns `active` by `by` degrees about one rotator axis. Measured on
 * the active item's rotator round-tripped through the quaternion, so only the edited angle
 * changes even near gimbal lock, where the item's other rotator angles are ambiguous.
 */
const rotatorOffset = (active: UeTransform, axis: Axis, by: number): GroupDelta => {
  const rotator = readField(active, "rotation")
  const from = writeField(active, "rotation", rotator).rotation
  const to = writeField(active, "rotation", { ...rotator, [axis]: rotator[axis] + by }).rotation
  return { kind: "rotate", rotation: quatNormalize(quatMul(to, quatConjugate(from))) }
}

/**
 * An inspector axis edit over a whole selection, as the change to make to each item's
 * transform from before the edit. A typed value sets that axis on every item. An offset (a
 * scrub) acts like a gizmo drag on the same selection: a location moves every item by the
 * same amount; a rotation turns the active item about the edited rotator axis and the rest
 * rigidly with it, about the active item's origin; a scale changes each item's own axis in
 * place. Always applied to the transforms from before the scrub, never to a live preview, so
 * a scrub's steps don't compound.
 */
export const selectionAxisEdit = (
  active: UeTransform,
  field: TransformField,
  axis: Axis,
  edit: AxisEdit
): (t: UeTransform) => UeTransform => {
  if (edit.kind === "set") return (t) => setAxis(t, field, axis, edit.value)
  const { by } = edit
  switch (field) {
    case "translation": {
      const delta: GroupDelta = { kind: "translate", offset: { x: 0, y: 0, z: 0, [axis]: by } }
      return (t) => applyGroupDelta(t, active.translation, delta)
    }
    case "rotation": {
      const delta = rotatorOffset(active, axis, by)
      return (t) => applyGroupDelta(t, active.translation, delta)
    }
    case "scale3D":
      return (t) => setAxis(t, field, axis, t.scale3D[axis] + by)
  }
}
