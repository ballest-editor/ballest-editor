/**
 * What Rotate and Scale snap to (docs/SNAPPING.md § Affect). A turn stops where the selection first touches a
 * neighbour, where one of its faces comes flush with one of theirs, where an end meets an end, and where its axes line
 * up with a neighbour's or the grid's; it gets there and goes on as a move does, and between stops it takes the step. A
 * scale stops the scaled face on a face in range, over the step.
 */
import type { Vec3 } from "./coords"
import type { MeshFace } from "./meshElements"
import { snapValue } from "./snap"
import type { SnapMark, SnapRelation } from "./snapFrame"
import { quatFromAxisAngle, rotateVec, vecAdd, vecCross, vecDot, vecLength, vecScale, vecSub } from "./ueMath"

/** What a turn can stop on, the most particular first: of stops at one angle, the first kind names it. */
export const TURN_STOP_KINDS = ["end", "flush", "touch", "aligned", "grid"] as const
export type TurnStopKind = (typeof TURN_STOP_KINDS)[number]

export interface TurnStop {
  /** Radians about the turn's axis from where the turn started, in (-π, π]. */
  readonly angle: number
  readonly kind: TurnStopKind
  readonly label: string
  readonly relation: SnapRelation
  /** The target that offers it, so a held key can leave it out. */
  readonly from: "connectors" | "mesh" | "alignment" | "grid"
  /** Both sides where the stop puts them, and the glyph (docs/SNAPPING.md § Snap indications). */
  readonly marks: ReadonlyArray<SnapMark>
}

/** A turn or scale as it snapped, for the label: what to say and the glyph to say it with. */
export interface SnappedAs {
  readonly label?: string
  readonly relation?: SnapRelation
  /** Both sides, the source where the snap puts it, and the glyph. */
  readonly marks?: ReadonlyArray<SnapMark>
}

const TAU = Math.PI * 2

/** `angle` as the same turn in (-π, π]. */
export const wrapAngle = (angle: number): number => angle - TAU * Math.ceil((angle - Math.PI) / TAU)

/** How far out of the turn's plane two directions can be and still meet. */
const LEVEL = 1e-3

/** Two stops closer than this, in radians, are one. */
const SAME_ANGLE = 1e-4

const flattened = (v: Vec3, axis: Vec3) => vecSub(v, vecScale(axis, vecDot(v, axis)))

/** The turn about the unit `axis` that takes the unit `from` onto the unit `to`, in (-π, π]; undefined when none can. */
export const turnOnto = (from: Vec3, to: Vec3, axis: Vec3): number | undefined => {
  if (Math.abs(vecDot(from, axis) - vecDot(to, axis)) > LEVEL) return undefined
  const a = flattened(from, axis)
  const b = flattened(to, axis)
  if (vecLength(a) < LEVEL || vecLength(b) < LEVEL) return undefined
  return wrapAngle(Math.atan2(vecDot(vecCross(a, b), axis), vecDot(a, b)))
}

/** Where `point` goes in a turn of `angle` about the unit `axis` through `pivot`. */
export const turnedAbout = (pivot: Vec3, axis: Vec3, angle: number) => {
  const rotation = quatFromAxisAngle(axis, angle)
  return (point: Vec3): Vec3 => vecAdd(pivot, rotateVec(rotation, vecSub(point, pivot)))
}

/** What a body offers a contact: the points it meets with (corners, edge middles) and its flat faces. */
export interface Body {
  readonly points: ReadonlyArray<Vec3>
  readonly faces: ReadonlyArray<MeshFace>
}

/** Where a turning body first meets a still one. */
export interface Contact {
  /** Radians: 0 when it touches at the start and the turn takes it in. */
  readonly angle: number
  /** The point they meet at, once turned. */
  readonly at: Vec3
  /** The face that point meets, once turned. */
  readonly face: MeshFace
}

/** Whether `point` on the plane of `face` lies inside its corners, which go round either way, give or take `tolerance` cm. */
const onFace = (point: Vec3, { corners, normal }: MeshFace, tolerance: number) => {
  const sides = corners.map((from, i) => {
    const edge = vecSub(corners[(i + 1) % corners.length] ?? from, from)
    const length = vecLength(edge)
    return length < 1e-9 ? 0 : vecDot(vecCross(edge, vecSub(point, from)), normal) / length
  })
  return sides.every((side) => side >= -tolerance) || sides.every((side) => side <= tolerance)
}

/**
 * The first turns, one each way within half a turn, at which `point` turning about the unit `axis` through `pivot`
 * reaches the plane of `face` from in front of it. A point on the plane at the start, within `tolerance` cm, reaches it
 * at once the way that takes it behind; one behind it reaches nothing.
 */
