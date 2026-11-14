/**
 * Flat profiles. A part of a model that is close to a prism, an outline with holes swept along some axis in any
 * orientation (a star's frame, a ring of towers, a curved track, a plate with slots), reads far better as a few pieces
 * that follow its outline than as a low-poly mesh of hundreds of pyramids.
 *
 * Each of the model's separate parts (`componentsOf`) is tested along its likely sweep axes by how its faces lie: a
 * prism's are caps square to the axis or sides along it. An accepted part's footprint along the axis is rastered and
 * split into layers of like depth (profileFootprint.ts). Each layer is then covered, greedily, with rotated rectangles
 * (boxes), ellipses (cylinders) and, at sharp corners, isosceles triangles (flat pyramids), each as deep as its layer
 * (profileShapes.ts). A piece may reach into a column that holds its layer's depth (a bar runs on into a taller tower)
 * but hardly past the footprint, so holes stay open.
 *
 * Covers are kept at several sizes, smallest first, for the caller to judge on the image score. A part that fails the
 * test, whose cover leaves too much out, or that the work time leaves unfinished stays in the remainder untouched.
 */
import type { Vec3 } from "../../coords"
import { quatFromFrame, vecAdd, vecDot, vecScale, vecSub } from "../../ueMath"
import { now } from "../clock"
import { at } from "../grid/voxelize"
import { type Component, componentsOf, joined, measured } from "../parts/meshParts"
import type { Placement } from "../shapes"
import { forEachFace, sweepTests } from "./extrusion"
import { type Footprint, footprintOf, fullnessOf, type Layer, layersOf } from "./profileFootprint"
import { GAIN_PIXELS, type Proposal, proposalsOf } from "./profileShapes"

/** Cosines: a face within 14° of square to the axis is a cap, one within 15° of along it a side. */
const CAP_COS = Math.cos(14 * Math.PI / 180)
const SIDE_COS = Math.cos(75 * Math.PI / 180)

/**
 * The two ways a part reads as a prism, by the share of its surface in caps and sides and by how full its footprint is
 * (the mean depth of its columns over its whole depth). Stepped: nearly all of it caps or sides, some of it caps, the
 * columns at least partly full (a ring of towers with lower bars). Bevelled: a quarter caps, over half caps or sides,
 * the columns mostly full and their middles level to within a quarter of the depth (a star frame with chamfered
 * edges). Measured on the sample models (the profile research): the bunny, duck, fox, goomba and teapot read neither.
 */
const STEPPED = { cap: 0.04, capSide: 0.88, solid: 0.38 } as const
const BEVELLED = { cap: 0.25, capSide: 0.57, solid: 0.6, drift: 0.25 } as const

/** Two axes within 5° of each other are one. */
const SAME_AXIS = Math.cos(5 * Math.PI / 180)
/**
 * At most this many axes, best first, are rastered before a part is given up. Best is the most surface in caps and
 * sides, then, among those within `AXES_TIE` of it, the most in caps: a stepped outline's walls read as caps seen from
 * the side, which a sweep along its true axis outscores.
 */
const AXES_TRIED = 3
const AXES_TIE = 0.02

/** Each pixel a shape spills costs as much as this many it newly covers: a piece that leaves the outline shows. */
const SPILL_COST = 2
/** Covering a pixel again costs this much: overlaps are unseen but add pieces without adding shape. */
const OVERLAP_COST = 0.05
/** A piece must newly cover this share of the footprint, and at least `GAIN_PIXELS`. */
const GAIN_LEAST = 0.002
/** The most pieces one part's cover takes, whatever the budget: a profile needing more is no longer simple. */
const MOST_PIECES = 64
/** A cover is kept each time what it leaves uncovered falls under one of these shares, and when it stops. */
const COVER_STEPS = [0.3, 0.2, 0.12, 0.08, 0.05, 0.03] as const
/** A part whose fullest cover leaves more than this share of its footprint uncovered isn't a profile. */
const ACCEPT_LEFT = 0.1

/** The work time, ms: a part not covered by then stays in the remainder. */
const PROFILE_WORK_MS = 3000

/** One cover of a part: its pieces, and the share of the part's footprint they leave uncovered. */
interface ProfileCover {
  readonly placements: ReadonlyArray<Placement>
  readonly uncovered: number
}

/** An accepted part: its covers, fewest pieces first. */
interface ProfilePart {
  readonly triangles: Float32Array
  readonly area: number
  readonly covers: ReadonlyArray<ProfileCover>
}

interface ProfileSplit {
  readonly parts: ReadonlyArray<ProfilePart>
  /** Every part not accepted, as one triangle soup. */
  readonly remainder: Float32Array
}

interface ProfileOptions {
  /** The most pieces the whole model may take. */
  readonly budget: number
  /** Parts shorter than this, cm, stay in the remainder: one primitive of their own suits them (meshParts.ts). */
  readonly least?: number
}

/** An axis a part may be swept along, with the share of the part's surface in caps square to it and sides along it. */
interface Facing {
  readonly axis: Vec3
  readonly cap: number
  readonly side: number
}

