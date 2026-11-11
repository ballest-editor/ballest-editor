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

const BOX_AXES: ReadonlyArray<BoxAxis> = ["x", "y", "z"]

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

/** What Distribute makes equal: the gaps between the boxes, or the steps between their centres. */
export type Distribution = "gaps" | "centres"

/**
 * What spreads the boxes along `axis`, in order of their centres. With no `fixed` spacing the outer two stay and the
 * gaps or centre steps come out equal, which takes three boxes. With one, each gap or step is that many cm, counted out
 * both ways from box `fixed.from`, which stays; a gap of 0 stacks them.
 */
export const distributeOffsets = (
  boxes: ReadonlyArray<Box>,
  axis: BoxAxis,
  by: Distribution,
  fixed?: { readonly spacing: number; readonly from: number }
): ReadonlyArray<Vec3> => {
  const none = boxes.map(() => ORIGIN)
  if (boxes.length < (fixed === undefined ? 3 : 2)) return none
  const order = boxes.map((box, index) => ({ box, index }))
    .sort((a, b) => sideOf(a.box, axis, "centre") - sideOf(b.box, axis, "centre"))
  const size = (box: Box) => box.max[axis] - box.min[axis]
  const out = [...none]
  if (fixed !== undefined) {
    const at = order.findIndex(({ index }) => index === fixed.from)
    if (at === -1) return none
    // where each box ends up along the axis, as its min: the fixed one stays, the rest follow out from it
    const placed = new Map<number, number>([[at, order[at]?.box.min[axis] ?? 0]])
    const step = (from: number, to: number) => {
      const a = order[from]?.box
      const b = order[to]?.box
      const start = placed.get(from)
      if (a === undefined || b === undefined || start === undefined) return
      const sign = to > from ? 1 : -1
      const next = by === "gaps"
        ? (sign > 0 ? start + size(a) + fixed.spacing : start - fixed.spacing - size(b))
        : start + size(a) / 2 + sign * fixed.spacing - size(b) / 2
      placed.set(to, next)
    }
    for (let i = at + 1; i < order.length; i++) step(i - 1, i)
    for (let i = at - 1; i >= 0; i--) step(i + 1, i)
    order.forEach(({ box, index }, i) => {
      out[index] = along(axis, (placed.get(i) ?? box.min[axis]) - box.min[axis])
    })
    return out
  }
  const [first] = order
  const last = order.at(-1)
  if (first === undefined || last === undefined) return none
  const steps = order.length - 1
  if (by === "centres") {
    const from = sideOf(first.box, axis, "centre")
    const step = (sideOf(last.box, axis, "centre") - from) / steps
    order.forEach(({ box, index }, i) => {
      out[index] = along(axis, from + step * i - sideOf(box, axis, "centre"))
    })
    return out
  }
  const filled = order.reduce((sum, { box }) => sum + size(box), 0)
  const gap = (last.box.max[axis] - first.box.min[axis] - filled) / steps
  let at = first.box.min[axis]
  for (const { box, index } of order) {
    out[index] = along(axis, at - box.min[axis])
    at += size(box) + gap
  }
  return out
}

/**
 * One Align or Distribute along one axis (docs/SNAPPING.md § Align and distribute). Align lines each box's side up on
 * the active unit's, or on the box around them all; Distribute spreads them (`distributeOffsets`).
 */
export type ArrangeOp =
  | {
    readonly kind: "align"
    readonly axis: BoxAxis
    readonly side: BoxSide
    readonly to: "active" | "bounds"
  }
  | { readonly kind: "distribute"; readonly axis: BoxAxis; readonly by: Distribution }

/** The box around `boxes`; undefined with none. */
const boxAround = (boxes: ReadonlyArray<Box>): Box | undefined =>
  boxes.reduce<Box | undefined>((around, box) =>
    around === undefined ? box : {
      min: {
        x: Math.min(around.min.x, box.min.x),
        y: Math.min(around.min.y, box.min.y),
        z: Math.min(around.min.z, box.min.z)
      },
      max: {
        x: Math.max(around.max.x, box.max.x),
        y: Math.max(around.max.y, box.max.y),
        z: Math.max(around.max.z, box.max.z)
      }
    }, undefined)

/**
 * What `op` moves each box by, in the boxes' own coordinates. `active` is the index of the active unit's box, which
 * Align lines the others up on and a fixed `spacing` counts out from; `spacing` undefined is Auto.
 */
