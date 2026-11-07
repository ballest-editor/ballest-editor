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

const FEATURES = ["min", "centre", "max"] as const

type Feature = (typeof FEATURES)[number]

/** A box's features in words, along the axis as the stations' "Near face" and "Far face" are. */
const FEATURE_WORDS = { min: "Near side", centre: "Centre", max: "Far side" } as const

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
  readonly marks: ReadonlyArray<SnapMark>
  /** What it says, short of the axis a plane is on. */
  readonly words: string
  /** The item and features a plane lines up: what two axes share to read as one. A gap has none. */
  readonly level?: { readonly key: string; readonly feature: Feature; readonly their: Feature }
}

/** Closer than this, in cm, two matches are the same distance away: what's left is rounding, and differs by the frame. */
const TIE = 1e-6

/** The nearest first. Boxes of one size line up on all three features at once, and it's the centres that say so. */
const nearerFirst = (a: Match, b: Match): number => {
  const nearer = Math.abs(a.by) - Math.abs(b.by)
  if (Math.abs(nearer) > TIE) return nearer
  return Number(b.level?.feature === "centre") - Number(a.level?.feature === "centre")
}

/** The guide between the selection and a neighbour, with the distance between the pieces on it when there is one. */
const guideBetween = (selection: Box, neighbour: Box, apart: number): SnapMark => {
  const cm = Math.round(apart)
  return {
    kind: "guide",
    from: boxCentreOf(selection),
    to: boxCentreOf(neighbour),
    ...(cm > 0 && { text: `${cm} cm` })
  }
}

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
        return [{
          by,
          words: levelWords(mine, their, item.name),
          level: { key: item.key, feature: mine, their },
          marks: [guideBetween(landed, item.box, separation(landed, item.box))]
        }]
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
        words: `Same gap as ${near.name} to ${far.name}, ${Math.round(gap)} cm`,
        marks: [guideBetween(landed, near.box, gap), guideBetween(near.box, far.box, gap)]
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
    marks: best.marks,
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
  const hits = axesOf(frame.constraint).flatMap((axis): ReadonlyArray<AxisHit> => {
    const found = [
      ...planeMatches(axis, moved, neighbours, cmRange),
      ...(gapsOn(frame) ? gapMatches(axis, moved, neighbours, cmRange) : [])
    ].sort(nearerFirst)
    const best = found[0]
    return best === undefined ? [] : [{ hit: axisHit(frame, base, axis, best), match: best, axis: axisName(axis) }]
  })
  return together(frame, base, hits.filter(({ hit }) => takes(hit)))
}
