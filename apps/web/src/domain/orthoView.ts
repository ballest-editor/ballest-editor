/**
 * Orthographic panes in the game's terms (docs/DESKTOP.md § View panes): what each view looks along, how it frames and
 * zooms, and the world grid's levels. Everything here is in game space (UE: left-handed, Z up, X forward, Y right, cm);
 * `editor/paneCameras.ts` takes it to the renderer's frame through coords.ts.
 */
import type { Vec3 } from "./coords"
import { type OrthoView, orthoViews } from "./viewLayout"

export interface OrthoAxes {
  /** Where the view looks. */
  readonly forward: Vec3
  /** What points up the screen. */
  readonly up: Vec3
  /** What points right on the screen: up × forward, as UE is left-handed. */
  readonly right: Vec3
}

const X = { x: 1, y: 0, z: 0 }
const Y = { x: 0, y: 1, z: 0 }
const Z = { x: 0, y: 0, z: 1 }
const minus = (v: Vec3): Vec3 => ({ x: 0 - v.x, y: 0 - v.y, z: 0 - v.z })

/**
 * Named the way a person stands around the map, facing it: Front stands on the +X side (X is the game's forward), Right
 * on the +Y side. Top keeps X up the screen and Y to the right, as if looking down while facing forward.
 */
export const ORTHO_AXES: Readonly<Record<OrthoView, OrthoAxes>> = {
  top: { forward: minus(Z), up: X, right: Y },
  bottom: { forward: Z, up: X, right: minus(Y) },
  front: { forward: minus(X), up: Z, right: minus(Y) },
  back: { forward: X, up: Z, right: Y },
  left: { forward: Y, up: Z, right: minus(X) },
  right: { forward: minus(Y), up: Z, right: X }
}

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export type GameAxis = "x" | "y" | "z"

/** The game axis a view's unit direction runs along, and which way. */
export const axisOf = (direction: Vec3): { readonly axis: GameAxis; readonly positive: boolean } => {
  const axis = direction.x !== 0 ? "x" : direction.y !== 0 ? "y" : "z"
  return { axis, positive: direction[axis] > 0 }
}

/** The view closest to looking along `forward` (game space). */
export const nearestOrthoView = (forward: Vec3): OrthoView =>
  orthoViews.reduce((best, view) =>
    dot(forward, ORTHO_AXES[view].forward) > dot(forward, ORTHO_AXES[best].forward) ? view : best
  )

/** How far a pane can zoom: 1 px = 0.02 cm in, 1 px = 50 m out. */
const MIN_CM_PER_PIXEL = 0.02
const MAX_CM_PER_PIXEL = 5000

export const clampCmPerPixel = (cmPerPixel: number): number =>
  Math.min(MAX_CM_PER_PIXEL, Math.max(MIN_CM_PER_PIXEL, cmPerPixel))

/** The room left around what a pane frames. */
const FRAME_MARGIN = 1.15

/**
 * The centre and zoom that show `bounds` whole in a pane of this size. `minimumSpan` (cm) keeps a single small piece or
 * an empty map from filling the pane.
 */
export const orthoFraming = (
  bounds: { readonly min: Vec3; readonly max: Vec3 },
  view: OrthoView,
  width: number,
  height: number,
  minimumSpan = 0
): { readonly center: Vec3; readonly cmPerPixel: number } => {
  const { right, up } = ORTHO_AXES[view]
  const size = { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y, z: bounds.max.z - bounds.min.z }
  const across = Math.max(Math.abs(dot(size, right)), minimumSpan)
  const along = Math.max(Math.abs(dot(size, up)), minimumSpan)
  return {
    center: {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    },
    cmPerPixel: clampCmPerPixel(FRAME_MARGIN * Math.max(across / Math.max(width, 1), along / Math.max(height, 1)))
  }
}

/** A wheel's `deltaY` as a zoom factor: about 1.2 a notch, and proportionate on a trackpad. */
export const wheelZoomFactor = (deltaY: number): number => Math.exp(deltaY * 0.0015)

/**
 * Zooming by `factor` about a pointer (pixels from the pane's centre, y up): the new zoom, and how far the centre moves
 * (cm along the view's right and up) to leave the point under the pointer where it is. At a zoom limit nothing slides.
 */
export const zoomAtPointer = (
  cmPerPixel: number,
  factor: number,
  pointer: { readonly x: number; readonly y: number }
): { readonly cmPerPixel: number; readonly right: number; readonly up: number } => {
  const next = clampCmPerPixel(cmPerPixel * factor)
  const shift = cmPerPixel - next
  return { cmPerPixel: next, right: pointer.x * shift, up: pointer.y * shift }
}

/**
 * How far back a perspective camera with this vertical FOV stands for a point to show at `cmPerPixel` in a pane this
 * tall, and the reverse: what keeps the picture the same size when a pane changes projection.
 */
export const distanceForScale = (cmPerPixel: number, paneHeight: number, fovDeg: number): number =>
  (cmPerPixel * paneHeight) / 2 / Math.tan((fovDeg * Math.PI) / 360)

export const scaleForDistance = (distance: number, paneHeight: number, fovDeg: number): number =>
  (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(paneHeight, 1)

/** A field of view `t` of the way from `from` to `to`, even to the eye: it's the frustum's width that eases, not the angle. */
export const mixFov = (from: number, to: number, t: number): number => {
  const half = (fovDeg: number) => Math.tan((fovDeg * Math.PI) / 360)
  return (Math.atan(half(from) * (half(to) / half(from)) ** t) * 360) / Math.PI
}

/** Where a palette piece goes in an orthographic pane: the pane's centre, on the floor when looking at the floor. */
export const orthoPlacementPoint = (center: Vec3, view: OrthoView, floor: number): Vec3 => ({
  x: Math.round(center.x) + 0,
  y: Math.round(center.y) + 0,
  z: Math.round(view === "top" || view === "bottom" ? floor : center.z) + 0
})

/** One set of parallel lines in the world grid. */
export interface GridLevel {
  /** Line spacing in cm. */
  readonly size: number
  /** 0 to 1: a level fades in as its lines get far enough apart to read. */
  readonly opacity: number
  /** Drawn in the section colour: 10 m and up. */
  readonly section: boolean
}

/** The grid in decades of cm: 1 m lines and 10 m sections as in the perspective floor grid, 1 and 10 cm once close in. */
const GRID_SIZES_CM = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000] as const

/** The most levels `gridLevels` can give: every decade and the snapping step. Sized for the shader's uniform array. */
export const MAX_GRID_LEVELS = GRID_SIZES_CM.length + 1

/** Lines closer than this (px) aren't drawn; by this many they are at full strength. */
const GRID_FADE_FROM_PX = 6
const GRID_FADE_TO_PX = 30

const SECTION_CM = 1000

const smoothstep = (from: number, to: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * The grid levels to draw at this zoom, finest first. Lines sit on multiples of their size, as the snapping grid does
 * (`snapValue`), so a step that is no decade (25 cm) gets a level of its own while snapping is on.
 */
export const gridLevels = (cmPerPixel: number, snapStep?: number): ReadonlyArray<GridLevel> =>
  [...new Set<number>([...GRID_SIZES_CM, ...(snapStep === undefined ? [] : [snapStep])])]
    .sort((a, b) => a - b)
    .flatMap((size) => {
      const opacity = smoothstep(GRID_FADE_FROM_PX, GRID_FADE_TO_PX, size / cmPerPixel)
      return opacity > 0 ? [{ size, opacity, section: size >= SECTION_CM }] : []
    })
