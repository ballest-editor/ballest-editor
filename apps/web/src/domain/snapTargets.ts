/**
 * What each target offers a frame (docs/SNAPPING.md § Snap targets), as hits in range of a base. The Grid has its own
 * rule, in `snapResolve`, and Alignment its own module. Everything is in game space and measured in the active pane's
 * pixels.
 */
import { endsFit, meetingTurn, type WorldEnd } from "./connectors"
import type { Quat4, Vec3 } from "./coords"
import type { ConstructionAxis, ConstructionPlane } from "./MapSidecar"
import { runMidpoints } from "./meshElements"
import { localToWorld } from "./pivot"
import { snapValue } from "./snap"
import { rangeOf, type SnapConfig, type SnapTarget } from "./snapConfig"
import {
  type BasePoint,
  type Constraint,
  freePoint,
  type HeldShape,
  lineNearRay,
  pixelDistance,
  rayOnPlane,
  referenceOf,
  type ScreenPoint,
  segmentNearRay,
  type SnapFrame,
  type SnapHit,
  type SnapItem,
  type SnapMark,
  type SnapRelation
} from "./snapFrame"
import { gridAxes } from "./snapGrid"
import { boxMark, itemBoxMark, sourceOf } from "./snapRelation"
import {
  quatBetween,
  quatFromAxisAngle,
  rotateVec,
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub
} from "./ueMath"

const Z_AXIS: Vec3 = { x: 0, y: 0, z: 1 }

/** How far along its plane's axes a point is from `origin`. */
const inPlane = (point: Vec3, plane: ConstructionPlane) => {
  const from = vecSub(point, plane.origin)
  return { u: vecDot(from, plane.xAxis), v: vecDot(from, vecCross(plane.normal, plane.xAxis)) }
}

/** The bases and the pixels each is measured from. */
const measuredBases = (frame: SnapFrame) =>
  frame.bases.flatMap((base) => {
    const reference = referenceOf(frame, base)
    return reference === undefined ? [] : [{ base, reference }]
  })

const screenBox = (frame: SnapFrame, item: SnapItem) => {
  const { max, min } = item.box
  const corners = [min.x, max.x].flatMap((x) =>
    [min.y, max.y].flatMap((y) => [min.z, max.z].flatMap((z) => frame.view.project({ x, y, z }) ?? []))
  )
  if (corners.length === 0) return undefined
  return {
    left: Math.min(...corners.map((c) => c.x)),
    right: Math.max(...corners.map((c) => c.x)),
    top: Math.min(...corners.map((c) => c.y)),
    bottom: Math.max(...corners.map((c) => c.y))
  }
}

const screenBoxes = new WeakMap<SnapFrame, ReadonlyMap<SnapItem, ReturnType<typeof screenBox>>>()

/** Every item's box on screen, once a frame however many targets ask. */
const screenBoxesOf = (frame: SnapFrame) => {
  const kept = screenBoxes.get(frame)
  if (kept !== undefined) return kept
  const boxes = new Map(frame.items.map((item) => [item, screenBox(frame, item)]))
  screenBoxes.set(frame, boxes)
  return boxes
}

/** The items whose box shows within `range` of any of `references`: a map of thousands asks little more than this. */
const itemsNear = (frame: SnapFrame, references: ReadonlyArray<ScreenPoint>, range: number) =>
  frame.items.filter((item) => {
    const box = screenBoxesOf(frame).get(item)
    return box !== undefined &&
      references.some(({ x, y }) =>
        x >= box.left - range && x <= box.right + range && y >= box.top - range && y <= box.bottom + range
      )
  })

interface Spot {
  readonly at: Vec3
  readonly label: string
  /** A point of a piece meets the base where it is, unless it says otherwise. */
  readonly relation?: SnapRelation
  readonly marks?: ReadonlyArray<SnapMark>
  readonly item?: string
}

