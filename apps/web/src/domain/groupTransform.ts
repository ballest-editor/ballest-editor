/**
 * Transforming several items together, in game space (UE cm, Z up), the way the game's
 * editor does it. A gizmo drag measures one delta; a move or turn applies to every selected
 * item about the pivot (the active item's pivot point, see pivot.ts), so the selection moves
 * and turns as a rigid group. A scale is per item: each one scales along its own axes about
 * its own pivot point, which stays put (with a Default pivot, the item doesn't move).
 */
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { localToWorld } from "./pivot"
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

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * `after`, moved so the item's local point `local` (unscaled cm) is where it was in `before`:
 * how a turn or scale about an item's own pivot comes out.
 */
const keepPoint = (before: UeTransform, after: UeTransform, local: Vec3): UeTransform => ({
  ...after,
  translation: add(after.translation, sub(localToWorld(before, local), localToWorld(after, local)))
})

/**
 * One item's transform after `delta`: a turn about `pivot` (world), a scale about the item's
 * own `localPivot` (its local frame, unscaled cm).
 */
export const applyGroupDelta = (
  t: UeTransform,
  pivot: Vec3,
  delta: GroupDelta,
  localPivot: Vec3 = ORIGIN
): UeTransform => {
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
      const scale3D = axis !== undefined
        ? { ...s, [axis]: clampScale(s[axis] * factor) }
        : { x: clampScale(s.x * factor), y: clampScale(s.y * factor), z: clampScale(s.z * factor) }
      return keepPoint(t, { ...t, scale3D }, localPivot)
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

/**
 * `writeField`, turning or scaling the item about its own `localPivot` (unscaled cm) rather
 * than its origin; a location is set as is.
 */
export const writeFieldAbout = (t: UeTransform, field: TransformField, v: Vec3, localPivot: Vec3): UeTransform =>
  field === "translation" ? writeField(t, field, v) : keepPoint(t, writeField(t, field, v), localPivot)

/** Set an axis to a value (typed into a field), or offset it (a scrub). */
export type AxisEdit = { readonly kind: "set"; readonly value: number } | {
  readonly kind: "offset"
  readonly by: number
}

const setAxis = (t: UeTransform, field: TransformField, axis: Axis, value: number, localPivot: Vec3): UeTransform =>
  writeFieldAbout(t, field, { ...readField(t, field), [axis]: value }, localPivot)

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
 * transform (and its own pivot, local and unscaled) from before the edit. A typed value sets
 * that axis on every item, turning or scaling each about its own pivot. An offset (a scrub)
 * acts like a gizmo drag on the same selection: a location moves every item by the same
 * amount; a rotation turns the active item about the edited rotator axis and the rest rigidly
 * with it, about `pivot` (the active item's pivot point in the world, by default its origin);
 * a scale changes each item's own axis about its own pivot. Always applied to the transforms
 * from before the scrub, never to a live preview, so a scrub's steps don't compound.
 */
export const selectionAxisEdit = (
  active: UeTransform,
  field: TransformField,
  axis: Axis,
  edit: AxisEdit,
  pivot: Vec3 = active.translation
): (t: UeTransform, localPivot?: Vec3) => UeTransform => {
  if (edit.kind === "set") return (t, localPivot = ORIGIN) => setAxis(t, field, axis, edit.value, localPivot)
  const { by } = edit
  switch (field) {
    case "translation": {
      const delta: GroupDelta = { kind: "translate", offset: { x: 0, y: 0, z: 0, [axis]: by } }
      return (t) => applyGroupDelta(t, pivot, delta)
    }
    case "rotation": {
      const delta = rotatorOffset(active, axis, by)
      return (t) => applyGroupDelta(t, pivot, delta)
    }
    case "scale3D":
      return (t, localPivot = ORIGIN) => setAxis(t, field, axis, t.scale3D[axis] + by, localPivot)
  }
}
