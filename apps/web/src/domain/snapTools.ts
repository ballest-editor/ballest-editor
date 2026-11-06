/**
 * What the tools built on the targets do (docs/SNAPPING.md § Tools built on the targets), and the points of a selection
 * that can land. Each takes the points and faces the one target picker gave it. Everything is in game space.
 */
import type { WorldEnd } from "./connectors"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { type Box, boxCentreOf } from "./itemBounds"
import type { ConstructionAxis, ConstructionPlane } from "./MapSidecar"
import type { SnapConfig } from "./snapConfig"
import { axesOf, type BasePoint, type Constraint } from "./snapFrame"
import {
  IDENTITY_QUAT,
  ORIGIN,
  quatBetween,
  quatFromAxisAngle,
  quatFromFrame,
  rotateVec,
  squareTo,
  vecAdd,
  vecCross,
  vecDistance,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub
} from "./ueMath"

/** A face, as the picker gives it: a point on it and the way it faces out. */
export interface PickedFace {
  readonly point: Vec3
  readonly normal: Vec3
}

export type FaceMeeting = "flush" | "tangent"

/** How B moves to meet A: a turn about B's point, then an offset. */
export interface FaceMove {
  readonly rotation: Quat4
  readonly about: Vec3
  readonly offset: Vec3
}

/**
 * The move that puts face `b` on face `a`: Flush leaves them coplanar and facing the same way, Tangent touching and
 * facing each other. `standOff` cm along `a`'s normal keeps them apart. B slides no more than that takes.
 */
export const faceMeeting = (a: PickedFace, b: PickedFace, mode: FaceMeeting, standOff: number): FaceMove => {
  const normal = vecNormalize(a.normal)
  const wanted = mode === "flush" ? normal : vecScale(normal, -1)
  const rotation = quatBetween(vecNormalize(b.normal), wanted)
  const across = vecDot(vecSub(a.point, b.point), normal) + standOff
  return { rotation, about: b.point, offset: vecScale(normal, across) }
}

export type BoxAxis = "x" | "y" | "z"
export type BoxSide = "min" | "centre" | "max"

const sideOf = (box: Box, axis: BoxAxis, side: BoxSide) =>
  side === "centre" ? (box.min[axis] + box.max[axis]) / 2 : box[side][axis]

const along = (axis: BoxAxis, by: number): Vec3 => ({ ...ORIGIN, [axis]: by })

/** What moves each box's `side` onto `reference`'s. */
export const alignOffsets = (
  boxes: ReadonlyArray<Box>,
  axis: BoxAxis,
  side: BoxSide,
  reference: Box
): ReadonlyArray<Vec3> => boxes.map((box) => along(axis, sideOf(reference, axis, side) - sideOf(box, axis, side)))

export type Distribution = "spacing" | "gaps"

/** What spreads the boxes along `axis`, the outer two staying: even centres, or even gaps between them. */
export const distributeOffsets = (
  boxes: ReadonlyArray<Box>,
  axis: BoxAxis,
  by: Distribution
): ReadonlyArray<Vec3> => {
  const none = boxes.map(() => ORIGIN)
  if (boxes.length < 3) return none
  const order = boxes.map((box, index) => ({ box, index }))
    .sort((a, b) => sideOf(a.box, axis, "centre") - sideOf(b.box, axis, "centre"))
  const [first] = order
  const last = order.at(-1)
  if (first === undefined || last === undefined) return none
  const steps = order.length - 1
  const out = [...none]
  if (by === "spacing") {
    const from = sideOf(first.box, axis, "centre")
    const step = (sideOf(last.box, axis, "centre") - from) / steps
    order.forEach(({ box, index }, i) => {
      out[index] = along(axis, from + step * i - sideOf(box, axis, "centre"))
    })
    return out
  }
  const size = (box: Box) => box.max[axis] - box.min[axis]
  const filled = order.reduce((sum, { box }) => sum + size(box), 0)
  const gap = (last.box.max[axis] - first.box.min[axis] - filled) / steps
  let at = first.box.min[axis]
  for (const { box, index } of order) {
    out[index] = along(axis, at - box.min[axis])
    at += size(box) + gap
  }
  return out
}

