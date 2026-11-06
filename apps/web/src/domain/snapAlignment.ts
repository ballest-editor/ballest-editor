/**
 * The Alignment target (docs/SNAPPING.md § Alignment): what 2D tools do, limited so it stays quiet in a map of thousands.
 * Only items the pane shows count, only the axes the move has are searched, and guides run between the two items that
 * matched. In perspective a neighbour must also stand within the threshold on screen.
 */
import type { Vec3 } from "./coords"
import { type Box, boxCentreOf } from "./itemBounds"
import { rangeOf } from "./snapConfig"
import {
  axesOf,
  type BasePoint,
  freePoint,
  type SnapFrame,
  type SnapHit,
  type SnapItem,
  type SnapMark
} from "./snapFrame"
import { vecAdd, vecDot, vecLength, vecScale, vecSub } from "./ueMath"

/** A box's reach along `axis`: its near and far face planes and its centre. */
interface Span {
  readonly min: number
  readonly centre: number
  readonly max: number
}

const cornersOf = ({ max, min }: Box): ReadonlyArray<Vec3> =>
  [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z }))))

const spanOf = (box: Box, axis: Vec3): Span => {
  const along = cornersOf(box).map((corner) => vecDot(corner, axis))
  return { min: Math.min(...along), centre: vecDot(boxCentreOf(box), axis), max: Math.max(...along) }
}

const movedBox = ({ max, min }: Box, by: Vec3): Box => ({ min: vecAdd(min, by), max: vecAdd(max, by) })

/** How far apart two boxes stand, zero along an axis they overlap on. */
const separation = (a: Box, b: Box): number => {
  const gap = (axis: "x" | "y" | "z") => Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0)
  return Math.hypot(gap("x"), gap("y"), gap("z"))
}

