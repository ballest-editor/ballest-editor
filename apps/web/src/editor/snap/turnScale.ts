/**
 * What a turn and a scale can meet (docs/SNAPPING.md § Affect), worked out once when the drag starts: nothing else moves
 * until it ends. A turn stops where the selection first touches a neighbour, comes flush with one of its faces, lines its
 * axes up with a neighbour's or the grid's, or brings an end onto an end; a scale stops the scaled face on a face of a
 * neighbour in its way.
 */
import type { WorldEnd } from "../../domain/connectors"
import type { Quat4, UeTransform, Vec3 } from "../../domain/coords"
import type { Box } from "../../domain/itemBounds"
import { type MeshFace, runMidpoints } from "../../domain/meshElements"
import { localToWorld } from "../../domain/pivot"
import { priorityOf, type SnapConfig, type SnapTarget } from "../../domain/snapConfig"
import { axesOf, type MarkRole, type SnapItem, type SnapMark } from "../../domain/snapFrame"
import { gridAxes } from "../../domain/snapGrid"
import { glyphMark, shiftedMarks, sideOf } from "../../domain/snapRelation"
import {
  alignedTurns,
  type Body,
  firstContacts,
  type ScaleStop,
  turnedAbout,
  turnOnto,
  type TurnStop,
  turnStopsInOrder
} from "../../domain/snapRotate"
import {
  quatFromAxisAngle,
  rotateVec,
  vecAdd,
  vecDistance,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub
} from "../../domain/ueMath"

/** Each face of an item's box: where it is and which way it faces. */
const boundsFacesOf = ({ bounds, transform }: SnapItem): ReadonlyArray<MeshFace> => {
  if (bounds === undefined) return []
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const middle = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }
  const face = (point: Vec3, normal: Vec3) => ({
    centre: localToWorld(transform, point),
    normal: rotateVec(transform.rotation, normal),
    corners: cornersOf(transform, bounds, normal)
  })
  return [
    face({ ...middle, x: x1 }, { x: 1, y: 0, z: 0 }),
    face({ ...middle, x: x0 }, { x: -1, y: 0, z: 0 }),
    face({ ...middle, y: y1 }, { x: 0, y: 1, z: 0 }),
    face({ ...middle, y: y0 }, { x: 0, y: -1, z: 0 }),
    face({ ...middle, z: z1 }, { x: 0, y: 0, z: 1 }),
    face({ ...middle, z: z0 }, { x: 0, y: 0, z: -1 })
  ]
}

/** The four corners of the face of local `bounds` that looks along the unit axis `normal`. */
const cornersOf = (
  transform: UeTransform,
  { max, min }: NonNullable<SnapItem["bounds"]>,
  normal: Vec3
): ReadonlyArray<Vec3> => {
  const pick = (i: 0 | 1 | 2, n: number, other: number) =>
    n !== 0 ? (n > 0 ? max[i] : min[i]) : other === 0 ? min[i] : max[i]
  const quad = [[0, 0], [1, 0], [1, 1], [0, 1]] as const
  return quad.map(([a, b]) => {
    const point = normal.x !== 0
      ? { x: pick(0, normal.x, 0), y: a === 0 ? min[1] : max[1], z: b === 0 ? min[2] : max[2] }
      : normal.y !== 0
      ? { x: a === 0 ? min[0] : max[0], y: pick(1, normal.y, 0), z: b === 0 ? min[2] : max[2] }
      : { x: a === 0 ? min[0] : max[0], y: b === 0 ? min[1] : max[1], z: pick(2, normal.z, 0) }
    return localToWorld(transform, point)
  })
}

const touches = (a: Box, b: Box, by: number) =>
  a.min.x - by <= b.max.x && a.max.x + by >= b.min.x &&
  a.min.y - by <= b.max.y && a.max.y + by >= b.min.y &&
  a.min.z - by <= b.max.z && a.max.z + by >= b.min.z

/** How near, in cm, a point must come to a face to touch it, and a face to a plane to be flush. */
const TOUCH_CM = 1
/** A mesh with more corners than this meets with its box's instead, to keep a drag's start quick. */
const MAX_POINTS = 512
const LETTERS = ["X", "Y", "Z"] as const
const X: Vec3 = { x: 1, y: 0, z: 0 }
const BASIS: ReadonlyArray<Vec3> = [X, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]

/** The corners of an item's box and the middles of its edges. */
const boundsPointsOf = ({ bounds, transform }: SnapItem): ReadonlyArray<Vec3> => {
  if (bounds === undefined) return []
  const [xs, ys, zs] = ([0, 1, 2] as const).map((
    i
  ) => [bounds.min[i], (bounds.min[i] + bounds.max[i]) / 2, bounds.max[i]])
  return (xs ?? []).flatMap((x, i) =>
    (ys ?? []).flatMap((y, j) =>
      (zs ?? []).flatMap((z, k) =>
        // a corner is at no axis's middle, and an edge's middle at one
        [i, j, k].filter((n) => n === 1).length <= 1 ? [localToWorld(transform, { x, y, z })] : []
      )
    )
  )
}