export const arrangeOffsets = (
  boxes: ReadonlyArray<Box>,
  op: ArrangeOp,
  active: number,
  spacing: number | undefined
): ReadonlyArray<Vec3> => {
  if (op.kind === "distribute") {
    return distributeOffsets(boxes, op.axis, op.by, spacing === undefined ? undefined : { spacing, from: active })
  }
  const reference = op.to === "active" ? boxes[active] : boxAround(boxes)
  if (reference === undefined || boxes.length < 2) return boxes.map(() => ORIGIN)
  return alignOffsets(boxes, op.axis, op.side, reference)
}

/** Under this an offset moves nothing: a box already where `op` puts it. */
const STILL_CM = 0.01

/** Whether an offset moves its box. */
export const movesBox = (offset: Vec3): boolean => vecLength(offset) > STILL_CM

/** The face of `box` on `side` of `axis`, its corners round in order. */
export const boxFace = (box: Box, axis: BoxAxis, side: "min" | "max"): ReadonlyArray<Vec3> => {
  const k = BOX_AXES.indexOf(axis)
  const i = BOX_AXES[(k + 1) % 3] ?? "x"
  const j = BOX_AXES[(k + 2) % 3] ?? "y"
  const at = box[side][axis]
  const point = (a: number, b: number) => ({ ...ORIGIN, [axis]: at, [i]: a, [j]: b }) as Vec3
  return [
    point(box.min[i], box.min[j]),
    point(box.max[i], box.min[j]),
    point(box.max[i], box.max[j]),
    point(box.min[i], box.max[j])
  ]
}

const faceCentre = (corners: ReadonlyArray<Vec3>): Vec3 =>
  vecScale(corners.reduce((sum, corner) => vecAdd(sum, corner), ORIGIN), 1 / Math.max(corners.length, 1))

const shifted = (box: Box, by: Vec3): Box => ({ min: vecAdd(box.min, by), max: vecAdd(box.max, by) })

/** A dimension: a span between two points along the axis, and what it measures. */
export interface ArrangeDimension {
  readonly from: Vec3
  readonly to: Vec3
  readonly cm: number
}

/**
 * What the preview of `op` draws, in the boxes' coordinates (docs/SNAPPING.md § Align and distribute): where each box
 * that moves lands, the face of it that lines up and where that face goes, the active unit's face they meet and the
 * plane through it, and for Distribute the gaps or centre steps it makes equal.
 */
export interface ArrangeMarks {
  readonly landings: ReadonlyArray<Box>
  /** Each moving box's face that lines up, where it starts and where it lands. */
  readonly faces: ReadonlyArray<{ readonly from: ReadonlyArray<Vec3>; readonly to: ReadonlyArray<Vec3> }>
  /** The active unit's face the others line up on: Align to a side of the active unit only. */
  readonly reference?: ReadonlyArray<Vec3>
  /** The plane the faces or centres meet on: Align only. */
  readonly plane?: ReadonlyArray<Vec3>
  /** From where each moving box starts to where it lands: its lining-up face's centre, or its own. */
  readonly paths: ReadonlyArray<{ readonly from: Vec3; readonly to: Vec3 }>
  readonly dimensions: ReadonlyArray<ArrangeDimension>
}

/** How far past the boxes the plane reaches, as a share of their span, and at least this many cm. */
const PLANE_MARGIN = 0.08
const PLANE_MARGIN_CM = 20

