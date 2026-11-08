/**
 * What Rotate and Scale snap to (docs/SNAPPING.md § Affect): the step, and a face or end in range. A turn stops where
 * the base face comes flush with a target, and a scale where the scaled face comes onto one. Over a step either way, as
 * these are what the user is reaching for.
 */
import type { Vec3 } from "./coords"
import { snapValue } from "./snap"
import type { SnapMark, SnapRelation } from "./snapFrame"
import { glyphMark, turnedMarks } from "./snapRelation"
import { vecCross, vecDot, vecLength, vecScale, vecSub } from "./ueMath"

/** A direction of the selection and one it can be turned to meet. */
export interface FlushPair {
  /** Out of the base face, or the piece's end. */
  readonly normal: Vec3
  /** Out of the target. */
  readonly target: Vec3
  readonly label: string
  readonly relation: SnapRelation
  /** The target: a face or an end. */
  readonly marks: ReadonlyArray<SnapMark>
  /** The base face or the end of the selection, before the turn. */
  readonly source: ReadonlyArray<SnapMark>
  /** Where the glyph goes: on the target. */
  readonly at: Vec3
}

/** A turn or scale as it snapped, for the label: what to say and the glyph to say it with. */
export interface SnappedAs {
  readonly label?: string
  readonly relation?: SnapRelation
  /** Both sides, the source where the snap puts it, and the glyph. */
  readonly marks?: ReadonlyArray<SnapMark>
}

export interface SnappedTurn extends SnappedAs {
  /** Radians. */
  readonly angle: number
}

/** How far out of the turn's plane two directions can be and still meet. */
const LEVEL = 1e-3

const flattened = (v: Vec3, axis: Vec3) => vecSub(v, vecScale(axis, vecDot(v, axis)))

/** The turn about the unit `axis` that makes `normal` face against `target`, nearest `free`; undefined when none can. */
const flushAngle = ({ normal, target }: FlushPair, axis: Vec3, free: number): number | undefined => {
  if (Math.abs(vecDot(normal, axis) + vecDot(target, axis)) > LEVEL) return undefined
  const from = flattened(normal, axis)
  const to = vecScale(flattened(target, axis), -1)
  if (vecLength(from) < LEVEL || vecLength(to) < LEVEL) return undefined
  const angle = Math.atan2(vecDot(vecCross(from, to), axis), vecDot(from, to))
  const turns = Math.round((free - angle) / (Math.PI * 2))
  return angle + turns * Math.PI * 2
}

/** Where a turn the pointer put at `free` radians lands: flush with a target in `reach`, else on the step in degrees. */
export const snappedTurn = (
  { about, axis, flush, free, reach, step }: {
    readonly free: number
    readonly axis: Vec3
    /** The pivot the turn is about. */
    readonly about: Vec3
    readonly step?: number | undefined
    readonly flush: ReadonlyArray<FlushPair>
    readonly reach: number
  }
): SnappedTurn => {
  const near = flush.flatMap((pair) => {
    const angle = flushAngle(pair, axis, free)
    return angle === undefined || Math.abs(angle - free) > reach ? [] : [{ angle, pair }]
  }).sort((a, b) => Math.abs(a.angle - free) - Math.abs(b.angle - free))[0]
  if (near !== undefined) {
    const { angle, pair } = near
    return {
      angle,
      label: pair.label,
      relation: pair.relation,
      marks: [...pair.marks, ...turnedMarks(pair.source, { about, axis, angle }), glyphMark(pair.relation, pair.at)]
    }
  }
  return { angle: step === undefined ? free : snapValue(free * 180 / Math.PI, step) * Math.PI / 180 }
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