/** What an item meets with: its mesh's corners and edge middles once it has loaded, else its box's, and its faces. */
const bodyOf = (item: SnapItem): Body => {
  const mesh = item.mesh()
  const points = mesh === undefined ? [] : [...mesh.vertices, ...runMidpoints(mesh)]
  return {
    points: points.length > 0 && points.length <= MAX_POINTS ? points : boundsPointsOf(item),
    faces: item.faces() ?? boundsFacesOf(item)
  }
}

const faceMark = ({ corners }: Pick<MeshFace, "corners">, role: MarkRole): SnapMark => ({ kind: "face", role, corners })

/** A line through `at` along the unit `direction`, `half` cm each way. */
const lineMark = (at: Vec3, direction: Vec3, half: number, role: MarkRole): SnapMark => ({
  kind: "line",
  role,
  from: vecSub(at, vecScale(direction, half)),
  to: vecAdd(at, vecScale(direction, half))
})

const centreOf = ({ max, min }: Box): Vec3 => vecScale(vecAdd(min, max), 0.5)

export interface TurnStart {
  /** The unit axis the turn is about, and the point it turns about. */
  readonly axis: Vec3
  readonly pivot: Vec3
  /** The active unit's axes. */
  readonly rotation: Quat4
  /** The items that lead the turn, and their ends. */
  readonly own: ReadonlyArray<SnapItem>
  readonly ends: ReadonlyArray<WorldEnd>
}

/** How far `moving`'s points stand off the line along the unit `axis` through `pivot`. */
const sweepOf = (moving: Body, axis: Vec3, pivot: Vec3) =>
  Math.max(
    0,
    ...moving.points.map((point) => {
      const out = vecSub(point, pivot)
      return vecLength(vecSub(out, vecScale(axis, vecDot(out, axis))))
    })
  )

/**
 * Everything a turn could stop on, from every target, on or off (a held key can turn one on mid-drag, so the sample
 * picks by `from`): with each neighbour the turn can reach, Mesh's first touch each way and its faces coming flush, and
 * Alignment's axes lining up, as far each way as the turn goes before it would be inside that neighbour; Connectors'
 * ends meeting ends within `rangeCm`; and the Grid's axes. Every stop carries both sides where it puts them and its glyph.
 */
export const allTurnStopsOf = (
  config: SnapConfig,
  { axis, ends, own, pivot, rotation }: TurnStart,
  items: ReadonlyArray<SnapItem>,
  rangeCm: number
): ReadonlyArray<TurnStop> => {
  const bodies = own.map(bodyOf)
  const moving: Body = { points: bodies.flatMap(({ points }) => points), faces: bodies.flatMap(({ faces }) => faces) }
  const sweep = sweepOf(moving, axis, pivot)
  const swept: Box = {
    min: vecSub(pivot, { x: sweep, y: sweep, z: sweep }),
    max: vecAdd(pivot, { x: sweep, y: sweep, z: sweep })
  }
  const ownAxes = BASIS.map((basis) => rotateVec(rotation, basis))
  const ownLine = (angle: number, i: number) =>
    lineMark(pivot, rotateVec(quatFromAxisAngle(axis, angle), ownAxes[i] ?? X), Math.max(sweep, 100), "source")
  const stops = items.filter((item) => touches(swept, item.box, sweep + rangeCm)).flatMap((item) => {
    const still = bodyOf(item)
    const { ahead, behind } = firstContacts({ axis, pivot, moving, still, tolerance: TOUCH_CM })
    // past its first touch each way the selection would be inside the neighbour
    const reachable = (angle: number) => angle >= (behind?.angle ?? -Math.PI) && angle <= (ahead?.angle ?? Math.PI)
    const touching = [ahead, behind].flatMap((contact): ReadonlyArray<TurnStop> =>
      contact === undefined ? [] : [{
        angle: contact.angle,
        kind: "touch",
        from: "mesh",
        relation: "onFace",
        label: `Touching ${item.name}`,
        marks: [
          faceMark(contact.face, "target"),
          { kind: "dot", role: "source", at: contact.at },
          glyphMark("onFace", contact.at)
        ]
      }]
    )
    const flush = moving.faces.flatMap((face) =>
      still.faces.flatMap((other) =>
        [vecScale(other.normal, -1), other.normal].flatMap((onto): ReadonlyArray<TurnStop> => {
          const angle = turnOnto(face.normal, onto, axis)
          if (angle === undefined || !reachable(angle)) return []
          const turn = turnedAbout(pivot, axis, angle)
          if (Math.abs(vecDot(vecSub(turn(face.centre), other.centre), other.normal)) > TOUCH_CM) return []
          return [{
            angle,
            kind: "flush",
            from: "mesh",
            relation: "flush",
            label: `Flush with ${item.name}`,
            marks: [
              faceMark(other, "target"),
              faceMark({ corners: face.corners.map(turn) }, "source"),
              glyphMark("flush", other.centre)
            ]
          }]
        })
      )
    )
    const otherAxes = BASIS.map((basis) => rotateVec(item.transform.rotation, basis))
    const aligned = alignedTurns(ownAxes, otherAxes, axis).flatMap((
      { angle, pair: [i, j], same }
    ): ReadonlyArray<TurnStop> =>
      reachable(angle)
        ? [{
          angle,
          kind: "aligned",
          from: "alignment",
          relation: "aligned",
          label: same.length > 0
            ? `Aligned with ${item.name} on ${same.map((n) => LETTERS[n]).join(" and ")}`
            : `Square to ${item.name}`,
          marks: [
            ownLine(angle, i),
            lineMark(centreOf(item.box), otherAxes[j] ?? X, vecDistance(item.box.min, item.box.max) / 2, "target"),
            glyphMark("aligned", centreOf(item.box))
          ]
        }]
        : []
    )
    const meetings = ends.flatMap((end) =>
      item.ends.flatMap((other): ReadonlyArray<TurnStop> => {
        const angle = turnOnto(end.forward, vecScale(other.forward, -1), axis)
        if (angle === undefined) return []
        const turn = turnedAbout(pivot, axis, angle)
        if (vecDistance(turn(end.position), other.position) > rangeCm) return []
        return [{
          angle,
          kind: "end",
          from: "connectors",
          relation: "join",
          label: `End of ${item.name}`,
          marks: [
            { kind: "ring", role: "target", at: other.position },
            { kind: "ring", role: "source", at: turn(end.position) },
            glyphMark("join", other.position)
          ]
        }]
      })
    )
    return [...meetings, ...flush, ...touching, ...aligned]
  })
  const gridLines = gridAxes(config)
  const square = alignedTurns(ownAxes, gridLines, axis).map(({ angle, pair: [i, j] }): TurnStop => ({
    angle,
    kind: "grid",
    from: "grid",
    relation: "grid",
    label: "Square to the grid",
    marks: [
      ownLine(angle, i),
      lineMark(pivot, gridLines[j] ?? X, Math.max(sweep, 100) * 2, "target"),
      glyphMark("grid", pivot)
    ]
  }))
  return [...stops, ...square]
}