export const measurementFacts = (a: Vec3, b: Vec3) => {
  const delta = vecSub(b, a)
  return { distance: vecLength(delta), delta }
}

/** The angle between two faces, from their normals, in degrees. */
export const angleBetweenFaces = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, vecDot(vecNormalize(a), vecNormalize(b))))) * 180 / Math.PI

/** The plane a mirror goes through. */
export interface MirrorPlane {
  readonly origin: Vec3
  readonly normal: Vec3
}

const reflected = (v: Vec3, normal: Vec3) => vecSub(v, vecScale(normal, 2 * vecDot(v, normal)))

/** Where `plane` reflects a point of the world. */
export const mirroredPoint = (point: Vec3, { normal, origin }: MirrorPlane): Vec3 =>
  vecAdd(origin, reflected(vecSub(point, origin), vecNormalize(normal)))

/**
 * `t` reflected in `plane`. A reflection can't be a rotation, so the item also takes a Flip X: its origin is reflected,
 * and its axes are the reflection's with X turned back, which the flip then undoes.
 */
export const mirroredTransform = <T extends UeTransform>(t: T, plane: MirrorPlane): T => {
  const normal = vecNormalize(plane.normal)
  const forward = vecScale(reflected(rotateVec(t.rotation, { x: 1, y: 0, z: 0 }), normal), -1)
  const up = reflected(rotateVec(t.rotation, { x: 0, y: 0, z: 1 }), normal)
  return { ...t, translation: mirroredPoint(t.translation, plane), rotation: quatFromFrame(forward, up) }
}

const DEFAULT_EXTENT = 1000

export const planeFromFace = (point: Vec3, normal: Vec3, id: string, name: string): ConstructionPlane => {
  const unit = vecNormalize(normal)
  return {
    kind: "plane",
    id,
    name,
    origin: point,
    normal: unit,
    xAxis: squareTo(unit),
    extent: DEFAULT_EXTENT,
    grid: false
  }
}

/** The plane through three points; undefined when they are in a line. */
export const planeFromPoints = (
  a: Vec3,
  b: Vec3,
  c: Vec3,
  id: string,
  name: string
): ConstructionPlane | undefined => {
  const normal = vecCross(vecSub(b, a), vecSub(c, a))
  if (vecLength(normal) < 1e-6) return undefined
  return { ...planeFromFace(a, normal, id, name), xAxis: vecNormalize(vecSub(b, a)) }
}

export const WORLD_PLANES = ["xy", "xz", "yz"] as const
export type WorldPlane = (typeof WORLD_PLANES)[number]

export const WORLD_NORMALS: Readonly<Record<WorldPlane, Vec3>> = {
  xy: { x: 0, y: 0, z: 1 },
  xz: { x: 0, y: 1, z: 0 },
  yz: { x: 1, y: 0, z: 0 }
}

export const planeFromWorld = (plane: WorldPlane, through: Vec3, id: string, name: string): ConstructionPlane =>
  planeFromFace(through, WORLD_NORMALS[plane], id, name)

/** A plane `distance` cm along `from`'s normal, turned `angle` degrees about its X axis. */
export const planeFromOffset = (
  from: ConstructionPlane,
  distance: number,
  angle: number,
  id: string,
  name: string
): ConstructionPlane => {
  const turn = angle === 0 ? IDENTITY_QUAT : quatFromAxisAngle(from.xAxis, angle * Math.PI / 180)
  return {
    ...from,
    id,
    name,
    origin: vecAdd(from.origin, vecScale(from.normal, distance)),
    normal: rotateVec(turn, from.normal)
  }
}

export const WORLD_AXES = ["x", "y", "z"] as const

