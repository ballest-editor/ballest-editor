/**
 * Which target a frame lands on (docs/SNAPPING.md § Priority): the first in the list with something to be had, the nearest
 * within it, and a point before an edge before a face. A pick has all that's in range, and a drag what it has got to
 * (`snapCapture`). The Grid can't be moved out of range the way a target can, so it
 * claims a frame only while its lines stand further apart than the range and one is near; otherwise it waits at the end
 * of the list, where it is what a move falls back on.
 */
import type { Quat4, Vec3 } from "./coords"
import { formatGridSize } from "./snap"
import { alignmentHit } from "./snapAlignment"
import { type DragPath, takenBy } from "./snapCapture"
import { priorityOf, rangeOf, type SnapTarget } from "./snapConfig"
import {
  type BasePoint,
  constrained,
  freePoint,
  landingOn,
  pixelDistance,
  referenceOf,
  type SnapFrame,
  type SnapHit
} from "./snapFrame"
import { gridLanding, gridSpacingPixels } from "./snapGrid"
import { connectorHits, constructionHits, meshHits, trackingHits } from "./snapTargets"
import { vecDot, vecScale, vecSub } from "./ueMath"

/** How many of the nearest points are asked whether something hides them. */
const OCCLUSION_TRIES = 12

/** The base the pointer is nearest. */
export const baseNearPointer = (frame: SnapFrame): BasePoint | undefined => {
  const measured = frame.bases.flatMap((base) => {
    const reference = referenceOf(frame, base)
    return reference === undefined ? [] : [{ base, distance: pixelDistance(reference, frame.pointer) }]
  })
  return measured.sort((a, b) => a.distance - b.distance)[0]?.base ?? frame.bases[0]
}

/** Where the grid takes a free point: a surface drag keeps sliding on its plane, as the grid has no say off it. */
const gridPoint = (frame: SnapFrame, base: BasePoint): Vec3 => {
  const free = freePoint(frame, base)
  const on = gridLanding(frame.config, base.start, free, frame.stepAxes)
  if (frame.constraint.kind !== "surface") return on
  const { normal } = frame.constraint
  return vecSub(on, vecScale(normal, vecDot(vecSub(on, base.start), normal)))
}

const gridHit = (frame: SnapFrame, base: BasePoint, distance: number): SnapHit => {
  const landing = gridPoint(frame, base)
  return {
    target: "grid",
    rank: 0,
    distance,
    base,
    landing,
    label: `Grid ${formatGridSize(frame.config.gridSize, frame.units)}`,
    marks: [{ kind: "dot", at: landing }],
    held: { shape: "point", at: landing }
  }
}

/** The grid's say in the list: nothing while its lines are closer than the range can tell apart. */
const gridClaim = (frame: SnapFrame): ReadonlyArray<SnapHit> => {
  const base = baseNearPointer(frame)
  if (base === undefined) return []
  const range = rangeOf(frame.config, "grid")
  const spacing = gridSpacingPixels(frame.config, frame.view.cmPerPixelAt(freePoint(frame, base)))
  if (spacing < range * 2) return []
  const landing = constrained(frame.constraint, base.start, gridPoint(frame, base))
  const [shown, reference] = [frame.view.project(landing), referenceOf(frame, base)]
  if (shown === undefined || reference === undefined) return []
  const distance = pixelDistance(shown, reference)
  return distance > range ? [] : [gridHit(frame, base, distance)]
}

/** Which of what's in range can land this frame. */
type Takes = (hit: SnapHit) => boolean

const hitsOf = (frame: SnapFrame, target: SnapTarget, takes: Takes): ReadonlyArray<SnapHit> => {
  switch (target) {
    case "grid":
      return gridClaim(frame)
    case "connectors":
      return connectorHits(frame).filter(takes)
    case "mesh":
      return meshHits(frame).filter(takes)
    case "construction":
      return constructionHits(frame).filter(takes)
    case "tracking":
      return trackingHits(frame).filter(takes)
    case "alignment":
      return alignmentHit(frame, takes)
  }
}

