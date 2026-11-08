/**
 * What a snap shows of itself (docs/SNAPPING.md § Snap indications): the part of the selection that landed, what it
 * landed on, and the glyph of the relation between them. Geometry only; the overlay picks the colours and shapes.
 */
import type { Vec3 } from "./coords"
import { landedPoint } from "./groupTransform"
import { type Box, boxCentreOf } from "./itemBounds"
import type { BasePoint, MarkRole, SnapHit, SnapMark, SnapRelation } from "./snapFrame"
import { IDENTITY_QUAT, quatFromAxisAngle, rotateVec, vecAdd, vecDot, vecScale, vecSub } from "./ueMath"

/** Closer than this, in cm, a corner is on the side. */
const ON_SIDE_CM = 1e-3

export const cornersOf = ({ max, min }: Box): ReadonlyArray<Vec3> =>
  [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z }))))

/** `point` moved along the unit `axis` onto the plane at `value` along it. */
export const ontoPlane = (point: Vec3, axis: Vec3, value: number): Vec3 =>
  vecAdd(point, vecScale(axis, value - vecDot(point, axis)))

/**
 * The side of a box furthest along `direction`, as a mark: a face when the direction is one of the box's axes, else
 * the edge or corner that stands out furthest.
 */
export const sideOf = (box: Box, direction: Vec3, role: MarkRole, outline = false): SnapMark => {
  const corners = cornersOf(box)
  const far = Math.max(...corners.map((corner) => vecDot(corner, direction)))
  const on = corners.filter((corner) => vecDot(corner, direction) >= far - ON_SIDE_CM)
  const [a, b, c, d] = on
  // the corners come in the order of a binary count over the two axes the face spans, so 0, 1, 3, 2 goes round it
  if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
    return { kind: "face", role, corners: [a, b, d, c], ...(outline && { outline }) }
  }
  if (a !== undefined && b !== undefined) return { kind: "line", role, from: a, to: b }
  return { kind: "dot", role, at: a ?? boxCentreOf(box) }
}

/** What of the selection a base is, where it stands at the drag's start: an end, a face of its box, or a point. */
export const sourceOf = (box: Box, base: BasePoint): ReadonlyArray<SnapMark> => {
  if (base.end !== undefined) return [{ kind: "ring", role: "source", at: base.start }]
  if (base.stop?.kind === "face") {
    const { axis } = base.stop
    const outward = vecDot(vecSub(base.start, boxCentreOf(box)), axis) < 0 ? vecScale(axis, -1) : axis
    return [sideOf(box, outward, "source")]
  }
  return [{ kind: "dot", role: "source", at: base.start }]
}

/** `mark` with its points taken by `at` and its directions by `turn`. */
const movedMark = (mark: SnapMark, at: (point: Vec3) => Vec3, turn: (direction: Vec3) => Vec3): SnapMark => {
  switch (mark.kind) {
    case "dot":
    case "ring":
    case "glyph":
      return { ...mark, at: at(mark.at) }
    case "line":
    case "guide":
    case "tracking":
      return { ...mark, from: at(mark.from), to: at(mark.to) }
    case "face":
      return { ...mark, corners: mark.corners.map(at) }
    case "arrow":
      return { ...mark, at: at(mark.at), direction: turn(mark.direction) }
  }
}

/** `marks` turned by `angle` radians about the unit `axis` through `about`, as a turn takes the selection. */
export const turnedMarks = (
  marks: ReadonlyArray<SnapMark>,
  { about, angle, axis }: { readonly about: Vec3; readonly axis: Vec3; readonly angle: number }
): ReadonlyArray<SnapMark> => {
  const rotation = quatFromAxisAngle(axis, angle)
  const turn = (direction: Vec3) => rotateVec(rotation, direction)
  return marks.map((mark) => movedMark(mark, (point) => vecAdd(about, turn(vecSub(point, about))), turn))
}

/** `marks` moved by `offset`, as a scale moves the face it stops. */
export const shiftedMarks = (marks: ReadonlyArray<SnapMark>, offset: Vec3): ReadonlyArray<SnapMark> =>
  marks.map((mark) => movedMark(mark, (point) => vecAdd(point, offset), (direction) => direction))

export const glyphMark = (relation: SnapRelation, at: Vec3): SnapMark => ({ kind: "glyph", relation, at })

/**
 * Everything a hit draws: what it landed on, the part of the selection that landed where the hit takes it, and the
 * relation's glyph at the landing. A pick has no selection, so `source` leaves it out.
 */
export const shownMarks = (
  hit: SnapHit,
  { source = true }: { readonly source?: boolean } = {}
): ReadonlyArray<SnapMark> => {
  const delta = {
    kind: "rigid" as const,
    about: hit.base.start,
    rotation: hit.rotation ?? IDENTITY_QUAT,
    offset: vecSub(hit.landing, hit.base.start)
  }
  const moved = source
    ? hit.source.map((mark) =>
      movedMark(mark, (point) => landedPoint(point, delta), (direction) => rotateVec(delta.rotation, direction))
    )
    : []
  return [...hit.marks, ...moved, glyphMark(hit.relation, hit.landing)]
}