const facingOf = (triangles: Float32Array, axis: Vec3): Facing => {
  let cap = 0, side = 0, total = 0
  forEachFace(triangles, (cross, length) => {
    if (length === 0) return
    const along = Math.abs(vecDot(cross, axis)) / length
    total += length
    if (along > CAP_COS) cap += length
    else if (along < SIDE_COS) side += length
  })
  return { axis, cap: cap / Math.max(total, 1e-12), side: side / Math.max(total, 1e-12) }
}

/**
 * The axes to raster a part along, best first, at most `AXES_TRIED`: its sweep axes and its own axes that pass the
 * looser of the two prism tests on caps and sides.
 */
const axesOf = (part: Component): Array<Facing> => {
  const axes: Array<Vec3> = []
  for (const axis of [...sweepTests(part.triangles).map((test) => test.axis), ...part.axes]) {
    if (axes.every((other) => Math.abs(vecDot(other, axis)) < SAME_AXIS)) axes.push(axis)
  }
  return axes.map((axis) => facingOf(part.triangles, axis))
    .filter(({ cap, side }) => cap > STEPPED.cap && cap + side > BEVELLED.capSide)
    .sort((a, b) => {
      const sides = b.cap + b.side - a.cap - a.side
      return Math.abs(sides) > AXES_TIE ? sides : b.cap - a.cap
    })
    .slice(0, AXES_TRIED)
}

/** Whether the rastered part reads as a prism along its axis, stepped or bevelled. */
const prismatic = (f: Footprint, { cap, side }: Facing): boolean => {
  const { drift, solid } = fullnessOf(f)
  const stepped = cap > STEPPED.cap && cap + side > STEPPED.capSide && solid > STEPPED.solid
  const bevelled = cap > BEVELLED.cap && cap + side > BEVELLED.capSide && solid > BEVELLED.solid &&
    drift < BEVELLED.drift
  return stepped || bevelled
}

/** A chosen shape as a piece: a box, a cylinder or a flat pyramid as deep as its layer. */
const placementOf = (f: Footprint, layers: ReadonlyArray<Layer>, { layer: k, shape }: Proposal): Placement => {
  const layer = layers[k] ?? { near: 0, far: 0 }
  const depth = Math.max(layer.far - layer.near, f.pixel), middle = (layer.near + layer.far) / 2
  const world = (x: number, y: number): Vec3 =>
    vecAdd(
      vecAdd(vecScale(f.u, f.origin[0] + x * f.pixel), vecScale(f.v, f.origin[1] + y * f.pixel)),
      vecScale(f.w, middle)
    )
  if (shape.kind === "triangle") {
    const { apex, left, right } = shape
    const base = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2] as const
    const up = vecSub(world(...apex), world(...base))
    return {
      kind: "pyramid",
      center: world((base[0] + apex[0]) / 2, (base[1] + apex[1]) / 2),
      half: {
        x: depth / 2,
        y: Math.hypot(right[0] - left[0], right[1] - left[1]) * f.pixel / 2,
        z: Math.hypot(up.x, up.y, up.z) / 2
      },
      // Local x through the thickness, z to the apex: the triangle is the pyramid's section through its middle.
      rotation: quatFromFrame(f.w, up)
    }
  }
  return {
    kind: shape.kind === "rectangle" ? "box" : "cylinder",
    center: world(shape.cu, shape.cv),
    half: { x: shape.ru * f.pixel, y: shape.rv * f.pixel, z: depth / 2 },
    rotation: quatFromFrame(vecAdd(vecScale(f.u, Math.cos(shape.angle)), vecScale(f.v, Math.sin(shape.angle))), f.w)
  }
}

/** A proposal with an upper bound on what it is worth: its worth when last measured, which only falls. */
interface Queued {
  readonly proposal: Proposal
  readonly bound: number
}

/**
 * What a part's footprint still has uncovered, and what each proposal is worth against it: the pixels of its own layer
 * it newly covers, less a little for each it covers again and more for each it spills.
 */
class Uncovered {
  /** The layer that owns each pixel, -1 for none. */
  private readonly owner: Int32Array
  private readonly open: Uint8Array
  readonly total: number
  left: number

  constructor(f: Footprint, layers: ReadonlyArray<Layer>) {
    this.owner = new Int32Array(f.mask.length).fill(-1)
    this.open = f.mask.slice()
    let total = 0
    layers.forEach((layer, k) => {
      for (let i = 0; i < layer.own.length; i++) {
        if (at(layer.own, i) === 0) continue
        this.owner[i] = k
        total++
      }
    })
    this.total = total
    this.left = total
  }

  private gains(p: Proposal, i: number): boolean {
    return at(this.open, i) === 1 && at(this.owner, i) === p.layer
  }

  worth(p: Proposal): number {
    let gain = 0
    for (const i of p.pixels) if (this.gains(p, i)) gain++
    return gain - OVERLAP_COST * (p.pixels.length - gain) - SPILL_COST * p.spill
  }

