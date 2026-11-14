/**
 * A finished set of pieces made to look more like the model: each piece in turn is dropped when the whole looks no
 * worse without it, and otherwise moved, stretched and turned a step at a time while that raises the image score
 * (views.ts `lookOf`). A fit that works on volume leaves pieces that only fill the inside and pieces a little off the
 * surface; this spends what time is left on what shows.
 *
 * Given the model's symmetries (symmetry.ts), the pieces are first made symmetric and then tied in orbits: a piece and
 * its mirror image, or its turned images, move and drop together, and a piece on a plane or an axis stays on it. The
 * result is exactly symmetric where the model is, and the search has a half (or a sector) of the parameters to try.
 */
import { quatFromAxisAngle, quatMul, quatNormalize, rotateVec, vecAdd, vecScale } from "../../ueMath"
import { now } from "../clock"
import {
  drawnOver,
  lookOf,
  lookOfPlacements,
  type ModelViews,
  type Picture,
  picturesOf,
  trianglesOfPlacement
} from "../look/views"
import {
  IDENTITY_MOTION,
  membersOf,
  movedPlacement,
  type Orbit,
  seedsOf,
  shapeGap,
  snappedTo,
  type Symmetrized,
  symmetrized,
  type Symmetry,
  tyingOf
} from "../parts/symmetry"
import type { Placement } from "../shapes"

/** The side of the pictures the polish judges by: half the model's, which `lookOf` pools down in any case. */
const POLISH_VIEW = 128
/** The first step, as a share of the view frame's radius, and the least before the polish stops. */
const FIRST_STEP = 0.03
const LAST_STEP = 0.004
/** How far a step turns a piece, radians, at the first step. */
const FIRST_TURN = 0.2
/** A piece is dropped when the score without it is within this of the score with it. */
const DROP_WITHIN = 0.0005
/** A move is taken when it raises the score by at least this. */
const GAIN_LEAST = 1e-5

const OWN_AXES = [
  { key: "x", axis: { x: 1, y: 0, z: 0 } },
  { key: "y", axis: { x: 0, y: 1, z: 0 } },
  { key: "z", axis: { x: 0, y: 0, z: 1 } }
] as const

/** `placements` as the polish pictures them. */
const drawn = (views: ModelViews, placements: ReadonlyArray<Placement>): ReadonlyArray<Picture> =>
  picturesOf(views.frame, placements.map(trianglesOfPlacement), { size: POLISH_VIEW })

/** How much `placements` look like the model, in the polish's pictures. */
const lookAt = (views: ModelViews, placements: ReadonlyArray<Placement>): number =>
  lookOf(views, drawn(views, placements)).score

/** How far a nudge goes: along an axis, about one, and the least a half extent may come to. */
interface Step {
  readonly length: number
  readonly turn: number
  readonly least: number
}

/** `piece` a step each way along, across and about each of its own axes. */
const nudges = (piece: Placement, step: Step): Array<Placement> =>
  OWN_AXES.flatMap(({ axis, key }) => {
    const along = rotateVec(piece.rotation, axis)
    return [-1, 1].flatMap((sign): Array<Placement> => {
      // A stretch moves one side and leaves the other where it is.
      const half = Math.max(step.least, piece.half[key] + sign * step.length / 2)
      const stretched = (side: number): Placement => ({
        ...piece,
        half: { ...piece.half, [key]: half },
        center: vecAdd(piece.center, vecScale(along, side * (half - piece.half[key])))
      })
      return [
        { ...piece, center: vecAdd(piece.center, vecScale(along, sign * step.length)) },
        stretched(-1),
        stretched(1),
        { ...piece, rotation: quatNormalize(quatMul(piece.rotation, quatFromAxisAngle(axis, sign * step.turn))) }
      ]
    })
  })

/** A piece tied to nothing: an orbit of itself. */
const alone = (piece: Placement): Orbit => ({ piece, motions: [IDENTITY_MOTION], stabilizer: [] })

const piecesOf = (orbits: ReadonlyArray<Orbit>): Array<Placement> => orbits.flatMap(membersOf)

/**
 * `placements` made symmetric under `symmetries` (best first, as `chosenSymmetries` gives them), keeping the part of
 * the space whose pieces look best with their images; a part that would need more pieces than `placements` has loses
 * to one that doesn't.
 */
export const symmetricStart = (
  views: ModelViews,
  placements: ReadonlyArray<Placement>,
  symmetries: ReadonlyArray<Symmetry>
): Symmetrized => {
  const tying = tyingOf(symmetries, views.frame.radius)
  let best: Symmetrized = { placements, orbits: placements.map(alone) }
  let bestWorth = -Infinity
  for (const seed of seedsOf(placements, tying)) {
    const found = symmetrized(placements, tying, seed)
    // Over the count, a part loses to any within it.
    const worth = lookAt(views, found.placements) - (found.placements.length > placements.length ? 1 : 0)
    if (worth > bestWorth) {
      bestWorth = worth
      best = found
    }
  }
  return best
}

export interface Polished {
  readonly placements: ReadonlyArray<Placement>
  /** The look of the pieces as they were given, and as they are returned. */
  readonly before: number
  readonly after: number
  /** How many of `placements` move with others, as images of one piece. */
  readonly tied: number
}

