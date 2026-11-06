/**
 * What one snap is worked out on (docs/SNAPPING.md § The model), in game space: the view that measures distances in
 * pixels, the constraint a drag moves under, the points of the selection that can land, and what a target answers with.
 * No renderer here: the editor hands in a view and, for what needs a raycast, `surfaceAt` and `occluded`.
 */
import type { Bounds } from "./Catalog"
import type { WorldEnd } from "./connectors"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import type { Box } from "./itemBounds"
import type { Construction, EndRef, Measurement } from "./MapSidecar"
import type { WorldMesh } from "./meshElements"
import type { SnapConfig, SnapTarget } from "./snapConfig"
import { vecAdd, vecCross, vecDot, vecLength, vecNormalize, vecScale, vecSub } from "./ueMath"

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface Ray {
  readonly origin: Vec3
  /** Unit length. */
  readonly direction: Vec3
}

/** One pane, as snapping sees it. */
export interface SnapView {
  /** Where a point shows, in the pane's pixels; undefined behind the camera. */
  readonly project: (point: Vec3) => ScreenPoint | undefined
  readonly rayAt: (px: ScreenPoint) => Ray
  /** The cm one pixel covers at `point`. */
  readonly cmPerPixelAt: (point: Vec3) => number
  /** Into the screen, at `point`. */
  readonly directionAt: (point: Vec3) => Vec3
  readonly orthographic: boolean
  /** Whether a box shows in the pane at all. */
  readonly inView: (box: Box) => boolean
}

/**
 * Where a move can go. A `line` and a `plane` are hard: a target only sets the value along them, as a handle or a lock
 * does. A `surface` plane is what a drag by the item's body slides on when nothing is near, and a target lifts it off.
 */
export type Constraint =
  | { readonly kind: "line"; readonly direction: Vec3 }
  | { readonly kind: "plane"; readonly normal: Vec3 }
  | { readonly kind: "surface"; readonly normal: Vec3 }

/** A point of the selection that can land on a target. */
export interface BasePoint {
  /** Where it is at the drag's start. */
  readonly start: Vec3
  /** "Corner", "End": what the label calls it. */
  readonly label: string
  /** The end it is, for a piece with ends. */
  readonly end?: WorldEnd
}

/** What a target is, for sliding along it, and for telling when a drag gets to it. */
export type HeldShape =
  | { readonly shape: "point"; readonly at: Vec3 }
  | { readonly shape: "line"; readonly origin: Vec3; readonly direction: Vec3 }
  | { readonly shape: "segment"; readonly from: Vec3; readonly to: Vec3 }
  | { readonly shape: "plane"; readonly origin: Vec3; readonly normal: Vec3 }

/** How a target shows while it is current, each in its own way (docs/SNAPPING.md § What a drag looks like). */
export type SnapMark =
  | { readonly kind: "dot"; readonly at: Vec3 }
  | { readonly kind: "line"; readonly from: Vec3; readonly to: Vec3 }
  | { readonly kind: "face"; readonly corners: ReadonlyArray<Vec3> }
  | { readonly kind: "guide"; readonly from: Vec3; readonly to: Vec3; readonly text?: string }
  | { readonly kind: "tracking"; readonly from: Vec3; readonly to: Vec3; readonly axis: "x" | "y" | "z" | "view" }
  | { readonly kind: "ring"; readonly at: Vec3 }

/** A connector snap: the two ends, and what the profiles say. */
export interface EndMeeting {
  readonly own: EndRef
  readonly other: EndRef
  /** The chip's words when the profiles differ under Warn. */
  readonly warning?: string
  /** The mirrored twin would fit, and this piece doesn't. */
  readonly flipFits?: boolean
}

/** What a target answers with: the point the base lands on, and how to say so. */
export interface SnapHit {
  readonly target: SnapTarget
  /** A point beats an edge beats a face within a target, whatever the pixels. */
  readonly rank: 0 | 1 | 2
  /** From the base, in pixels. */
  readonly distance: number
  readonly base: BasePoint
  readonly landing: Vec3
  /** The turn the selection takes about the base, when the target asks for one. */
  readonly rotation?: Quat4
  readonly label: string
  readonly marks: ReadonlyArray<SnapMark>
  readonly held: HeldShape
  /** The item the target is on. */
  readonly item?: string
  readonly meeting?: EndMeeting
  /** The renderer's own first face under the pixel: nothing can hide it. */
  readonly frontmost?: boolean
  /** The single targets this one lands on together: an alignment along each of the move's axes. */
  readonly parts?: ReadonlyArray<SnapHit>
}

/** An item that isn't being moved, as a target. */
export interface SnapItem {
  readonly key: string
  /** What the label calls it: "Track L". */
  readonly name: string
  /** Its world-aligned box. */
  readonly box: Box
  readonly transform: UeTransform
  /** Its local bounds, when known. */
  readonly bounds: Bounds | undefined
  readonly ends: ReadonlyArray<WorldEnd>
  /** Its mesh's elements, worked out when something near asks. */
  readonly mesh: () => WorldMesh | undefined
}

/** A face under the pointer, from the renderer. */
export interface SurfaceHit {
  readonly point: Vec3
  /** Out of the face, unit length. */
  readonly normal: Vec3
  readonly item: string
  /** The triangle, for the tint. */
  readonly corners: ReadonlyArray<Vec3>
}

/** A point acquired by hovering, with what it is on. */
export interface TrackedPoint {
  readonly at: Vec3
  readonly label: string
}