const planeCrossings = (
  point: Vec3,
  { centre, normal }: MeshFace,
  axis: Vec3,
  pivot: Vec3,
  tolerance: number
): readonly [number | undefined, number | undefined] => {
  const out = vecSub(point, pivot)
  const along = vecScale(axis, vecDot(out, axis))
  const across = vecSub(out, along)
  // how far in front of the plane the point is at a turn of t: k + a cos t + b sin t
  const k = vecDot(normal, vecSub(vecAdd(pivot, along), centre))
  const a = vecDot(normal, across)
  const b = vecDot(normal, vecCross(axis, across))
  if (Math.abs(k + a) <= tolerance) return [b < -1e-9 ? 0 : undefined, b > 1e-9 ? 0 : undefined]
  const radius = Math.hypot(a, b)
  if (k + a < 0 || radius < 1e-9 || Math.abs(k) > radius) return [undefined, undefined]
  const phase = Math.atan2(b, a)
  const half = Math.acos(-k / radius)
  const roots = [phase + half, phase - half].map((root) => ((root % TAU) + TAU) % TAU)
  const ahead = Math.min(...roots)
  const behind = Math.max(...roots) - TAU
  return [ahead <= Math.PI ? ahead : undefined, behind >= -Math.PI ? behind : undefined]
}

/** How far a turn goes, in radians, to see which way a point that touches at the start goes. */
const PROBE = 1e-2

/**
 * Where `moving`, turning about the unit `axis` through `pivot`, first meets `still`, each way round: one's point
 * reaching the other's face, within `tolerance` cm. Where it already touches and the turn would take it in, that way
 * meets at once, at 0.
 */
export const firstContacts = (
  { axis, moving, pivot, still, tolerance }: {
    readonly axis: Vec3
    readonly pivot: Vec3
    readonly moving: Body
    readonly still: Body
    readonly tolerance: number
  }
): { readonly ahead?: Contact; readonly behind?: Contact } => {
  const found: Array<Contact & { readonly way: 0 | 1 }> = []
  // the moving body's points onto the still faces, and the still points onto the moving faces, which is the same turn
  // the other way about
  const meet = (points: ReadonlyArray<Vec3>, faces: ReadonlyArray<MeshFace>, sense: 1 | -1) => {
    const about = vecScale(axis, sense)
    for (const face of faces) {
      for (const point of points) {
        planeCrossings(point, face, about, pivot, tolerance).forEach((angle, way) => {
          if (angle === undefined) return
          const at = turnedAbout(pivot, about, angle)(point)
          // touching at the start, it goes in only if a little more turn keeps it on the face, not off its edge
          const inside = angle === 0
            ? onFace(turnedAbout(pivot, about, way === 0 ? PROBE : -PROBE)(point), face, 1e-6)
            : onFace(at, face, tolerance)
          if (!inside) return
          const turn = turnedAbout(pivot, axis, angle)
          const contact = sense === 1
            ? { angle, at, face }
            : { angle, at: point, face: { ...face, centre: turn(face.centre), corners: face.corners.map(turn) } }
          found.push({ ...contact, way: way === 0 ? 0 : 1 })
        })
      }
    }
  }
  meet(moving.points, still.faces, 1)
  meet(still.points, moving.faces, -1)
  const first = (way: 0 | 1) => {
    const one = found.filter((contact) => contact.way === way).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))[0]
    return one === undefined ? undefined : { angle: one.angle, at: one.at, face: one.face }
  }
  const ahead = first(0)
  const behind = first(1)
  return { ...(ahead !== undefined && { ahead }), ...(behind !== undefined && { behind }) }
}

/** An axis this close to the turn's own hardly moves, and lines up with nothing. */
const AXIS_ACROSS = 0.2

/**
 * The turns about the unit `axis` that lay one of the unit axes `own` along one of `other`'s, either way, each with the
 * indices of `own` that lie along the axis of the same index in `other`.
 */
export const alignedTurns = (
  own: ReadonlyArray<Vec3>,
  other: ReadonlyArray<Vec3>,
  axis: Vec3
): ReadonlyArray<
  { readonly angle: number; readonly same: ReadonlyArray<number>; readonly pair: readonly [number, number] }
> => {
  const found: Array<{ angle: number; same: Array<number>; pair: readonly [number, number] }> = []
  own.forEach((from, i) => {
    if (vecLength(flattened(from, axis)) < AXIS_ACROSS) return
    other.forEach((to, j) => {
      for (const onto of [to, vecScale(to, -1)]) {
        const angle = turnOnto(from, onto, axis)
        if (angle === undefined) continue
        const at = found.find((one) => Math.abs(wrapAngle(one.angle - angle)) < SAME_ANGLE)
        if (at === undefined) found.push({ angle, same: i === j ? [i] : [], pair: [i, j] })
        else if (i === j && !at.same.includes(i)) at.same.push(i)
      }
    })
  })
  return found
}