/** The polish as it goes: the orbits, what they score, and the model's views they are scored against. */
interface Search {
  readonly views: ModelViews
  orbits: ReadonlyArray<Orbit>
  best: number
}

/**
 * Drops `orbit` when `rest`, the others, look about as good without it: a tied orbit at the same price a piece as a
 * free one. `under` is the others' pictures.
 */
const dropOrbit = (
  search: Search,
  orbit: Orbit,
  rest: ReadonlyArray<Orbit>,
  under: ReadonlyArray<Picture>
): boolean => {
  const without = lookOf(search.views, under).score
  if (without < search.best - DROP_WITHIN * orbit.motions.length) return false
  search.best = Math.max(search.best, without)
  search.orbits = rest
  return true
}

/**
 * `orbit`'s piece nudged to where the whole looks best, and that score taken as the best; undefined when no nudge
 * raises the score. Every nudge is of the piece as it was, drawn with its images over `under`, the other orbits'
 * pictures.
 */
const bestNudge = (
  search: Search,
  orbit: Orbit,
  under: ReadonlyArray<Picture>,
  step: Step
): Placement | undefined => {
  const { views } = search, { motions, piece, stabilizer } = orbit
  const unmoved = 1e-6 * views.frame.radius
  let kept = piece
  for (const nudge of nudges(piece, step)) {
    // A piece on a plane or an axis stays on it: a move off it is taken back, a stretch made even both ways.
    const trial = stabilizer.length === 0 ? nudge : snappedTo(nudge, stabilizer)
    if (trial === undefined || (stabilizer.length > 0 && shapeGap(trial, piece) <= unmoved)) continue
    const images = motions.map((motion) => movedPlacement(motion, trial))
    const found = lookOf(views, drawnOver(views.frame, under, images)).score
    if (found > search.best + GAIN_LEAST) {
      search.best = found
      kept = trial
    }
  }
  return kept === piece ? undefined : kept
}

/**
 * `placements` polished against `views` for at most `seconds`. With `symmetries`, the pieces are made symmetric first
 * and polished in orbits; pieces where the symmetries don't hold stay free.
 */
export const polishPieces = (
  views: ModelViews,
  placements: ReadonlyArray<Placement>,
  seconds: number,
  symmetries: ReadonlyArray<Symmetry> = []
): Polished => {
  const before = lookAt(views, placements)
  const tied = symmetries.length > 0
  const orbits = tied ? symmetricStart(views, placements, symmetries).orbits : placements.map(alone)
  const search: Search = { views, orbits, best: tied ? lookAt(views, piecesOf(orbits)) : before }
  const { radius } = views.frame
  const deadline = now() + seconds * 1000
  let step: Step = { length: radius * FIRST_STEP, turn: FIRST_TURN, least: radius * LAST_STEP / 2 }
  // The clock is read once a pass and once an orbit: the golden check counts the reads (tools/approximate).
  while (now() < deadline && step.length >= radius * LAST_STEP) {
    let gained = false
    // Last first, so that dropping one leaves the ones still to come where they were.
    for (let i = search.orbits.length - 1; i >= 0 && now() < deadline; i--) {
      const orbit = search.orbits[i]
      if (orbit === undefined) continue
      const rest = search.orbits.filter((_, k) => k !== i)
      const others = piecesOf(rest)
      const under = drawn(views, others)
      // The last pieces standing are never dropped.
      if (others.length > 0 && dropOrbit(search, orbit, rest, under)) {
        gained = true
        continue
      }
      const piece = bestNudge(search, orbit, under, step)
      if (piece === undefined) continue
      search.orbits = search.orbits.with(i, { ...orbit, piece })
      gained = true
    }
    // A pass that changes nothing halves the step.
    if (!gained) step = { length: step.length / 2, turn: step.turn / 2, least: step.least }
  }
  return {
    placements: piecesOf(search.orbits),
    before,
    after: search.best,
    tied: search.orbits.reduce((n, orbit) => n + (orbit.motions.length > 1 ? orbit.motions.length : 0), 0)
  }
}

/**
 * How much worse, by `lookOf`, a symmetric result may look than the free one and still be kept. Ties make a model's
 * matching parts match, which the eye reads as right and the look barely sees; a tie that erases a real feature (an
 * off-centre detail mirrored away, a brow made even) costs that feature's share of the outline, depth and facing,
 * which is more than this. On twelve models polished for 20 s, ties the eye judged right scored 0.007 to 0.23 above
 * the free result, and ties that lost a feature 0.027 to 0.052 below it: this sits under the least gain and well
 * inside the least loss.
 */
const SYMMETRY_MARGIN = 0.005

export interface Choice {
  readonly placements: ReadonlyArray<Placement>
  readonly symmetric: boolean
}

/** The symmetric result when it looks at most `SYMMETRY_MARGIN` worse than the free one; otherwise the free one. */
export const symmetricOrFree = (
  views: ModelViews,
  free: ReadonlyArray<Placement>,
  tied: ReadonlyArray<Placement>
): Choice => {
  const freeLook = lookOfPlacements(views, free).score, tiedLook = lookOfPlacements(views, tied).score
  const symmetric = tiedLook >= freeLook - SYMMETRY_MARGIN
  return { placements: symmetric ? tied : free, symmetric }
}