  cover(p: Proposal): void {
    for (const i of p.pixels) {
      if (!this.gains(p, i)) continue
      this.open[i] = 0
      this.left--
    }
  }
}

/**
 * Takes the proposal worth the most off `queue`, which is in order of bound, highest first; undefined when the best is
 * worth less than `least`. Lazy greedy: a bound is never under the worth, so the first proposal whose fresh worth is
 * no less than the next one's bound is the best. One that falls short goes back in order with its fresh worth.
 */
const takeBest = (queue: Array<Queued>, uncovered: Uncovered, least: number): Proposal | undefined => {
  for (let top = queue[0]; top !== undefined; top = queue[0]) {
    const fresh = uncovered.worth(top.proposal)
    if (fresh >= (queue[1]?.bound ?? -Infinity)) {
      queue.shift()
      return fresh >= least ? top.proposal : undefined
    }
    let k = 1
    for (let next = queue[k]; next !== undefined && next.bound > fresh; next = queue[++k]) queue[k - 1] = next
    queue[k - 1] = { proposal: top.proposal, bound: fresh }
  }
  return undefined
}

/**
 * One part's covers, greedily: the proposal covering the most of what is left, net of spill, each time, up to `most`
 * pieces. Undefined when time runs out; the clock is read once a piece.
 */
const coversOf = (
  f: Footprint,
  layers: ReadonlyArray<Layer>,
  most: number,
  deadline: number
): Array<ProfileCover> | undefined => {
  const uncovered = new Uncovered(f, layers)
  const queue = proposalsOf(f, layers)
    .map((proposal): Queued => ({ proposal, bound: uncovered.worth(proposal) }))
    .sort((a, b) => b.bound - a.bound)
  const least = Math.max(GAIN_PIXELS, GAIN_LEAST * uncovered.total)
  const placements: Array<Placement> = [], covers: Array<ProfileCover> = []
  const keep = () => {
    if (covers.at(-1)?.placements.length === placements.length) return
    covers.push({ placements: placements.slice(), uncovered: uncovered.left / uncovered.total })
  }
  let step = 0
  while (placements.length < most) {
    if (now() > deadline) return undefined
    const best = takeBest(queue, uncovered, least)
    if (best === undefined) break
    placements.push(placementOf(f, layers, best))
    uncovered.cover(best)
    for (; step < COVER_STEPS.length && uncovered.left / uncovered.total < (COVER_STEPS[step] ?? 0); step++) keep()
  }
  keep()
  return covers
}

/** One part's covers, or undefined when it isn't a profile or time ran out; the clock is read once an axis. */
const partCovers = (part: Component, most: number, deadline: number): Array<ProfileCover> | undefined => {
  for (const facing of axesOf(part)) {
    if (now() > deadline) return undefined
    const toward = part.axes.find((other) => Math.abs(vecDot(other, facing.axis)) < 0.7) ?? part.axes[0]
    const f = footprintOf(part.triangles, facing.axis, toward)
    if (f === undefined || !prismatic(f, facing)) continue
    const covers = coversOf(f, layersOf(f), most, deadline)
    if (covers === undefined) return undefined
    if ((covers.at(-1)?.uncovered ?? 1) <= ACCEPT_LEFT) return covers
  }
  return undefined
}

/**
 * A profile piece made narrower across its outline by `narrow`, on its shorter side only, and thinner along its sweep
 * by `depth`: a bevelled edge reads thinner than the part's full depth, and bars that touch read apart when narrower.
 */
export const narrowed = (piece: Placement, narrow: number, depth: number): Placement => {
  const { x, y, z } = piece.half
  // A pyramid lies with local x through its thickness (`placementOf`); a box or cylinder with local z.
  if (piece.kind === "pyramid") return { ...piece, half: { x: x * depth, y, z } }
  if (piece.kind === "sphere") return piece
  return { ...piece, half: { x: x < y ? x * narrow : x, y: y <= x ? y * narrow : y, z: z * depth } }
}

/**
 * The model's parts that read as flat profiles, each with its covers, and everything else as the remainder: a part
 * that fails, or that the work time leaves unfinished, is never dropped. The clock is read once a part.
 */
export const profileSplit = (source: Float32Array, options: ProfileOptions): ProfileSplit => {
  const deadline = now() + PROFILE_WORK_MS
  const most = Math.min(MOST_PIECES, Math.max(1, Math.floor(options.budget)))
  const parts: Array<ProfilePart> = [], rest: Array<Float32Array> = []
  for (const triangles of componentsOf(source).sort((a, b) => b.length - a.length)) {
    const part = measured(triangles)
    const skipped = now() > deadline || 2 * part.half[0] < (options.least ?? 0)
    const covers = skipped ? undefined : partCovers(part, most, deadline)
    if (covers === undefined) rest.push(triangles)
    else parts.push({ triangles, area: part.area, covers })
  }
  return { parts, remainder: joined(rest) }
}