export const axisFromWorld = (
  axis: (typeof WORLD_AXES)[number],
  through: Vec3,
  id: string,
  name: string
): ConstructionAxis => ({
  kind: "axis",
  id,
  name,
  origin: through,
  direction: { ...ORIGIN, [axis]: 1 },
  extent: DEFAULT_EXTENT
})

/** The axis through two points; undefined when they are one. */
export const axisFromPoints = (a: Vec3, b: Vec3, id: string, name: string): ConstructionAxis | undefined => {
  const direction = vecSub(b, a)
  if (vecLength(direction) < 1e-6) return undefined
  return { kind: "axis", id, name, origin: a, direction: vecNormalize(direction), extent: DEFAULT_EXTENT }
}

/** What makes up a selection, for its bases. */
export interface BaseSelection {
  /** The active item's pivot. */
  readonly pivot: Vec3
  readonly box: Box
  readonly ends: ReadonlyArray<WorldEnd>
}

const boxPoints = ({ max, min }: Box): ReadonlyArray<BasePoint> => {
  const levels = (axis: "x" | "y" | "z") => [min[axis], (min[axis] + max[axis]) / 2, max[axis]]
  return levels("x").flatMap((x, i) =>
    levels("y").flatMap((y, j) =>
      levels("z").flatMap((z, k): ReadonlyArray<BasePoint> => {
        const centred = [i, j, k].filter((level) => level === 1).length
        if (centred === 3) return []
        const label = centred === 0 ? "Corner" : centred === 1 ? "Edge" : "Face"
        return [{ start: { x, y, z }, label }]
      })
    )
  )
}

/** What counts as one point of the selection, in cm. */
const SAME_BASE_CM = 1e-3

/** The selection's near face, centre and far face along each way `constraint` moves. */
const stationBases = ({ max, min }: Box, constraint: Constraint): ReadonlyArray<BasePoint> => {
  const centre = boxCentreOf({ max, min })
  const half = vecScale(vecSub(max, min), 0.5)
  return axesOf(constraint).flatMap(({ x, y, z }): ReadonlyArray<BasePoint> => {
    const axis = { x, y, z }
    const reach = Math.abs(x) * half.x + Math.abs(y) * half.y + Math.abs(z) * half.z
    return [
      { start: vecAdd(centre, vecScale(axis, -reach)), label: "Near face", station: true },
      { start: centre, label: "Centre", station: true },
      { start: vecAdd(centre, vecScale(axis, reach)), label: "Far face", station: true }
    ]
  })
}

/** What the Base setting names: a selection's ends when Connectors is on and it has any, else the setting's own points. */
const chosenBases = (config: SnapConfig, { box, ends, pivot }: BaseSelection): ReadonlyArray<BasePoint> => {
  if (config.targets.connectors.enabled && ends.length > 0) {
    return ends.map((end) => ({ start: end.position, label: "End", end }))
  }
  switch (config.base) {
    case "pivot":
      return [{ start: pivot, label: "Pivot" }]
    case "centre":
      return [{ start: boxCentreOf(box), label: "Centre" }]
    case "closest":
      return boxPoints(box)
  }
}

/**
 * The selection's points that can land: its ends when Connectors is on and it has any, whatever the base setting says,
 * since joining end to end is the point of a piece with ends; else what the setting names. Under a line or a plane
 * (`constraint`) the pivot and the selection's stations land too, the nearest match saying which is meant.
 */
export const selectionBases = (
  config: SnapConfig,
  selection: BaseSelection,
  constraint?: Constraint
): ReadonlyArray<BasePoint> => {
  const chosen = chosenBases(config, selection)
  if (constraint === undefined || constraint.kind === "surface") return chosen
  const bases = [...chosen]
  for (
    const base of [
      { start: selection.pivot, label: "Pivot", station: true },
      ...stationBases(selection.box, constraint)
    ]
  ) {
    if (!bases.some(({ start }) => vecDistance(start, base.start) < SAME_BASE_CM)) bases.push(base)
  }
  return bases
}
