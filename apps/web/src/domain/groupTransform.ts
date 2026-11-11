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
  quatConjugate,
  quatMul,
  quatNormalize,
  quatToRotator,
  rotateVec,
  rotatorToQuat,
  vecAdd,
  vecSub
} from "./ueMath"

/**
 * What a gizmo drag does, independent of how many items it applies to. A move or turn measured along the gizmo's local
 * axes carries `frame`, the rotation those axes were: `forUnit` turns it into the same move or turn along another
 * unit's own axes, which is what Each does (units.ts).
 */
export type GroupDelta =
  | { readonly kind: "translate"; readonly offset: Vec3; readonly frame?: Quat4 }
  /** A rotation about the pivot (game-space unit quaternion). */
  | { readonly kind: "rotate"; readonly rotation: Quat4; readonly frame?: Quat4 }
  /** Scale each item by `factor` about the pivot: along its own `axis`, in the plane normal to `excludeAxis`, or uniformly. */
  | { readonly kind: "scale"; readonly factor: number; readonly axis?: Axis; readonly excludeAxis?: Axis }
  | RigidDelta

/** A turn about `about`, then `offset`: a move that lands on a target and takes its rotation too. */
export interface RigidDelta {
  readonly kind: "rigid"
  readonly rotation: Quat4
  readonly about: Vec3
  readonly offset: Vec3
}

/**
 * `delta` as a unit with axes `rotation` takes it: a move or turn given along the frame's axes becomes the same move or
 * turn along the unit's own. A world-axes delta, a scale or a rigid landing is the same for every unit.
 */
export const forUnit = (delta: GroupDelta, rotation: Quat4): GroupDelta => {
  if (delta.kind === "scale" || delta.kind === "rigid" || delta.frame === undefined) return delta
  const toLocal = quatConjugate(delta.frame)
  if (delta.kind === "translate") {
    return { kind: "translate", offset: rotateVec(rotation, rotateVec(toLocal, delta.offset)) }
  }
  const local = quatMul(quatMul(toLocal, delta.rotation), delta.frame)
  return { kind: "rotate", rotation: quatNormalize(quatMul(quatMul(rotation, local), quatConjugate(rotation))) }
}

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
export const scaleAbout = (t: UeTransform, scale3D: Vec3, pivot: Vec3): UeTransform => {
  const offset = rotateVec(quatConjugate(t.rotation), vecSub(t.translation, pivot))
  const along = (axis: Axis) => (t.scale3D[axis] === 0 ? offset[axis] : offset[axis] * scale3D[axis] / t.scale3D[axis])
  return {
    ...t,
    scale3D,
    translation: vecAdd(pivot, rotateVec(t.rotation, { x: along("x"), y: along("y"), z: along("z") }))
  }
}

/** Where a landing takes a point of the world. */
export const landedPoint = (point: Vec3, { about, offset, rotation }: RigidDelta): Vec3 =>
  vecAdd(vecAdd(about, rotateVec(rotation, vecSub(point, about))), offset)

/** One item's transform after `delta`, about `pivot` (world). */
export const applyGroupDelta = (t: UeTransform, pivot: Vec3, delta: GroupDelta): UeTransform => {
  switch (delta.kind) {
    case "translate":
      return { ...t, translation: vecAdd(t.translation, delta.offset) }
    case "rigid":
      return {
        ...t,
        translation: landedPoint(t.translation, delta),
        rotation: quatNormalize(quatMul(delta.rotation, t.rotation))
      }
    case "rotate":
      return {
        ...t,
        translation: vecAdd(pivot, rotateVec(delta.rotation, vecSub(t.translation, pivot))),
        rotation: quatNormalize(quatMul(delta.rotation, t.rotation))
      }
    case "scale": {
      const { factor, axis, excludeAxis } = delta
      const s = t.scale3D
      const along = (one: Axis) =>
        one === excludeAxis || (axis !== undefined && one !== axis) ? s[one] : clampScale(s[one] * factor)
      const scale3D = { x: along("x"), y: along("y"), z: along("z") }
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
 * than its origin; a location is set as is. How a pasted row lands on each item.
 */
export const writeFieldAbout = (t: UeTransform, field: TransformField, v: Vec3, localPivot: Vec3): UeTransform =>
  field === "translation" ? writeField(t, field, v) : keepPoint(t, writeField(t, field, v), localPivot)

/** Take an axis to a value (typed into a field), or change it by an amount (a scrub, or a `+5` typed). */
export type AxisEdit = { readonly kind: "set"; readonly value: number } | {
  readonly kind: "offset"
  readonly by: number
}

/**
 * What takes a unit whose transform is `unit` from the values it reads in `field` to `to`, every item of it along,
 * about `pivot` (world): a location moves them all by the difference; a rotation turns them by the turn from the unit's
 * rotator to `to`, both round-tripped through the quaternion, so only the angles changed turn, even near gimbal lock,
 * where the other angles are ambiguous; a scale takes each item's axis by the unit's ratio along its own axes, and an
 * item level with the unit there takes the value itself, not that value through a ratio's rounding. An axis `to` leaves
 * as it reads is left alone.
 */
export const fieldTo = (
  unit: UeTransform,
  field: TransformField,
  to: Vec3,
  pivot: Vec3 = unit.translation
): (t: UeTransform) => UeTransform => {
  const from = readField(unit, field)
  switch (field) {
    case "translation": {
      const delta: GroupDelta = { kind: "translate", offset: vecSub(to, from) }
      return (t) => applyGroupDelta(t, pivot, delta)
    }
    case "rotation": {
      const before = writeField(unit, "rotation", from).rotation
      const after = writeField(unit, "rotation", to).rotation
      const delta: GroupDelta = { kind: "rotate", rotation: quatNormalize(quatMul(after, quatConjugate(before))) }
      return (t) => applyGroupDelta(t, pivot, delta)
    }
    case "scale3D": {
      const along = (t: UeTransform, axis: Axis) => {
        const own = t.scale3D[axis]
        if (to[axis] === from[axis]) return own
        return own === from[axis] || from[axis] === 0 ? clampScale(to[axis]) : clampScale(own * to[axis] / from[axis])
      }
      return (t) => scaleAbout(t, { x: along(t, "x"), y: along(t, "y"), z: along(t, "z") }, pivot)
    }
  }
}

/**
 * One axis of a unit's field taken to a value or changed by an amount, every item of the unit along about `pivot` (by
 * default the unit's origin): `fieldTo` with the other two axes as they read.
 */
export const selectionAxisEdit = (
  active: UeTransform,
  field: TransformField,
  axis: Axis,
  edit: AxisEdit,
  pivot: Vec3 = active.translation
): (t: UeTransform) => UeTransform => {
  const from = readField(active, field)
  return fieldTo(active, field, { ...from, [axis]: edit.kind === "set" ? edit.value : from[axis] + edit.by }, pivot)
}