/** A hit on a point, when it shows within `range` of the base. */
const pointHit = (
  frame: SnapFrame,
  target: SnapTarget,
  { base, reference }: { readonly base: BasePoint; readonly reference: ScreenPoint },
  spot: Spot,
  range: number
): ReadonlyArray<SnapHit> => {
  const shown = frame.view.project(spot.at)
  if (shown === undefined) return []
  const distance = pixelDistance(shown, reference)
  if (distance > range) return []
  return [{
    target,
    rank: 0,
    distance,
    base,
    landing: spot.at,
    label: spot.label,
    relation: spot.relation ?? "coincident",
    marks: spot.marks ?? [{ kind: "dot", role: "target", at: spot.at }],
    source: sourceOf(frame.box, base),
    held: { shape: "point", at: spot.at },
    ...(spot.item !== undefined && { item: spot.item })
  }]
}

/** The turn Rotate to face asks for on a face of `normal`. */
const faceTurn = (frame: SnapFrame, normal: Vec3): Quat4 | undefined => {
  const { rotateToFace } = frame.config.targets.mesh
  if (rotateToFace === "keep") return undefined
  if (rotateToFace === "align") return quatBetween(rotateVec(frame.rotation, Z_AXIS), normal)
  const out = { x: normal.x, y: normal.y, z: 0 }
  const forward = rotateVec(frame.rotation, { x: 1, y: 0, z: 0 })
  if (vecLength(out) < 1e-3 || Math.hypot(forward.x, forward.y) < 1e-3) return undefined
  const angle = Math.atan2(out.y, out.x) - Math.atan2(forward.y, forward.x)
  return quatFromAxisAngle(Z_AXIS, angle)
}

/** The selection's box and its own part that lands, for what lands on a neighbour's face: both sides read as boxes. */
const boxedSource = (frame: SnapFrame, base: BasePoint): ReadonlyArray<SnapMark> => {
  const source = sourceOf(frame.box, base)
  return source.some(({ kind }) => kind === "box") ? source : [boxMark(frame.box, "source"), ...source]
}

/** A landing on a face of the item `key`, off it by the Mesh target's offset, with the item's box about the face. */
const faceHit = (
  frame: SnapFrame,
  base: BasePoint,
  point: Vec3,
  normal: Vec3,
  corners: ReadonlyArray<Vec3>,
  key: string,
  item = frame.items.find((one) => one.key === key)
): SnapHit => {
  const landing = vecAdd(point, vecScale(normal, frame.config.targets.mesh.offset))
  const rotation = faceTurn(frame, normal)
  // Rotate to face's Align stands the selection square on the face
  const square = rotation !== undefined && frame.config.targets.mesh.rotateToFace === "align"
  return {
    target: "mesh",
    rank: 2,
    distance: 0,
    base,
    landing,
    label: `Face of ${item?.name ?? "a piece"}`,
    relation: square ? "perpendicular" : "onFace",
    marks: [...(item === undefined ? [] : [itemBoxMark(item, "target")]), { kind: "face", role: "target", corners }],
    source: boxedSource(frame, base),
    held: { shape: "plane", origin: landing, normal },
    item: key,
    ...(rotation !== undefined && { rotation })
  }
}

interface BoundsFace {
  readonly centre: Vec3
  readonly normal: Vec3
  readonly corners: ReadonlyArray<Vec3>
  /** Half its size along `u` and `v`. */
  readonly u: Vec3
  readonly v: Vec3
}

const SIGNS = [-1, 1] as const

/** A box's corners and its six faces in the world, from its item's local bounds. */
const boundsOf = ({ bounds, transform }: SnapItem) => {
  if (bounds === undefined) return undefined
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const at = (x: number, y: number, z: number) => localToWorld(transform, { x, y, z })
  const corners = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => at(x, y, z))))
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }
  const half = { x: (x1 - x0) / 2, y: (y1 - y0) / 2, z: (z1 - z0) / 2 }
  const worldCentre = at(mid.x, mid.y, mid.z)
  const axes = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Z_AXIS].map((axis) => rotateVec(transform.rotation, axis))
  const scaled = (["x", "y", "z"] as const).map((name, i) =>
    vecScale(axes[i] ?? Z_AXIS, half[name] * transform.scale3D[name])
  )
  const faces: ReadonlyArray<BoundsFace> = [0, 1, 2].flatMap((i) => {
    const [along, u, v] = [scaled[i], scaled[(i + 1) % 3], scaled[(i + 2) % 3]]
    if (along === undefined || u === undefined || v === undefined) return []
    return SIGNS.map((sign) => {
      const centre = vecAdd(worldCentre, vecScale(along, sign))
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
      return {
        centre,
        normal: vecNormalize(vecScale(along, sign)),
        corners: quad.map(([a, b]) => vecAdd(vecAdd(centre, vecScale(u, a)), vecScale(v, b))),
        u,
        v
      }
    })
  })
  return { corners, faces }
}