/** `stops` in order round the turn, one at each angle: the most particular kind there. */
export const turnStopsInOrder = (stops: ReadonlyArray<TurnStop>): ReadonlyArray<TurnStop> => {
  const rank = (stop: TurnStop) => TURN_STOP_KINDS.indexOf(stop.kind)
  const byRank = stops.toSorted((a, b) => rank(a) - rank(b))
  return byRank
    .filter((stop, i) =>
      byRank.slice(0, i).every((before) => Math.abs(wrapAngle(before.angle - stop.angle)) >= SAME_ANGLE)
    )
    .toSorted((a, b) => a.angle - b.angle)
}

/**
 * How far past a stop, in radians, the pointer can go and still hold the turn there, and how near ahead of it counts
 * as reaching it: `threshold` pixels and one, along the ring of `ringPx` the turn is dragged by.
 */
export const turnReach = (threshold: number, ringPx: number): { readonly reach: number; readonly nudge: number } => ({
  reach: threshold / Math.max(ringPx, 1),
  nudge: 1 / Math.max(ringPx, 1)
})

export interface TurnLanding {
  /** Radians. */
  readonly angle: number
  /** The stop it is on. */
  readonly on: TurnStop | undefined
}

/**
 * Where a turn the pointer has put at `free` radians lands, coming from `from` (the last sample's free angle) and on
 * the stop `on`, as a move gets to a target (docs/SNAPPING.md § Getting to a target): a stop is reached when the turn
 * crosses it or comes within `nudge` of it, and holds while the pointer is within `reach` past it, or while `hold` is
 * down. A sample that has gone past by more than `reach` went through it. Off any stop, the step in degrees.
 */
export const turnLanding = (
  { free, from, hold = false, nudge, on, reach, step, stops }: {
    readonly free: number
    readonly from: number
    readonly on: TurnStop | undefined
    readonly stops: ReadonlyArray<TurnStop>
    readonly reach: number
    readonly nudge: number
    readonly hold?: boolean
    readonly step?: number | undefined
  }
): TurnLanding => {
  if (on !== undefined && (hold || Math.abs(wrapAngle(free - on.angle)) <= reach)) return { angle: on.angle, on }
  const moved = wrapAngle(free - from)
  const ahead = (stop: TurnStop) => wrapAngle(stop.angle - from)
  const reached = stops.filter((stop) => {
    const to = ahead(stop)
    const crossed = moved > 0 ? to > 0 && to <= moved + nudge : moved < 0 && to < 0 && to >= moved - nudge
    return crossed && Math.abs(wrapAngle(free - stop.angle)) <= reach
  })
  const first = reached.toSorted((a, b) => Math.abs(ahead(a)) - Math.abs(ahead(b)))[0]
  if (first !== undefined) return { angle: first.angle, on: first }
  return { angle: step === undefined ? free : snapValue(free * 180 / Math.PI, step) * Math.PI / 180, on: undefined }
}

/** A plane the scaled face can stop on, at `at` cm from the pivot along the axis. */
export interface ScaleStop {
  readonly at: number
  readonly label: string
  readonly relation: SnapRelation
  /** The target face, the scaled face stopped on it, and the glyph. */
  readonly marks: ReadonlyArray<SnapMark>
}

export interface SnappedScale extends SnappedAs {
  /** What to multiply the scale by. */
  readonly factor: number
}

/**
 * Where a scale of `free` from `from` lands. With a `face`, `reach` is how far the scaled face stands from the pivot at
 * scale 1 and `range` the cm that count as in range: a stop near where the face now is wins. Else the step, in percent,
 * along the item's own axis; never nothing, which the game can't hold.
 */
export const snappedScale = (
  { face, free, from, step, stops = [] }: {
    readonly from: number
    readonly free: number
    readonly step?: number | undefined
    readonly face?: { readonly reach: number; readonly range: number } | undefined
    readonly stops?: ReadonlyArray<ScaleStop>
  }
): SnappedScale => {
  if (face !== undefined) {
    const now = face.reach * free
    const near = stops
      .filter(({ at }) => Math.abs(at - now) <= face.range)
      .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0]
    if (near !== undefined) {
      return { factor: near.at / face.reach / from, label: near.label, relation: near.relation, marks: near.marks }
    }
  }
  if (step === undefined) return { factor: free / from }
  const size = step / 100
  const landed = snapValue(free, size)
  const held = landed === 0 ? (free < 0 ? -size : size) : landed
  return { factor: held / from }
}