/**
 * Whether a hit is in reach of a line or plane the move is held to: a target sets the value along it, and one the move
 * would have to jump to, such as a wall far behind the handle, isn't near however the pointer lines up with it.
 */
const inReach = (frame: SnapFrame, hit: SnapHit): boolean => {
  if (frame.constraint.kind === "surface") return true
  const landed = frame.view.project(constrained(frame.constraint, hit.base.start, hit.landing))
  const free = frame.view.project(freePoint(frame, hit.base))
  return landed !== undefined && free !== undefined &&
    pixelDistance(landed, free) <= rangeOf(frame.config, hit.target)
}

/** How far into the pane a hit lands, to tell apart what shows on one pixel. */
const depthOf = (frame: SnapFrame, { landing }: SnapHit) => vecDot(landing, frame.view.directionAt(landing))

/** A point before an edge before a face, then the nearest; of a target's hits, the first that shows when it must. */
const bestOf = (frame: SnapFrame, hits: ReadonlyArray<SnapHit>): SnapHit | undefined => {
  const ordered = hits.filter((hit) => inReach(frame, hit)).sort((a, b) =>
    a.rank - b.rank || a.distance - b.distance || depthOf(frame, a) - depthOf(frame, b)
  )
  const { occluded } = frame
  const mustShow = occluded !== undefined && frame.config.targets.mesh.occlusion === "front"
  if (!mustShow) return ordered[0]
  let tries = 0
  return ordered.find((hit) => {
    if (hit.target !== "mesh" || hit.frontmost === true) return true
    return tries++ < OCCLUSION_TRIES && !occluded(hit.landing)
  })
}

/** `hit` under the frame's constraint: a line or plane only takes the value along it. */
const underConstraint = (frame: SnapFrame, hit: SnapHit): SnapHit => ({
  ...hit,
  landing: constrained(frame.constraint, hit.base.start, hit.landing)
})

/** `held` for this frame: on its point, or as far along its edge, line or plane as the pointer has gone. */
const stillHeld = (frame: SnapFrame, held: SnapHit): SnapHit => {
  const reference = referenceOf(frame, held.base) ?? frame.pointer
  const landing = landingOn(held.held, frame.view.rayAt(reference), freePoint(frame, held.base))
  return underConstraint(frame, { ...held, landing, distance: 0 })
}

/** The first target in the list with something `takes` lets through; else the grid, if it's on. */
const firstHit = (frame: SnapFrame, takes: Takes): SnapHit | undefined => {
  for (const target of priorityOf(frame.config)) {
    const best = bestOf(frame, hitsOf(frame, target, takes))
    if (best !== undefined) return underConstraint(frame, best)
  }
  if (!frame.config.targets.grid.enabled) return undefined
  const base = baseNearPointer(frame)
  return base === undefined ? undefined : underConstraint(frame, gridHit(frame, base, 0))
}

/**
 * What the pointer picks where it is, with everything in range to be had; undefined when it's near nothing. `held` is
 * the target Shift keeps: nothing else takes over while it is given.
 */
export const resolveSnap = (frame: SnapFrame, held?: SnapHit): SnapHit | undefined =>
  held === undefined ? firstHit(frame, () => true) : stillHeld(frame, held)

/** What a drag lands on, having come along `path`: what it got to and hasn't left. Undefined when it goes free. */
export const resolveDrag = (frame: SnapFrame, path: DragPath): SnapHit | undefined =>
  firstHit(frame, takenBy(frame, path))

/** The move a hit makes of the selection: a turn about its base, if the target asks for one, then the offset. */
export interface SnappedMove {
  readonly offset: Vec3
  readonly rotation?: Quat4
  readonly about: Vec3
}

export const moveOf = (hit: SnapHit): SnappedMove => ({
  offset: vecSub(hit.landing, hit.base.start),
  about: hit.base.start,
  ...(hit.rotation !== undefined && { rotation: hit.rotation })
})