/** The face of the box `ray` meets first, from outside. */
const boundsFaceUnder = (faces: ReadonlyArray<BoundsFace>, ray: ReturnType<SnapFrame["view"]["rayAt"]>) => {
  const inside = (face: BoundsFace, point: Vec3) => {
    const from = vecSub(point, face.centre)
    const within = (axis: Vec3) => {
      const length = vecDot(axis, axis)
      return length === 0 || Math.abs(vecDot(from, axis) / length) <= 1
    }
    return within(face.u) && within(face.v)
  }
  const hits = faces.flatMap((face) => {
    if (vecDot(face.normal, ray.direction) >= 0) return []
    const point = rayOnPlane(ray, face.centre, face.normal)
    return point !== undefined && inside(face, point)
      ? [{ face, point, depth: vecDot(vecSub(point, ray.origin), ray.direction) }]
      : []
  })
  return hits.sort((a, b) => a.depth - b.depth)[0]
}

/** The Mesh target's points of one item, its bounds standing in until its mesh has loaded. */
const meshSpotsOf = (config: SnapConfig, item: SnapItem): ReadonlyArray<Spot> => {
  const { elements } = config.targets.mesh
  const of = ` of ${item.name}`
  const mesh = item.mesh()
  const box = mesh === undefined ? boundsOf(item) : undefined
  const spots = (points: ReadonlyArray<Vec3>, label: string, relation: SnapRelation) =>
    points.map((at): Spot => ({ at, label: `${label}${of}`, relation, item: item.key }))
  return [
    ...(elements.boundsCorners && box !== undefined ? spots(box.corners, "Corner", "coincident") : []),
    ...(elements.boundsFaceCentres && box !== undefined
      ? spots(box.faces.map(({ centre }) => centre), "Center of a face", "centre")
      : []),
    ...(elements.vertices && mesh !== undefined ? spots(mesh.vertices, "Vertex", "coincident") : []),
    ...(elements.edgeMidpoints && mesh !== undefined
      ? spots(runMidpoints(mesh), "Middle of an edge", "midpoint")
      : []),
    ...(elements.faceCentres && mesh !== undefined ? spots(mesh.faceCentres, "Center of a face", "centre") : [])
  ]
}

const edgeHits = (
  frame: SnapFrame,
  measured: { readonly base: BasePoint; readonly reference: ScreenPoint },
  item: SnapItem,
  range: number
): ReadonlyArray<SnapHit> => {
  const edges = item.mesh()?.edges ?? []
  const ray = frame.view.rayAt(measured.reference)
  return edges.flatMap(([from, to]) => {
    const landing = segmentNearRay(from, to, ray)
    const shown = frame.view.project(landing)
    if (shown === undefined) return []
    const distance = pixelDistance(shown, measured.reference)
    if (distance > range) return []
    return [{
      target: "mesh" as const,
      rank: 1 as const,
      distance,
      base: measured.base,
      landing,
      label: `Edge of ${item.name}`,
      relation: "onEdge" as const,
      marks: [{ kind: "line" as const, role: "target" as const, from, to }],
      source: sourceOf(frame.box, measured.base),
      held: { shape: "segment" as const, from, to },
      item: item.key
    }]
  })
}

/** Faces under the base: the renderer's for a mesh, and a box's own for an item whose mesh hasn't loaded. */
const faceHits = (
  frame: SnapFrame,
  { base, reference }: { readonly base: BasePoint; readonly reference: ScreenPoint },
  near: ReadonlyArray<SnapItem>
): ReadonlyArray<SnapHit> => {
  const { elements } = frame.config.targets.mesh
  const surface = elements.faces ? frame.surfaceAt?.(reference) : undefined
  const ray = frame.view.rayAt(reference)
  return [
    ...(surface === undefined
      ? []
      : [{ ...faceHit(frame, base, surface.point, surface.normal, surface.corners, surface.item), frontmost: true }]),
    ...(elements.boundsFaces
      ? near.flatMap((item) => {
        const box = item.mesh() === undefined ? boundsOf(item) : undefined
        const under = box === undefined ? undefined : boundsFaceUnder(box.faces, ray)
        return under === undefined
          ? []
          : [faceHit(frame, base, under.point, under.face.normal, under.face.corners, item.key, item)]
      })
      : [])
  ]
}

