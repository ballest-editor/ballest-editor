/**
 * Transforming several items together, in game space (UE cm, Z up), the way the game's
 * editor does it (docs/qa/gizmo-scale.md). A gizmo drag measures one delta, and every selected
 * item takes it about one pivot: the active item's pivot point (see pivot.ts), or a whole
 * group's frame. A move or turn is rigid. A scale is along each item's own axes, and so is the
 * item's offset from the pivot, so a selection spreads out but no item ever needs a shear,
 * which an item's rotation and `scale3D` couldn't hold.
 */
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { localToWorld } from "./pivot"
import {
  ORIGIN,
  quatConjugate,
  quatMul,
  quatNormalize,
  quatToRotator,
  rotateVec,
  rotatorToQuat,
  vecAdd,
  vecSub
} from "./ueMath"

/** What a gizmo drag does, independent of how many items it applies to. */
export type GroupDelta =
  | { readonly kind: "translate"; readonly offset: Vec3 }
  /** A rotation about the pivot (game-space unit quaternion). */
  | { readonly kind: "rotate"; readonly rotation: Quat4 }
  /** Scale each item by `factor` about the pivot: along its own `axis`, or uniformly. */
  | { readonly kind: "scale"; readonly factor: number; readonly axis?: Axis }

const MIN_SCALE = 1e-3

/** Keeps the sign (mirroring is allowed in-game) but never reaches zero. */
export const clampScale = (v: number): number => (Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v)

/**
 * `after`, moved so the item's local point `local` (unscaled cm) is where it was in `before`:
 * how a turn or scale about an item's own pivot comes out.
 */
export const keepPoint = <T extends UeTransform>(before: UeTransform, after: T, local: Vec3): T => ({
  ...after,
  translation: vecAdd(after.translation, vecSub(localToWorld(before, local), localToWorld(after, local)))
})

/**
 * `t` given `scale3D`, about `pivot` (world): its offset from the pivot changes along each of
 * its own axes by what that axis's scale did. An item on the pivot stays where it is.
 */
const scaleAbout = (t: UeTransform, scale3D: Vec3, pivot: Vec3): UeTransform => {
  const offset = rotateVec(quatConjugate(t.rotation), vecSub(t.translation, pivot))
  const along = (axis: Axis) => (t.scale3D[axis] === 0 ? offset[axis] : offset[axis] * scale3D[axis] / t.scale3D[axis])
  return {
    ...t,
    scale3D,
    translation: vecAdd(pivot, rotateVec(t.rotation, { x: along("x"), y: along("y"), z: along("z") }))
  }
}

/** One item's transform after `delta`, about `pivot` (world). */
export const applyGroupDelta = (t: UeTransform, pivot: Vec3, delta: GroupDelta): UeTransform => {
  switch (delta.kind) {
    case "translate":
      return { ...t, translation: vecAdd(t.translation, delta.offset) }
    case "rotate":
      return {
        ...t,
        translation: vecAdd(pivot, rotateVec(delta.rotation, vecSub(t.translation, pivot))),
        rotation: quatNormalize(quatMul(delta.rotation, t.rotation))
      }
    case "scale": {
      const { factor, axis } = delta
      const s = t.scale3D
      const scale3D = axis !== undefined
        ? { ...s, [axis]: clampScale(s[axis] * factor) }
        : { x: clampScale(s.x * factor), y: clampScale(s.y * factor), z: clampScale(s.z * factor) }
      return scaleAbout(t, scale3D, pivot)
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
 * transform (and its own pivot, local and unscaled) from before the edit. A scale, typed or
 * scrubbed, takes the active item's axis to the new value and every other item's by the same
 * ratio, about `pivot`, as a gizmo drag does: the game turns a panel of 1 made 2 into each item
 * doubling. A typed location or rotation sets that axis on every item, turning each about its
 * own pivot. An offset (a scrub) acts like a gizmo drag on the same selection: a location moves
 * every item by the same amount; a rotation turns the active item about the edited rotator
 * axis and the rest rigidly with it, about `pivot` (by default the active item's origin).
 * Always applied to the transforms from before the scrub, never to a live preview, so a
 * scrub's steps don't compound.
 */
export const selectionAxisEdit = (
  active: UeTransform,
  field: TransformField,
  axis: Axis,
  edit: AxisEdit,
  pivot: Vec3 = active.translation
): (t: UeTransform, localPivot?: Vec3) => UeTransform => {
  if (field === "scale3D") {
    const from = active.scale3D[axis]
    const to = edit.kind === "set" ? edit.value : from + edit.by
    // an item level with the active one takes the value itself, not that value through a ratio's rounding
    const scaled = (v: number) => (v === from || from === 0 ? to : v * to / from)
    return (t) => scaleAbout(t, { ...t.scale3D, [axis]: clampScale(scaled(t.scale3D[axis])) }, pivot)
  }
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
  }
}
