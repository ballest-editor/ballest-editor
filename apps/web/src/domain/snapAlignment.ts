/**
 * The Alignment target (docs/SNAPPING.md § Alignment): what 2D tools do, limited so it stays quiet in a map of thousands.
 * Only near neighbours count: items the pane shows, no further from the selection than its own size, and in perspective
 * within the threshold on screen. Only the axes the move has are searched, and guides run between the two items that
 * matched.
 */
import type { Vec3 } from "./coords"
import { type Box, boxCentreOf } from "./itemBounds"
import { rangeOf } from "./snapConfig"
import {
  axesOf,
  type BasePoint,
  freePoint,
  type MarkRole,
  type SnapFrame,
  type SnapHit,
  type SnapItem,
  type SnapMark,
  type SnapRelation
} from "./snapFrame"
import { boxMark, cornersOf, ontoPlane, sideOf } from "./snapRelation"
import { vecAdd, vecDistance, vecDot, vecLength, vecLerp, vecScale, vecSub } from "./ueMath"

/** A box's reach along `axis`: its near and far face planes and its centre. */
interface Span {
  readonly min: number
  readonly centre: number
  readonly max: number
}

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

/**
 * How far a neighbour can stand from the selection and still count, in cm: the selection's own size, its box's diagonal,
 * or the range at the selection's depth when that is more, so a small piece still finds what its pixels reach.
 */
const reachOf = (box: Box, cmRange: number): number => Math.max(vecDistance(box.min, box.max), cmRange)

const FEATURES = ["min", "centre", "max"] as const

type Feature = (typeof FEATURES)[number]

/** A box's features in words, along the axis as the stations' "Near face" and "Far face" are. */
const FEATURE_WORDS = { min: "Near side", centre: "Center", max: "Far side" } as const

/** The neighbour's side when it isn't the selection's own: "Near side level with far side of Track L". */
const THEIR_WORDS = { min: "near side of", max: "far side of" } as const

/** What lined up, short of the axis: both sides when they differ, as near-to-near and near-to-far are both a stop. */
const levelWords = (mine: Feature, their: Feature, name: string): string =>
  mine === their || mine === "centre" || their === "centre"
    ? `${FEATURE_WORDS[mine]} level with ${name}`
    : `${FEATURE_WORDS[mine]} level with ${THEIR_WORDS[their]} ${name}`

interface Match {
  /** What to add along the axis, in cm. */
  readonly by: number
  /** How far the selection stands from the neighbour it lines up with, once it has: the nearer is meant. */
  readonly apart: number
  readonly relation: SnapRelation
  readonly marks: ReadonlyArray<SnapMark>
  /** The selection's side or centre that lined up, at the drag's start. */
  readonly source: ReadonlyArray<SnapMark>
  /** What it says, short of the axis a plane is on. */
  readonly words: string
  /** The item and features a plane lines up: what two axes share to read as one. A gap has none. */
  readonly level?: { readonly key: string; readonly feature: Feature; readonly their: Feature }
}

/**
 * The nearest move first, a pixel counting as no difference, then the nearer neighbour: a piece far off that happens to
 * line up as well is the less likely meant. Boxes of one size line up on all three features at once, and it's the centres
 * that say so.
 */
const nearerFirst = (cmPerPixel: number) => (a: Match, b: Match): number => {
  const pixels = (cm: number) => Math.round(cm / cmPerPixel)
  const centre = (match: Match) => Number(match.level?.feature !== "centre")
  return pixels(Math.abs(a.by)) - pixels(Math.abs(b.by)) || pixels(a.apart) - pixels(b.apart) ||
    centre(a) - centre(b) || Math.abs(a.by) - Math.abs(b.by)
}

/** A box's side or centre along `axis`, as marks: the box, and the side tinted in it or its centre. */
const featureMarks = (box: Box, axis: Vec3, feature: Feature, role: MarkRole): ReadonlyArray<SnapMark> => [
  boxMark(box, role),
  feature === "centre"
    ? { kind: "dot", role, at: boxCentreOf(box) }
    : sideOf(box, feature === "min" ? vecScale(axis, -1) : axis, role)
]

/** The point of a box's feature on the plane it lines up on: its centre, carried along `axis` onto that plane. */
const featurePoint = (box: Box, axis: Vec3, at: number): Vec3 => ontoPlane(boxCentreOf(box), axis, at)

/**
 * The guide between the feature of the selection and the neighbour's it lined up with, in the plane they share, with
 * the distance between the pieces on it when there is one.
 */
const guideBetween = (from: Vec3, to: Vec3, apart: number): SnapMark => {
  const cm = Math.round(apart)
  return { kind: "guide", from, to, ...(cm > 0 && { text: `${cm} cm` }) }
}

const planeMatches = (axis: Vec3, start: Box, moved: Box, neighbours: ReadonlyArray<SnapItem>, cmRange: number) => {
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
        const level = theirs[their]
        const apart = separation(landed, item.box)
        return [{
          by,
          apart,
          relation: "aligned",
          words: levelWords(mine, their, item.name),
          level: { key: item.key, feature: mine, their },
          marks: [
            guideBetween(featurePoint(landed, axis, level), featurePoint(item.box, axis, level), apart),
            ...featureMarks(item.box, axis, their, "target")
          ],
          source: featureMarks(start, axis, mine, "source")
        }]
      })
    )
  })
}