/** How far off a hard constraint's axis a face's normal can be, in degrees, for the face to stand across the move. */
const ACROSS_DEGREES = 5

const ACROSS = Math.cos(ACROSS_DEGREES * Math.PI / 180)

/** The way a move under `constraint` crosses a plane of `normal`; undefined when the plane doesn't stand across it. */
const moveAcross = (constraint: Constraint, normal: Vec3): Vec3 | undefined => {
  const along = constraint.kind === "line"
    ? vecScale(constraint.direction, vecDot(normal, constraint.direction))
    : vecSub(normal, vecScale(constraint.normal, vecDot(normal, constraint.normal)))
  return vecLength(along) < ACROSS ? undefined : vecNormalize(along)
}

interface StationFace {
  readonly centre: Vec3
  readonly normal: Vec3
  readonly corners: ReadonlyArray<Vec3>
}

/** A plane a hard constraint can stop at. */
interface Station {
  readonly origin: Vec3
  readonly normal: Vec3
  /** The way the move crosses it. */
  readonly along: Vec3
  readonly label: string
  readonly relation: SnapRelation
  readonly marks: ReadonlyArray<SnapMark>
  readonly rotation?: Quat4 | undefined
  /** It is the plane between two faces, and no face itself. */
  readonly middle?: boolean
}

/** A face and the way the move crosses it. */
type FaceAcross = { readonly face: StationFace; readonly along: Vec3 }

/** The plane halfway between the two outermost faces along each way the move crosses `faces`, when they face apart. */
const middlesOf = (item: SnapItem, faces: ReadonlyArray<FaceAcross>): ReadonlyArray<Station> => {
  const runs: Array<{ readonly along: Vec3; readonly faces: Array<StationFace> }> = []
  for (const { along, face } of faces) {
    const run = runs.find((one) => Math.abs(vecDot(one.along, along)) >= ACROSS)
    if (run === undefined) runs.push({ along, faces: [face] })
    else run.faces.push(face)
  }
  return runs.flatMap((run): ReadonlyArray<Station> => {
    const { along } = run
    const inOrder = run.faces.toSorted((a, b) => vecDot(a.centre, along) - vecDot(b.centre, along))
    const [near, far] = [inOrder[0], inOrder.at(-1)]
    if (near === undefined || far === undefined || vecDot(near.normal, far.normal) >= 0) return []
    const origin = vecScale(vecAdd(near.centre, far.centre), 0.5)
    return [{
      origin,
      normal: along,
      along,
      label: `Middle of ${item.name}`,
      relation: "midpoint",
      marks: [{ kind: "guide", from: near.centre, to: far.centre }, { kind: "dot", role: "target", at: origin }],
      middle: true
    }]
  })
}

/** What a hard constraint stops at on one item: its faces across the move, their middles, and its faces' centres. */
const stationsOf = (frame: SnapFrame, item: SnapItem) => {
  const { elements, offset } = frame.config.targets.mesh
  const mesh = item.mesh()
  const faces: ReadonlyArray<StationFace> = mesh?.faces ?? boundsOf(item)?.faces ?? []
  const [planes, points] = mesh === undefined
    ? [elements.boundsFaces, elements.boundsFaceCentres]
    : [elements.faces, elements.faceCentres]
  const across = planes
    ? faces.flatMap((face): ReadonlyArray<FaceAcross> => {
      const along = moveAcross(frame.constraint, face.normal)
      return along === undefined ? [] : [{ face, along }]
    })
    : []
  const stations = across.map(({ along, face: { centre, corners, normal } }): Station => ({
    origin: vecAdd(centre, vecScale(normal, offset)),
    normal,
    along,
    label: `Face of ${item.name}`,
    relation: "flush",
    marks: [itemBoxMark(item, "target"), { kind: "face", role: "target", corners }],
    rotation: faceTurn(frame, normal)
  }))
  // a face's centre is a point to land on under a plane handle; under a line it would be one more middle
  const centres = points && frame.constraint.kind === "plane"
    ? faces.map(({ centre }): Spot => ({
      at: centre,
      label: `Center of a face of ${item.name}`,
      relation: "centre",
      item: item.key
    }))
    : []
  return { centres, stations: [...stations, ...middlesOf(item, across)] }
}