export interface SnapFrame {
  readonly config: SnapConfig
  readonly view: SnapView
  readonly items: ReadonlyArray<SnapItem>
  readonly constraint: Constraint
  /** Where the pointer is, in the pane's pixels. */
  readonly pointer: ScreenPoint
  /** The move as the pointer alone would make it. */
  readonly offset: Vec3
  /** How far the pointer is from where the move took it, in pixels: only a line leaves it off the selection. */
  readonly slip: ScreenPoint
  readonly bases: ReadonlyArray<BasePoint>
  /** The selection's box at the drag's start. */
  readonly box: Box
  /** The active unit's axes at the drag's start, which Rotate to face measures from. */
  readonly rotation: Quat4
  readonly units: "cm" | "m"
  readonly tracked: ReadonlyArray<TrackedPoint>
  readonly construction: ReadonlyArray<Construction>
  readonly measurements: ReadonlyArray<Measurement>
  /** Whole steps along these axes in place of the grid's lines: a handle on the item's own axes. */
  readonly stepAxes?: ReadonlyArray<Vec3>
  /** The first face under a pixel, leaving out what is moving. */
  readonly surfaceAt?: (px: ScreenPoint) => SurfaceHit | undefined
  /** Whether something hides `point` from the pane's camera. */
  readonly occluded?: (point: Vec3) => boolean
}

/** Where a base stands under the free move. */
export const freePoint = (frame: Pick<SnapFrame, "offset">, base: BasePoint): Vec3 => vecAdd(base.start, frame.offset)

/** The pixel a base is measured from: where it shows under the free move, plus what the pointer is off it. */
export const referenceOf = (
  frame: Pick<SnapFrame, "offset" | "slip" | "view">,
  base: BasePoint
): ScreenPoint | undefined => {
  const shown = frame.view.project(freePoint(frame, base))
  return shown === undefined ? undefined : { x: shown.x + frame.slip.x, y: shown.y + frame.slip.y }
}

export const pixelDistance = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The landing a constraint lets a base reach: a line and a plane only take the value along them. */
export const constrained = (constraint: Constraint, start: Vec3, landing: Vec3): Vec3 => {
  const moved = vecSub(landing, start)
  switch (constraint.kind) {
    case "line":
      return vecAdd(start, vecScale(constraint.direction, vecDot(moved, constraint.direction)))
    case "plane":
      return vecSub(landing, vecScale(constraint.normal, vecDot(moved, constraint.normal)))
    case "surface":
      return landing
  }
}

/** The directions a constraint can move along. */
export const axesOf = (constraint: Constraint): ReadonlyArray<Vec3> => {
  if (constraint.kind === "line") return [constraint.direction]
  const { normal } = constraint
  const helper = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }
  const u = vecNormalize(vecCross(helper, normal))
  return [u, vecCross(normal, u)]
}

/** Where `ray` meets the plane; undefined when it runs along it or points away. */
export const rayOnPlane = (ray: Ray, origin: Vec3, normal: Vec3): Vec3 | undefined => {
  const facing = vecDot(normal, ray.direction)
  if (Math.abs(facing) < 1e-9) return undefined
  const t = vecDot(vecSub(origin, ray.origin), normal) / facing
  return t < 0 ? undefined : vecAdd(ray.origin, vecScale(ray.direction, t))
}

/** The point of the line nearest `ray`; undefined when the two run together. */
export const lineNearRay = (origin: Vec3, direction: Vec3, ray: Ray): Vec3 | undefined => {
  const w = vecSub(origin, ray.origin)
  const b = vecDot(direction, ray.direction)
  const denominator = 1 - b * b
  if (denominator < 1e-9) return undefined
  const t = (b * vecDot(ray.direction, w) - vecDot(direction, w)) / denominator
  return vecAdd(origin, vecScale(direction, t))
}

/** The point of the segment nearest `ray`. */
export const segmentNearRay = (from: Vec3, to: Vec3, ray: Ray): Vec3 => {
  const along = vecSub(to, from)
  const length = vecLength(along)
  if (length === 0) return from
  const direction = vecScale(along, 1 / length)
  const near = lineNearRay(from, direction, ray) ?? from
  const t = Math.max(0, Math.min(length, vecDot(vecSub(near, from), direction)))
  return vecAdd(from, vecScale(direction, t))
}

/** How far the pointer's ray has moved what started under `from`, under a constraint; undefined when the ray can't say. */
export const freeOffset = (constraint: Constraint, origin: Vec3, from: Ray, to: Ray): Vec3 | undefined => {
  if (constraint.kind === "line") {
    const start = lineNearRay(origin, constraint.direction, from)
    const now = lineNearRay(origin, constraint.direction, to)
    return start === undefined || now === undefined ? undefined : vecSub(now, start)
  }
  const start = rayOnPlane(from, origin, constraint.normal)
  const now = rayOnPlane(to, origin, constraint.normal)
  return start === undefined || now === undefined ? undefined : vecSub(now, start)
}

/** The landing on a held shape for a pointer ray. */
export const landingOn = (held: HeldShape, ray: Ray, free: Vec3): Vec3 => {
  switch (held.shape) {
    case "point":
      return held.at
    case "line":
      return lineNearRay(held.origin, held.direction, ray) ?? held.origin
    case "segment":
      return segmentNearRay(held.from, held.to, ray)
    case "plane":
      return vecSub(free, vecScale(held.normal, vecDot(vecSub(free, held.origin), held.normal)))
  }
}
