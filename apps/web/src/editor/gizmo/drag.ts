/**
 * Drag math: start state + current pointer -> the GAME-space delta the drag applies to the
 * selection (domain/groupTransform applies it to each item). World-space
 * quantities (rays, axis directions) are only used to measure the pointer; the deltas are
 * converted to game space through coords.ts.
 */
import type * as THREE from "three"
import type { Quat4, Vec3 } from "../../domain/coords"
import type { GroupDelta } from "../../domain/groupTransform"
import { snapValue } from "../../domain/snap"
import { rotateVec } from "../../domain/ueMath"
import { type GizmoSpace, type HandleSpec, handleWorldDir, pairOf } from "./handles"
import {
  type Axis,
  axisParamFromRay,
  axisWorldDir,
  GAME_BASIS,
  planeHit,
  type Px,
  screenAngle,
  worldAxisAngleToGameQuat
} from "./math"

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
  /** The active item's rotation at drag start: the frame of the local axes. */
  readonly frameRotation: Quat4
  /** The pivot (the active item's pivot point) in world space, and on screen. */
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

/** Grid snapping for translate drags: the step in cm, and the pivot (game space) it applies to. */
export interface DragGrid {
  readonly size: number
  readonly pivot: Vec3
}

/** Which snapping is on for a drag: the translation grid, and the rotation step in degrees. */
export interface DragSnap {
  readonly grid?: DragGrid | undefined
  readonly rotationStep?: number | undefined
}

/**
 * The delta for the pointer at `now`. With a `grid`, translate drags snap: in world space
 * the pivot lands on the world grid along the moved axes (the others keep their values); in
 * local space the selection moves in whole grid steps along the active item's axes. With a
 * `rotationStep`, rotate drags turn in whole steps from where they started.
 */
export const dragDelta = (
  start: DragStart,
  now: PointerSample,
  { grid, rotationStep }: DragSnap = {}
): GroupDelta | undefined => {
  const { spec, originWorld: o } = start
  if (spec.kind === "scaleUniform") {
    const r0 = Math.hypot(start.pointer.px.x - start.originPx.x, start.pointer.px.y - start.originPx.y)
    const r1 = Math.hypot(now.px.x - start.originPx.x, now.px.y - start.originPx.y)
    if (r0 < 1) return undefined
    return { kind: "scale", factor: r1 / r0 }
  }
  const dir = dragAxisWorld(start)
  if (dir === undefined) return undefined
  switch (spec.kind) {
    case "translateAxis": {
      const t = axisParams(start, now, dir)
      if (t === undefined || spec.axis === undefined) return undefined
      return translateDelta(start, [[spec.axis, t[1] - t[0]]], grid)
    }
    case "translatePlane": {
      const p0 = planeHit(o, dir, start.pointer.rayOrigin, start.pointer.rayDir)
      const p1 = planeHit(o, dir, now.rayOrigin, now.rayDir)
      if (p0 === undefined || p1 === undefined || spec.axis === undefined) return undefined
      // Measured along the plane's two axes, so nothing leaks along its normal.
      const d = p1.sub(p0)
      const frame = start.space === "local" ? start.frameRotation : undefined
      return translateDelta(start, pairOf(spec.axis).map((a) => [a, d.dot(axisWorldDir(a, frame))] as const), grid)
    }
    case "rotateAxis":
    case "rotateView": {
      // Counter-clockwise on screen is a positive (right-handed) turn about an axis
      // pointing at the viewer; flip when the axis points away.
      const facing = dir.dot(start.toCamera)
      const sign = spec.kind === "rotateView" || facing >= 0 ? 1 : -1
      const free = sign * screenAngle(start.originPx, start.pointer.px, now.px)
      const angle = rotationStep === undefined
        ? free
        : snapValue((free * 180) / Math.PI, rotationStep) * Math.PI / 180
      return { kind: "rotate", rotation: worldAxisAngleToGameQuat(dir, angle) }
    }
    case "scaleAxis": {
      // The handle is measured along its world direction, but each item scales its own axis.
      const t = axisParams(start, now, dir)
      if (t === undefined || Math.abs(t[0]) < 1e-6 || spec.axis === undefined) return undefined
      return { kind: "scale", factor: t[1] / t[0], axis: spec.axis }
    }
  }
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

/** A move of `distance` cm along each gizmo axis (game axes, or the active item's own in local space). */
const translateDelta = (
  start: DragStart,
  moves: ReadonlyArray<readonly [Axis, number]>,
  grid: DragGrid | undefined
): GroupDelta => {
  const local = start.space === "local"
  const offset = { x: 0, y: 0, z: 0 }
  for (const [axis, distance] of moves) {
    const step = local && grid !== undefined ? snapValue(distance, grid.size) : distance
    const dir = local ? rotateVec(start.frameRotation, GAME_BASIS[axis]) : GAME_BASIS[axis]
    offset.x += dir.x * step
    offset.y += dir.y * step
    offset.z += dir.z * step
  }
  if (!local && grid !== undefined) {
    for (const [axis] of moves) offset[axis] = snapValue(grid.pivot[axis] + offset[axis], grid.size) - grid.pivot[axis]
  }
  return { kind: "translate", offset }
}