/** Like with like, as in `snapAlignment`: a centre stops on a middle, and a face on a face along the axis it's a face of. */
const pairs = ({ stop }: BasePoint, { along, middle = false }: Station): boolean =>
  stop?.kind === "centre"
    ? middle
    : stop?.kind === "face" && !middle && Math.abs(vecDot(stop.axis, along)) >= Math.SQRT1_2

/** A base stopping at a station, when the move has it within `range`: it isn't looked at, so nothing can hide it. */
const stationHit = (
  frame: SnapFrame,
  base: BasePoint,
  item: SnapItem,
  { along, label, marks, normal, origin, relation, rotation }: Station,
  range: number
): ReadonlyArray<SnapHit> => {
  const free = freePoint(frame, base)
  const landing = vecAdd(free, vecScale(along, vecDot(vecSub(origin, free), normal) / vecDot(along, normal)))
  const [shown, from] = [frame.view.project(landing), frame.view.project(free)]
  if (shown === undefined || from === undefined) return []
  const distance = pixelDistance(shown, from)
  if (distance > range) return []
  return [{
    target: "mesh",
    rank: 2,
    distance,
    base,
    landing,
    label,
    relation,
    marks,
    source: relation === "flush" ? boxedSource(frame, base) : sourceOf(frame.box, base),
    held: { shape: "plane", origin, normal },
    item: item.key,
    frontmost: true,
    ...(rotation !== undefined && { rotation })
  }]
}

export const meshHits = (frame: SnapFrame): ReadonlyArray<SnapHit> => {
  const range = rangeOf(frame.config, "mesh")
  const measured = measuredBases(frame)
  const near = itemsNear(frame, measured.map(({ reference }) => reference), range)
  if (frame.constraint.kind !== "surface") {
    return near.flatMap((item) => {
      const { centres, stations } = stationsOf(frame, item)
      return [
        ...stations.flatMap((station) =>
          measured.flatMap(({ base }) => pairs(base, station) ? stationHit(frame, base, item, station, range) : [])
        ),
        ...centres.flatMap((spot) => measured.flatMap((one) => pointHit(frame, "mesh", one, spot, range)))
      ]
    })
  }
  const { elements } = frame.config.targets.mesh
  return measured.flatMap((one) => [
    ...near.flatMap((item) => [
      ...meshSpotsOf(frame.config, item).flatMap((spot) => pointHit(frame, "mesh", one, spot, range)),
      ...(elements.sharpEdges ? edgeHits(frame, one, item, range) : [])
    ]),
    ...faceHits(frame, one, near)
  ])
}

/** A hit that holds a plane, as a station or one axis of an alignment does. */
export type Stop = SnapHit & { readonly held: Extract<HeldShape, { readonly shape: "plane" }> }

export const isStop = (hit: SnapHit): hit is Stop => hit.held.shape === "plane"

/** Whether two stops set different axes of a plane, by the rule `pairs` has for what's along an axis. */
export const crossing = (a: Stop, b: Stop) => Math.abs(vecDot(a.held.normal, b.held.normal)) < Math.SQRT1_2

/** How far a stop's base stands from its plane, along the plane's normal. */
const gapTo = ({ base, held: { normal, origin } }: Stop) => vecDot(vecSub(origin, base.start), normal)

/** The move across a plane of `normal` that puts each stop's base on its own plane: three planes meeting at a point. */
const moveOnto = (normal: Vec3, a: Stop, b: Stop): Vec3 => {
  const [forA, forB] = [vecCross(b.held.normal, normal), vecCross(normal, a.held.normal)]
  const sum = vecAdd(vecScale(forA, gapTo(a)), vecScale(forB, gapTo(b)))
  return vecScale(sum, 1 / vecDot(a.held.normal, forA))
}