const screenBox = (frame: SnapFrame, box: Box) => {
  const shown = cornersOf(box).flatMap((corner) => frame.view.project(corner) ?? [])
  if (shown.length === 0) return undefined
  const xs = shown.map(({ x }) => x)
  const ys = shown.map(({ y }) => y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

/** Whether two boxes show within `range` of each other. */
const showNear = (frame: SnapFrame, a: Box, b: Box, range: number): boolean => {
  const [p, q] = [screenBox(frame, a), screenBox(frame, b)]
  if (p === undefined || q === undefined) return false
  const gapX = Math.max(p.left - q.right, q.left - p.right, 0)
  const gapY = Math.max(p.top - q.bottom, q.top - p.bottom, 0)
  return Math.hypot(gapX, gapY) <= range
}

interface Match {
  /** What to add along the axis, in cm. */
  readonly by: number
  readonly marks: ReadonlyArray<SnapMark>
  readonly name: string
  readonly apart: number
}

const FEATURES = ["min", "centre", "max"] as const

/** The guide between the selection and a neighbour, with the distance between the pieces on it. */
const guideBetween = (selection: Box, neighbour: Box, apart: number): SnapMark => ({
  kind: "guide",
  from: boxCentreOf(selection),
  to: boxCentreOf(neighbour),
  text: `${Math.round(apart)} cm`
})

const planeMatches = (axis: Vec3, moved: Box, neighbours: ReadonlyArray<SnapItem>, cmRange: number) => {
  const own = spanOf(moved, axis)
  return neighbours.flatMap((item): ReadonlyArray<Match> => {
    const theirs = spanOf(item.box, axis)
    return FEATURES.flatMap((mine) =>
      FEATURES.flatMap((their): ReadonlyArray<Match> => {
        // a centre only lines up with a centre
        if ((mine === "centre") !== (their === "centre")) return []
        const by = theirs[their] - own[mine]
        if (Math.abs(by) > cmRange) return []
        const landed = movedBox(moved, vecScale(axis, by))
        const apart = separation(landed, item.box)
        return [{ by, name: item.name, apart, marks: [guideBetween(landed, item.box, apart)] }]
      })
    )
  })
}

/** Gaps along `axis` the selection can match: the one between two neighbours, carried on past the last of them. */
const gapMatches = (axis: Vec3, moved: Box, neighbours: ReadonlyArray<SnapItem>, cmRange: number) => {
  const own = spanOf(moved, axis)
  const inLine = [...neighbours]
    .map((item) => ({ item, span: spanOf(item.box, axis) }))
    .sort((a, b) => a.span.min - b.span.min)
  return inLine.flatMap(({ item: first, span: a }, i): ReadonlyArray<Match> => {
    const next = inLine[i + 1]
    if (next === undefined) return []
    const { item: second, span: b } = next
    const gap = b.min - a.max
    if (gap <= 0) return []
    const after = b.max + gap - own.min
    const before = a.min - gap - own.max
    return [[after, second, first], [before, first, second]].flatMap(([by, near, far]): ReadonlyArray<Match> => {
      if (typeof by !== "number" || typeof near !== "object" || typeof far !== "object") return []
      if (Math.abs(by) > cmRange) return []
      const landed = movedBox(moved, vecScale(axis, by))
      return [{
        by,
        name: near.name,
        apart: gap,
        marks: [guideBetween(landed, near.box, gap), guideBetween(near.box, far.box, gap)]
      }]
    })
  })
}

const gapsOn = (frame: SnapFrame): boolean => {
  const { gapGuides } = frame.config.targets.alignment
  return gapGuides === "always" || (gapGuides === "ortho" && frame.view.orthographic)
}

/** One axis of the move's alignment. */
const axisHit = (frame: SnapFrame, base: BasePoint, axis: Vec3, best: Match): SnapHit => {
  const free = freePoint(frame, base)
  const landing = vecAdd(free, vecScale(axis, best.by))
  return {
    target: "alignment",
    rank: 0,
    distance: Math.abs(best.by) / frame.view.cmPerPixelAt(free),
    base,
    landing,
    label: `Level with ${best.name}, ${Math.round(best.apart)} cm`,
    marks: best.marks,
    held: { shape: "plane", origin: landing, normal: axis }
  }
}

/** What a move's axes land on together: on a plane for one, and where the planes meet for two. */
const together = (frame: SnapFrame, base: BasePoint, hits: ReadonlyArray<SnapHit>): ReadonlyArray<SnapHit> => {
  const [first] = hits
  if (first === undefined || hits.length === 1) return hits
  const free = freePoint(frame, base)
  const landing = hits.reduce((sum, { landing: one }) => vecAdd(sum, vecSub(one, free)), free)
  return [{
    ...first,
    distance: vecLength(vecSub(landing, free)) / frame.view.cmPerPixelAt(free),
    landing,
    marks: hits.flatMap(({ marks }) => marks),
    held: { shape: "point", at: landing },
    parts: hits
  }]
}

/** The move's alignment: for each of its axes the nearest match that `takes` lets through, as one hit. */
export const alignmentHit = (
  frame: SnapFrame,
  takes: (hit: SnapHit) => boolean = () => true
): ReadonlyArray<SnapHit> => {
  const [base] = frame.bases
  if (base === undefined) return []
  const range = rangeOf(frame.config, "alignment")
  const free = freePoint(frame, base)
  const cmRange = range * frame.view.cmPerPixelAt(free)
  const moved = movedBox(frame.box, frame.offset)
  const neighbours = frame.items.filter(({ box }) =>
    frame.view.inView(box) && (frame.view.orthographic || showNear(frame, moved, box, range))
  )
  if (neighbours.length === 0) return []
  const hits = axesOf(frame.constraint).flatMap((axis) => {
    const found = [
      ...planeMatches(axis, moved, neighbours, cmRange),
      ...(gapsOn(frame) ? gapMatches(axis, moved, neighbours, cmRange) : [])
    ].sort((a, b) => Math.abs(a.by) - Math.abs(b.by))
    const best = found[0]
    return best === undefined ? [] : [axisHit(frame, base, axis, best)]
  })
  return together(frame, base, hits.filter(takes))
}
