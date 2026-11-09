/**
 * How a drag takes a target (docs/SNAPPING.md § What a drag looks like): snap-and-go. Nothing reaches out for the
 * selection on its way to a target. It stops once the move gets there, and it stays while the target's still in range,
 * which is how far past it the pointer goes before the selection is free again. The Grid isn't one of these: it's a
 * rounding of every position, not somewhere to get to.
 */
import type { Vec3 } from "./coords"
import { rangeOf } from "./snapConfig"
import {
  type BasePoint,
  constrained,
  freePoint,
  type HeldShape,
  landingOn,
  landingUnder,
  pixelDistance,
  type ScreenPoint,
  type SnapFrame,
  type SnapHit
} from "./snapFrame"
import { vecAdd, vecDistance, vecDot, vecSub } from "./ueMath"

/** Where a drag has been: what the last sample moved to, and the target it was on. */
export interface DragPath {
  /** The free move at the last sample. */
  readonly from: Vec3
  readonly current: SnapHit | undefined
}

/** The pixels short of a target that count as there, as a pointer moves by whole ones. */
const THERE_PX = 1

/** Within this on screen, a hit is under the base and has nothing to jump across. */
const UNDER_PX = 0.5

/** How far to the side of a point a move can pass and still stop on it, as a share of its range. */
const PASSING_SHARE = 1 / 3

const passingRange = (frame: SnapFrame, { target }: SnapHit) => rangeOf(frame.config, target) * PASSING_SHARE

/** What counts as one place, in cm. */
const SAME_CM = 1e-3

/** `ahead` is how far a target lay before the sample, and `left` after it, negative once past. */
const gotThere = (ahead: number, left: number) => ahead > 0 && left < ahead && left <= THERE_PX

const minus = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: a.x - b.x, y: a.y - b.y })

const dot = (a: ScreenPoint, b: ScreenPoint) => a.x * b.x + a.y * b.y

/** Whether a move from `before` to `now` went past `point`, close enough by: it can't often go through the very pixel. */
const passed = (before: ScreenPoint, now: ScreenPoint, point: ScreenPoint, aside: number): boolean => {
  const length = pixelDistance(before, now)
  const along = { x: (now.x - before.x) / length, y: (now.y - before.y) / length }
  const left = minus(point, now)
  const off = Math.abs(left.x * along.y - left.y * along.x)
  return off <= aside && gotThere(dot(minus(point, before), along), dot(left, along))
}

/** Where a base shows on `held` for a move that shows at `shown`: on the shape, as far as the move allows. */
const shownOn = (frame: SnapFrame, held: HeldShape, base: BasePoint, free: Vec3, shown: ScreenPoint) =>
  frame.view.project(constrained(frame.constraint, base.start, landingOn(held, frame.view.rayAt(shown), free)))

/** Whether a move from `before` to `now` went across, or right up to, the line, edge or plane `hit` is on. */
const crossed = (frame: SnapFrame, from: Vec3, hit: SnapHit, before: ScreenPoint, now: ScreenPoint): boolean => {
  const { base, held } = hit
  const on = [
    shownOn(frame, held, base, vecAdd(base.start, from), before),
    shownOn(frame, held, base, freePoint(frame, base), now)
  ] as const
  if (on[0] === undefined || on[1] === undefined) return false
  const [was, is] = [minus(before, on[0]), minus(now, on[1])]
  const left = Math.hypot(is.x, is.y)
  return gotThere(Math.hypot(was.x, was.y), dot(was, is) < 0 ? -left : left)
}

/** The line or edge `base` is sliding along: a point on it is met by the selection, with the pointer off to one side. */
const slidingOn = (current: SnapHit | undefined, base: BasePoint): HeldShape | undefined =>
  current !== undefined && (current.held.shape === "line" || current.held.shape === "segment") &&
    vecDistance(current.base.start, base.start) < SAME_CM
    ? current.held
    : undefined

/** Whether the sample along `path` to the frame's move got to `hit`. */
const arrives = (frame: SnapFrame, { current, from }: DragPath, hit: SnapHit): boolean => {
  const { base } = hit
  const { constraint, view } = frame
  const free = freePoint(frame, base)
  const before = view.project(vecAdd(base.start, from))
  const now = view.project(free)
  const point = view.project(landingUnder(constraint, hit))
  if (before === undefined || now === undefined || point === undefined) return false
  if (pixelDistance(before, now) === 0) return false
  if ((constraint.kind === "surface" ? hit.distance : pixelDistance(point, now)) < UNDER_PX) return true
  // An end is a socket, not a point to pass: showing within its range of another end is meeting it.
  if (hit.target === "connectors") return true
  // On a line every target comes down to one value along it.
  if (hit.held.shape !== "point" && constraint.kind !== "line") return crossed(frame, from, hit, before, now)
  const aside = passingRange(frame, hit)
  if (passed(before, now, point, aside)) return true
  const slide = slidingOn(current, base)
  if (slide === undefined) return false
  const [start, end] = [
    shownOn(frame, slide, base, vecAdd(base.start, from), before),
    shownOn(frame, slide, base, free, now)
  ]
  return start !== undefined && end !== undefined && pixelDistance(start, end) > 0 && passed(start, end, point, aside)
}

/** Whether two shapes are one: a point by its pixel, as what's along the view from a tracked point keeps the base's depth. */
const sameShape = (frame: SnapFrame, a: HeldShape, b: HeldShape): boolean => {
  const near = (p: Vec3, q: Vec3) => vecDistance(p, q) < SAME_CM
  if (a.shape === "point" && b.shape === "point") {
    const [p, q] = [frame.view.project(a.at), frame.view.project(b.at)]
    return p !== undefined && q !== undefined && pixelDistance(p, q) < UNDER_PX
  }
  if (a.shape === "line" && b.shape === "line") return near(a.origin, b.origin) && near(a.direction, b.direction)
  if (a.shape === "segment" && b.shape === "segment") return near(a.from, b.from) && near(a.to, b.to)
  if (a.shape === "plane" && b.shape === "plane") {
    return near(a.normal, b.normal) && Math.abs(vecDot(vecSub(a.origin, b.origin), a.normal)) < SAME_CM
  }
  return false
}

/** Whether `hit` is the target a drag is already on, or one of the axes of it. */
const isCurrent = (frame: SnapFrame, current: SnapHit | undefined, hit: SnapHit): boolean =>
  current !== undefined &&
  (current.parts ?? [current]).some((one) =>
    one.target === hit.target && one.item === hit.item && vecDistance(one.base.start, hit.base.start) < SAME_CM &&
    sameShape(frame, one.held, hit.held)
  )

/** What a drag along `path` can land on this frame, of what's in range. */
export const takenBy = (frame: SnapFrame, { current, from }: DragPath) => (hit: SnapHit): boolean =>
  hit.target === "grid" || isCurrent(frame, current, hit) || arrives(frame, { current, from }, hit)