/** "Face of Track and Face of Curve", and on one item "Face and Middle of Track", or "Face of Track" for a corner. */
const labelOfBoth = (a: SnapHit, b: SnapHit): string => {
  if (a.item !== b.item) return `${a.label} and ${b.label}`
  return a.label === b.label ? a.label : `${a.label.replace(/ of .*/u, "")} and ${b.label}`
}

/**
 * Two stops across a plane move of `normal` as one hit, landing where their planes cross (`parts`): each sets one axis.
 * Each base stays on its own plane, the hit's being the first's. It takes no turn, as none faces both.
 */
export const stopsTogether = (normal: Vec3, a: Stop, b: Stop): SnapHit => {
  const { rotation: _none, ...first } = a
  const landing = vecAdd(a.base.start, moveOnto(normal, a, b))
  return {
    ...first,
    distance: Math.hypot(a.distance, b.distance),
    landing,
    label: labelOfBoth(a, b),
    marks: [...a.marks, ...b.marks],
    // each part's base stays on its own plane, and the move takes both
    source: a.base === b.base ? a.source : [...a.source, ...b.source],
    held: { shape: "point", at: landing },
    parts: [a, b]
  }
}

/**
 * What a drag has of a plane's stations, with the nearest along each axis as one hit, as Alignment lands (`parts`).
 * `hits` keeps its order from frame to frame, and so do the parts.
 */
export const stationsTogether = (frame: SnapFrame, hits: ReadonlyArray<SnapHit>): ReadonlyArray<SnapHit> => {
  const { constraint } = frame
  if (constraint.kind !== "plane") return hits
  const stops = hits.filter(isStop)
  const nearest = stops.toSorted((a, b) => a.distance - b.distance)
  const one = nearest[0]
  const other = one === undefined ? undefined : nearest.find((stop) => crossing(one, stop))
  const [a, b] = stops.filter((stop) => stop === one || stop === other)
  if (a === undefined || b === undefined) return hits
  return [...hits.filter((hit) => !isStop(hit)), stopsTogether(constraint.normal, a, b)]
}

/** What an end meeting `other` says: refused under Strict, and a chip's words under Warn. */
const meetingOf = (frame: SnapFrame, own: WorldEnd, other: WorldEnd) => {
  const { flipToFit, profiles } = frame.prefs
  const fit = endsFit(own, other)
  if (profiles === "strict" && !fit.profile) return undefined
  return {
    own: own.ref,
    other: other.ref,
    ...(profiles === "warn" && !fit.profile && { warning: `Profiles differ: ${own.profile}, ${other.profile}` }),
    ...(flipToFit && fit.profile && !fit.hand && { flipFits: true })
  }
}

/**
 * The ends of other items within `range` on screen of one of the selection's ends where the move has them, depth left
 * out and whichever way they face: what the overlay rings as Connectors' to be had.
 */
export const nearEndsOf = (frame: SnapFrame, range: number): ReadonlyArray<WorldEnd> => {
  const references = measuredBases(frame).flatMap(({ base, reference }) => base.end === undefined ? [] : [reference])
  return itemsNear(frame, references, range).flatMap((item) =>
    item.ends.filter((end) => {
      const shown = frame.view.project(end.position)
      return shown !== undefined && references.some((reference) => pixelDistance(shown, reference) <= range)
    })
  )
}

export const connectorHits = (frame: SnapFrame): ReadonlyArray<SnapHit> => {
  const range = rangeOf(frame.config, "connectors")
  const measured = measuredBases(frame).filter(({ base }) => base.end !== undefined)
  const near = itemsNear(frame, measured.map(({ reference }) => reference), range)
  const { matchRotation } = frame.config.targets.connectors
  return measured.flatMap((one) =>
    near.flatMap((item) =>
      item.ends.flatMap((other) => {
        const own = one.base.end
        // an end joins what it is turned toward, within a right angle: the trailing end of a piece going past isn't
        // turned round to meet what the leading end just left
        if (own === undefined || vecDot(own.forward, other.forward) > 0) return []
        const meeting = meetingOf(frame, own, other)
        if (meeting === undefined) return []
        const marks: ReadonlyArray<SnapMark> = [{ kind: "ring", role: "target", at: other.position }]
        const spot: Spot = { at: other.position, label: `End of ${item.name}`, relation: "join", marks, item: item.key }
        return pointHit(frame, "connectors", one, spot, range).map((hit): SnapHit => ({
          ...hit,
          meeting,
          ...(matchRotation && { rotation: meetingTurn(own, other) })
        }))
      })
    )
  )
}