export const arrangeMarks = (
  boxes: ReadonlyArray<Box>,
  offsets: ReadonlyArray<Vec3>,
  op: ArrangeOp,
  active: number
): ArrangeMarks => {
  const after = boxes.map((box, i) => shifted(box, offsets[i] ?? ORIGIN))
  const moving = boxes.flatMap((box, i) => movesBox(offsets[i] ?? ORIGIN) ? [{ box, landing: after[i] ?? box }] : [])
  const landings = moving.map(({ landing }) => landing)
  const { axis } = op
  if (op.kind === "distribute") {
    const order = after.toSorted((a, b) => sideOf(a, axis, "centre") - sideOf(b, axis, "centre"))
    const dimensions = order.slice(1).map((next, i): ArrangeDimension => {
      const previous = order[i] ?? next
      const middle = vecScale(vecAdd(boxCentreOf(previous), boxCentreOf(next)), 0.5)
      const from = { ...middle, [axis]: op.by === "gaps" ? previous.max[axis] : sideOf(previous, axis, "centre") }
      const to = { ...middle, [axis]: op.by === "gaps" ? next.min[axis] : sideOf(next, axis, "centre") }
      return { from, to, cm: to[axis] - from[axis] }
    })
    const faces = op.by === "gaps"
      ? moving.flatMap(({ box, landing }) =>
        (["min", "max"] as const).map((side) => ({ from: boxFace(box, axis, side), to: boxFace(landing, axis, side) }))
      )
      : []
    const paths = moving.map(({ box, landing }) => ({ from: boxCentreOf(box), to: boxCentreOf(landing) }))
    return { landings, faces, paths, dimensions }
  }
  const reference = op.to === "active" ? boxes[active] : boxAround(boxes)
  const around = boxAround([...boxes, ...after])
  if (reference === undefined || around === undefined) return { landings, faces: [], paths: [], dimensions: [] }
  const at = sideOf(reference, axis, op.side)
  const plane = BOX_AXES.filter((other) => other !== axis)
  const [i = "x", j = "y"] = plane
  const reach = (other: BoxAxis) => {
    const span = around.max[other] - around.min[other]
    const margin = Math.max(span * PLANE_MARGIN, PLANE_MARGIN_CM)
    return [around.min[other] - margin, around.max[other] + margin] as const
  }
  const [i0, i1] = reach(i)
  const [j0, j1] = reach(j)
  const point = (a: number, b: number) => ({ ...ORIGIN, [axis]: at, [i]: a, [j]: b }) as Vec3
  const planeCorners = [point(i0, j0), point(i1, j0), point(i1, j1), point(i0, j1)]
  if (op.side === "centre") {
    const paths = moving.map(({ box, landing }) => ({ from: boxCentreOf(box), to: boxCentreOf(landing) }))
    return { landings, faces: [], plane: planeCorners, paths, dimensions: [] }
  }
  const side = op.side
  const faces = moving.map(({ box, landing }) => ({ from: boxFace(box, axis, side), to: boxFace(landing, axis, side) }))
  const paths = faces.map(({ from, to }) => ({ from: faceCentre(from), to: faceCentre(to) }))
  return {
    landings,
    faces,
    ...(op.to === "active" && { reference: boxFace(reference, axis, side) }),
    plane: planeCorners,
    paths,
    dimensions: []
  }
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
 * `t` reflected in `plane`. A reflection can't be a rotation, so the item also takes a flip on `axis` (Flip X by
 * default): its origin is reflected, and its axes are the reflection's with that one turned back, which the flip then
 * undoes. An item whose `axis` is square to the plane keeps its rotation.
 */
export const mirroredTransform = <T extends UeTransform>(t: T, plane: MirrorPlane, axis: "x" | "y" = "x"): T => {
  const normal = vecNormalize(plane.normal)
  const forward = vecScale(reflected(rotateVec(t.rotation, { x: 1, y: 0, z: 0 }), normal), axis === "x" ? -1 : 1)
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
    const stop = { kind: "face", axis } as const
    return [
      { start: vecAdd(centre, vecScale(axis, -reach)), label: "Near face", station: true, stop },
      { start: centre, label: "Center", station: true, stop: { kind: "centre" } },
      { start: vecAdd(centre, vecScale(axis, reach)), label: "Far face", station: true, stop }
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
      return [{ start: boxCentreOf(box), label: "Center" }]
    case "closest":
      return boxPoints(box)
  }
}

/**
 * The selection's points that can land: its ends when Connectors is on and it has any, whatever the base setting says,
 * since joining end to end is the point of a piece with ends; else what the setting names. Under a line or a plane
 * (`constraint`) the pivot and the selection's stations land too, the nearest match saying which is meant. A point that
 * is already one of them stays what it is, and takes the station's `stop`.
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
    const at = bases.findIndex(({ start, stop }) =>
      vecDistance(start, base.start) < SAME_BASE_CM && (stop === undefined || stop.kind === base.stop?.kind)
    )
    const same = bases[at]
    if (same === undefined) bases.push(base)
    else if (base.stop !== undefined) bases[at] = { ...same, stop: base.stop }
  }
  return bases
}