/** The stops of `allTurnStopsOf` from the targets `targets`, in order round the turn. */
export const turnStopsFrom = (
  stops: ReadonlyArray<TurnStop>,
  targets: ReadonlyArray<SnapTarget>
): ReadonlyArray<TurnStop> => turnStopsInOrder(stops.filter((stop) => targets.includes(stop.from)))

/** Where a turn can stop under `config` as it stands: `allTurnStopsOf` kept to the targets that are on. */
export const turnStopsOf = (
  config: SnapConfig,
  start: TurnStart,
  items: ReadonlyArray<SnapItem>,
  rangeCm: number
): ReadonlyArray<TurnStop> => turnStopsFrom(allTurnStopsOf(config, start, items, rangeCm), priorityOf(config))

/** Where `box` lies along the unit `axis`, from the origin. */
const spanOf = ({ max, min }: Box, axis: Vec3): readonly [number, number] => {
  const along = [min.x, max.x].flatMap((x) =>
    [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => vecDot({ x, y, z }, axis)))
  )
  return [Math.min(...along), Math.max(...along)]
}

/** Whether `box` stands in the way of `from` along the unit `axis`, either way. Off the world's axes it can pass by a little. */
const inWayOf = (from: Box, box: Box, axis: Vec3) =>
  axesOf({ kind: "plane", normal: axis }).every((across) => {
    const [[a0, a1], [b0, b1]] = [spanOf(from, across), spanOf(box, across)]
    return a0 <= b1 && b0 <= a1
  })

/**
 * The faces square to `axis` of the `items` in the way of `box`, the selection's, as stops at their distance from
 * `pivotPoint`: a mesh's own, or its box's until it has loaded. A scale can reach anywhere along the axis, so the box test
 * comes first: placing every mesh in the map would stall the drag's start.
 */
export const scaleStopsOf = (
  axis: Vec3,
  pivotPoint: Vec3,
  box: Box,
  items: ReadonlyArray<SnapItem>
): ReadonlyArray<ScaleStop> => {
  // the scaled face, which a stop carries from where it reaches now to the stop
  const scaled = sideOf(box, axis, "source")
  const reach = reachAlong(box, pivotPoint, axis)
  return items.filter((item) => inWayOf(box, item.box, axis)).flatMap((item) =>
    (item.faces() ?? boundsFacesOf(item)).flatMap((face): ReadonlyArray<ScaleStop> => {
      if (Math.abs(vecDot(face.normal, axis)) < 0.999) return []
      const at = vecDot(vecSub(face.centre, pivotPoint), axis)
      return [{
        at,
        label: `Face of ${item.name}`,
        relation: "flush",
        marks: [
          { kind: "face", role: "target", corners: face.corners },
          ...shiftedMarks([scaled], vecScale(axis, at - reach)),
          glyphMark("flush", face.centre)
        ]
      }]
    })
  )
}

/** How far `box` reaches from `pivotPoint` along the unit `axis`, on the side that axis points to. */
export const reachAlong = (box: Box, pivotPoint: Vec3, axis: Vec3): number => {
  const unit = vecNormalize(axis)
  return spanOf(box, unit)[1] - vecDot(pivotPoint, unit)
}