const AXIS_NAMES = ["x", "y", "z"] as const

/** How near a tracking line can run to a line the move is held to and say nothing: within a degree. */
const ALONG_THE_MOVE = Math.cos(Math.PI / 180)

/** Lines through acquired points along the grid's axes, and where they cross. */
export const trackingHits = (frame: SnapFrame): ReadonlyArray<SnapHit> => {
  const range = rangeOf(frame.config, "tracking")
  const axes = gridAxes(frame.config)
  const { constraint, tracked } = frame
  // through a point on the move's own line, such a line is met all the way along it
  const alongTheMove = (direction: Vec3) =>
    constraint.kind === "line" && Math.abs(vecDot(direction, constraint.direction)) >= ALONG_THE_MOVE
  return measuredBases(frame).flatMap((one) => {
    const { base, reference } = one
    const ray = frame.view.rayAt(reference)
    const free = freePoint(frame, base)
    const lines = tracked.flatMap((point) =>
      axes.flatMap((direction, i): ReadonlyArray<SnapHit> => {
        if (alongTheMove(direction)) return []
        const landing = lineNearRay(point.at, direction, ray)
        const shown = landing === undefined ? undefined : frame.view.project(landing)
        if (landing === undefined || shown === undefined) return []
        const distance = pixelDistance(shown, reference)
        const axis = AXIS_NAMES[i] ?? "x"
        if (distance > range) return []
        return [{
          target: "tracking",
          rank: 1,
          distance,
          base,
          landing,
          label: `In line with ${point.label}`,
          relation: "inLine",
          marks: [{ kind: "tracking", from: point.at, to: landing, axis }],
          source: sourceOf(frame.box, base),
          held: { shape: "line", origin: point.at, direction }
        }]
      })
    )
    const seen = (at: Vec3, label: string, relation: SnapRelation, marks: ReadonlyArray<SnapMark>) =>
      pointHit(frame, "tracking", one, { at, label, relation, marks }, range)
    // A pair of lines crosses where each keeps its own axes' values. On a plane the third value is the plane's.
    const planeNormal = constraint.kind === "line" ? undefined : constraint.normal
    const crossings = tracked.flatMap((a, ai) =>
      tracked.slice(ai + 1).flatMap((b) =>
        [0, 1, 2].flatMap((i) =>
          [0, 1, 2].flatMap((j) => {
            const [di, dj] = [axes[i], axes[j]]
            const k = 3 - i - j
            const dk = axes[k]
            if (i === j || di === undefined || dj === undefined || dk === undefined) return []
            const level = Math.abs(vecDot(vecSub(a.at, b.at), dk)) < 0.01
            const onPlane = planeNormal !== undefined && Math.abs(vecDot(planeNormal, dk)) > 0.999
            if (!level && !onPlane) return []
            const third = level ? vecDot(a.at, dk) : vecDot(free, dk)
            const at = vecAdd(
              vecAdd(vecScale(di, vecDot(b.at, di)), vecScale(dj, vecDot(a.at, dj))),
              vecScale(dk, third)
            )
            return seen(at, `Crossing of ${a.label} and ${b.label}`, "intersection", [
              { kind: "tracking", from: a.at, to: at, axis: AXIS_NAMES[i] ?? "x" },
              { kind: "tracking", from: b.at, to: at, axis: AXIS_NAMES[j] ?? "x" }
            ])
          })
        )
      )
    )
    const alongView = tracked.flatMap((point) => {
      const direction = frame.view.directionAt(point.at)
      const at = vecAdd(point.at, vecScale(direction, vecDot(vecSub(free, point.at), direction)))
      const shown = frame.view.project(point.at)
      if (alongTheMove(direction) || shown === undefined || pixelDistance(shown, reference) > range) return []
      const marks = [{ kind: "tracking" as const, from: point.at, to: at, axis: "view" as const }]
      return seen(at, `In line with ${point.label}`, "inLine", marks).map(
        (hit) => ({ ...hit, distance: pixelDistance(shown, reference) })
      )
    })
    return [...lines, ...crossings, ...alongView]
  })
}

