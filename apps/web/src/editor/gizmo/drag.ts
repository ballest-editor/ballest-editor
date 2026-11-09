/**
 * Drag math: start state + current pointer -> the GAME-space turn or scale a handle asks for,
 * before snapping (domain/snapRotate). A move goes through the snapping session instead
 * (editor/snap/moveSession), from the constraint here. World-space
 * quantities (rays, axis directions) are only used to measure the pointer; the deltas are
 * converted to game space through coords.ts.
 */
import type * as THREE from "three"
import { type Quat4, threeToUeVector, type Vec3 } from "../../domain/coords"
import type { Constraint } from "../../domain/snapFrame"
import { rotateVec } from "../../domain/ueMath"
import { type GizmoSpace, type HandleSpec, handleWorldDir, pairOf } from "./handles"
import { type Axis, axisParamFromRay, GAME_BASIS, type Px, screenAngle } from "./math"

export interface PointerSample {
  /** World-space pointer ray (unit direction). */
  readonly rayOrigin: THREE.Vector3
  readonly rayDir: THREE.Vector3
  /** Pointer position in viewport pixels (y down). */
  readonly px: Px
}

export interface DragStart {
  readonly spec: HandleSpec
  readonly space: GizmoSpace
  /** The active unit's axes at drag start: the frame of the local axes. */
  readonly frameRotation: Quat4
  /** The pivot (the active unit's) in world space, and on screen. */
  readonly originWorld: THREE.Vector3
  readonly originPx: Px
  /** Unit vector from the origin toward the camera at drag start. */
  readonly toCamera: THREE.Vector3
  readonly pointer: PointerSample
}

/** The world-space line/plane/rotation axis the drag acts on (for the guide line). */
export const dragAxisWorld = (start: DragStart): THREE.Vector3 | undefined =>
  start.spec.kind === "rotateView"
    ? start.toCamera.clone()
    : handleWorldDir(start.spec, start.frameRotation, start.space)

/** Where a translate handle lets a move go, in game space; undefined for any other handle. */
export const constraintOf = (start: Pick<DragStart, "spec" | "space" | "frameRotation">): Constraint | undefined => {
  const { axis, kind } = start.spec
  if (axis === undefined || (kind !== "translateAxis" && kind !== "translatePlane")) return undefined
  const direction = axisDirection(start, axis)
  return kind === "translateAxis" ? { kind: "line", direction } : { kind: "plane", normal: direction }
}

/** A gizmo axis in game space: the game's, or the active item's own in local space. */
const axisDirection = ({ frameRotation, space }: Pick<DragStart, "space" | "frameRotation">, axis: Axis) =>
  space === "local" ? rotateVec(frameRotation, GAME_BASIS[axis]) : GAME_BASIS[axis]

/** The axes a move takes whole grid steps along: the handle's, in local space. World space has the grid's own lines. */
export const stepAxesOf = (
  start: Pick<DragStart, "spec" | "space" | "frameRotation">
): ReadonlyArray<Vec3> | undefined => {
  const { axis, kind } = start.spec
  if (start.space !== "local" || axis === undefined) return undefined
  return (kind === "translateAxis" ? [axis] : pairOf(axis)).map((one) => axisDirection(start, one))
}

/**
 * The local axes a handle's move or turn is measured along, which each unit takes as its own in Each (domain/units.ts);
 * undefined for the game's axes, and for the ring that turns about the view, which has no axis of the gizmo's.
 */
export const localFrameOf = (
  { frameRotation, space, spec }: Pick<DragStart, "spec" | "space" | "frameRotation">
): Quat4 | undefined => space === "local" && spec.kind !== "rotateView" ? frameRotation : undefined

/**
 * A rotate handle's turn for the pointer at `now`, in game space: the axis, and the angle about it in the sense
 * `rotateVec` turns (a game quaternion's axis is the world's mirrored, so the sign changes on the way through coords.ts).
 */
export const turnOf = (
  start: DragStart,
  now: PointerSample
): { readonly axis: Vec3; readonly angle: number } | undefined => {
  const { spec } = start
  const dir = dragAxisWorld(start)
  if (dir === undefined || (spec.kind !== "rotateAxis" && spec.kind !== "rotateView")) return undefined
  // Counter-clockwise on screen is a positive (right-handed) turn about an axis pointing at
  // the viewer; flip when the axis points away.
  const facing = dir.dot(start.toCamera)
  const sign = spec.kind === "rotateView" || facing >= 0 ? 1 : -1
  return {
    axis: threeToUeVector(dir),
    angle: -sign * screenAngle(start.originPx, start.pointer.px, now.px)
  }
}

/** A scale handle's scale for the pointer at `now`. */
export const scaleOf = (
  start: DragStart,
  now: PointerSample
): { readonly factor: number; readonly axis?: Axis } | undefined => {
  const { spec } = start
  if (spec.kind === "scaleUniform") {
    const r0 = Math.hypot(start.pointer.px.x - start.originPx.x, start.pointer.px.y - start.originPx.y)
    const r1 = Math.hypot(now.px.x - start.originPx.x, now.px.y - start.originPx.y)
    return r0 < 1 ? undefined : { factor: r1 / r0 }
  }
  const dir = dragAxisWorld(start)
  if (dir === undefined || spec.kind !== "scaleAxis" || spec.axis === undefined) return undefined
  // The handle is measured along its world direction, but each item scales its own axis.
  const t = axisParams(start, now, dir)
  return t === undefined || Math.abs(t[0]) < 1e-6 ? undefined : { factor: t[1] / t[0], axis: spec.axis }
}

/** Where the pointer's ray passes the axis line through the origin, at drag start and now. */
const axisParams = (
  start: DragStart,
  now: PointerSample,
  dir: THREE.Vector3
): readonly [number, number] | undefined => {
  const t0 = axisParamFromRay(start.originWorld, dir, start.pointer.rayOrigin, start.pointer.rayDir)
  const t1 = axisParamFromRay(start.originWorld, dir, now.rayOrigin, now.rayDir)
  return t0 === undefined || t1 === undefined ? undefined : [t0, t1]
}