/** A guide along `axis` from `from` to `to` cm, as a dimension between two boxes, in line with both their centres. */
const dimension = (a: Box, b: Box, axis: Vec3, from: number, to: number, gap: number): SnapMark => {
  const middle = vecLerp(boxCentreOf(a), boxCentreOf(b), 0.5)
  return guideBetween(ontoPlane(middle, axis, from), ontoPlane(middle, axis, to), gap)
}

/**
 * Gaps along `axis` the selection can match: the one between two neighbours, carried on past the last of them. The one
 * the selection comes up to must be near (`near`), and the one beyond it only in view.
 */
const gapMatches = (
  axis: Vec3,
  start: Box,
  moved: Box,
  neighbours: ReadonlyArray<SnapItem>,
  cmRange: number,
  near: (item: SnapItem) => boolean
) => {
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
    const reference = dimension(first.box, second.box, axis, a.max, b.min, gap)
    // after the second, the selection's near side faces the second's far side; before the first, the other way about
    const sides = [
      { by: after, next: second, far: first, facing: -1, at: b.max },
      { by: before, next: first, far: second, facing: 1, at: a.min }
    ]
    return sides.flatMap(({ at, by, facing, far, next: beside }): ReadonlyArray<Match> => {
      if (Math.abs(by) > cmRange || !near(beside)) return []
      const landed = movedBox(moved, vecScale(axis, by))
      const towards = vecScale(axis, facing)
      return [{
        by,
        apart: separation(landed, beside.box),
        relation: "gap",
        words: `Same gap as ${beside.name} to ${far.name}, ${Math.round(gap)} cm`,
        marks: [
          dimension(landed, beside.box, axis, at, at - facing * gap, gap),
          reference,
          boxMark(beside.box, "target"),
          sideOf(beside.box, vecScale(towards, -1), "target")
        ],
        source: [boxMark(start, "source"), sideOf(start, towards, "source")]
      }]
    })
  })
}

const gapsOn = (frame: SnapFrame): boolean => {
  const { gapGuides } = frame.config.targets.alignment
  return gapGuides === "always" || (gapGuides === "ortho" && frame.view.orthographic)
}

/** How far along a game axis a direction must run to go by its name: about 40° off it, past which it could be either. */
const NAMED_AXIS = 0.75

/** What a label calls an axis: the game's X, Y or Z it mostly runs along, which a grid turned a little keeps too. */
const axisName = ({ x, y, z }: Vec3): string =>
  ([["X", x], ["Y", y], ["Z", z]] as const).find(([, along]) => Math.abs(along) > NAMED_AXIS)?.[0] ?? "an axis"

const labelOf = ({ level, words }: Match, axes: string): string => level === undefined ? words : `${words} on ${axes}`

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
    label: labelOf(best, axisName(axis)),
    relation: best.relation,
    marks: best.marks,
    source: best.source,
    held: { shape: "plane", origin: landing, normal: axis }
  }
}

/** An axis's hit, with what `together` reads it by. */
interface AxisHit {
  readonly hit: SnapHit
  readonly match: Match
  readonly axis: string
}

const sameLevel = ({ match: { level: a } }: AxisHit, { match: { level: b } }: AxisHit): boolean =>
  a !== undefined && a.key === b?.key && a.feature === b.feature && a.their === b.their

/** Two axes in one label, in the game's order whichever way the plane's axes came out. */
const jointLabel = (hits: ReadonlyArray<AxisHit>): string => {
  const ordered = [...hits].sort((a, b) => a.axis.localeCompare(b.axis))
  const [first, second] = ordered
  if (first === undefined || second === undefined || !sameLevel(first, second)) {
    return ordered.map(({ hit }) => hit.label).join("; ")
  }
  return labelOf(first.match, first.axis === second.axis ? "two axes" : `${first.axis} and ${second.axis}`)
}

/** What a move's axes land on together: on a plane for one, and where the planes meet for two. */
const together = (frame: SnapFrame, base: BasePoint, axes: ReadonlyArray<AxisHit>): ReadonlyArray<SnapHit> => {
  const hits = axes.map(({ hit }) => hit)
  const [first] = hits
  if (first === undefined || hits.length === 1) return hits
  const free = freePoint(frame, base)
  const landing = hits.reduce((sum, { landing: one }) => vecAdd(sum, vecSub(one, free)), free)
  return [{
    ...first,
    distance: vecLength(vecSub(landing, free)) / frame.view.cmPerPixelAt(free),
    landing,
    label: jointLabel(axes),
    marks: hits.flatMap(({ marks }) => marks),
    source: hits.flatMap(({ source }) => source),
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
  const cmPerPixel = frame.view.cmPerPixelAt(free)
  const cmRange = range * cmPerPixel
  const moved = movedBox(frame.box, frame.offset)
  const inView = frame.items.filter(({ box }) => frame.view.inView(box))
  const reach = reachOf(frame.box, cmRange)
  const near = (item: SnapItem) =>
    separation(moved, item.box) <= reach && (frame.view.orthographic || showNear(frame, moved, item.box, range))
  const neighbours = inView.filter(near)
  if (neighbours.length === 0) return []
  const hits = axesOf(frame.constraint).flatMap((axis): ReadonlyArray<AxisHit> => {
    const found = [
      ...planeMatches(axis, frame.box, moved, neighbours, cmRange),
      ...(gapsOn(frame) ? gapMatches(axis, frame.box, moved, inView, cmRange, near) : [])
    ].sort(nearerFirst(cmPerPixel))
    const best = found[0]
    return best === undefined ? [] : [{ hit: axisHit(frame, base, axis, best), match: best, axis: axisName(axis) }]
  })
  return together(frame, base, hits.filter(({ hit }) => takes(hit)))
}