const planeHits = (
  frame: SnapFrame,
  plane: ConstructionPlane,
  { base, reference }: { readonly base: BasePoint; readonly reference: ScreenPoint },
  range: number
): ReadonlyArray<SnapHit> => {
  const free = freePoint(frame, base)
  const off = vecDot(vecSub(free, plane.origin), plane.normal)
  const onto = vecSub(free, vecScale(plane.normal, off))
  const { u, v } = inPlane(onto, plane)
  if (Math.abs(u) > plane.extent || Math.abs(v) > plane.extent) return []
  const y = vecCross(plane.normal, plane.xAxis)
  const landing = plane.grid
    ? vecAdd(
      vecAdd(plane.origin, vecScale(plane.xAxis, snapValue(u, frame.config.gridSize))),
      vecScale(y, snapValue(v, frame.config.gridSize))
    )
    : onto
  const [shown, from] = [frame.view.project(onto), frame.view.project(free)]
  if (shown === undefined || from === undefined) return []
  const distance = pixelDistance(shown, { x: from.x + (reference.x - from.x), y: from.y + (reference.y - from.y) })
  if (distance > range) return []
  const corner = (a: number, b: number) =>
    vecAdd(vecAdd(plane.origin, vecScale(plane.xAxis, a * plane.extent)), vecScale(y, b * plane.extent))
  return [{
    target: "construction",
    rank: 2,
    distance,
    base,
    landing,
    label: `Plane: ${plane.name}`,
    relation: "onFace",
    marks: [{ kind: "face", role: "target", corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] }],
    source: sourceOf(frame.box, base),
    held: { shape: "plane", origin: plane.origin, normal: plane.normal }
  }]
}

const axisHits = (
  frame: SnapFrame,
  axis: ConstructionAxis,
  { base, reference }: { readonly base: BasePoint; readonly reference: ScreenPoint },
  range: number
): ReadonlyArray<SnapHit> => {
  const landing = lineNearRay(axis.origin, axis.direction, frame.view.rayAt(reference))
  const shown = landing === undefined ? undefined : frame.view.project(landing)
  if (landing === undefined || shown === undefined) return []
  const distance = pixelDistance(shown, reference)
  if (distance > range) return []
  const end = (sign: number) => vecAdd(axis.origin, vecScale(axis.direction, sign * axis.extent))
  return [{
    target: "construction",
    rank: 1,
    distance,
    base,
    landing,
    label: `Axis: ${axis.name}`,
    relation: "onEdge",
    marks: [{ kind: "line", role: "target", from: end(-1), to: end(1) }],
    source: sourceOf(frame.box, base),
    held: { shape: "line", origin: axis.origin, direction: axis.direction }
  }]
}

/** Where an axis crosses a plane; undefined when it runs along it. */
const crossingOf = (axis: ConstructionAxis, plane: ConstructionPlane): Vec3 | undefined => {
  const facing = vecDot(axis.direction, plane.normal)
  if (Math.abs(facing) < 1e-6) return undefined
  const t = vecDot(vecSub(plane.origin, axis.origin), plane.normal) / facing
  return vecAdd(axis.origin, vecScale(axis.direction, t))
}

export const constructionHits = (frame: SnapFrame): ReadonlyArray<SnapHit> => {
  const range = rangeOf(frame.config, "construction")
  const planes = frame.construction.filter((one) => one.kind === "plane")
  const axes = frame.construction.filter((one) => one.kind === "axis")
  return measuredBases(frame).flatMap((one) => [
    ...planes.flatMap((plane) => planeHits(frame, plane, one, range)),
    ...axes.flatMap((axis) => axisHits(frame, axis, one, range)),
    ...axes.flatMap((axis) =>
      planes.flatMap((plane) => {
        const at = crossingOf(axis, plane)
        const label = `Crossing of ${axis.name} and ${plane.name}`
        return at === undefined
          ? []
          : pointHit(frame, "construction", one, { at, label, relation: "intersection" }, range)
      })
    ),
    ...frame.measurements.flatMap(({ a, b }) =>
      [a, b].flatMap((at) => pointHit(frame, "construction", one, { at, label: "End of a measurement" }, range))
    )
  ])
}
