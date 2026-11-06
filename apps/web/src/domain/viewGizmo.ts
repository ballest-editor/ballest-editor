/**
 * The axis gizmo in a pane's corner (docs/DESKTOP.md § View panes): the six ends of the game's axes as the pane's picture
 * turns them, the view each one snaps to, and how a drag on it turns the pane. The ends are in game space.
 */
import type { Vec3 } from "./coords"
import { dot, type GameAxis } from "./orthoView"
import type { OrthoView } from "./viewLayout"

/** Which way a picture runs: unit vectors along the screen's right and up, and out of it toward the eye. */
export interface ScreenAxes {
  readonly right: Vec3
  readonly up: Vec3
  readonly toward: Vec3
}

export interface GizmoEnd {
  readonly axis: GameAxis
  readonly positive: boolean
  /** The view a click on this end snaps to. */
  readonly view: OrthoView
  /** Where the end sits, as a share of the gizmo's radius from its centre: x to the right, y up. */
  readonly x: number
  readonly y: number
  /** How far it comes out of the picture: 1 straight at the eye, -1 straight away. */
  readonly depth: number
}

/**
 * The view an end snaps to, with Blender's names for its gizmo's ends: X is Right, Y is Back and Z is Top. In the
 * game's terms that's the view with X or Y running across the screen to the right (`ORTHO_AXES`), or looking down on Z.
 */
const END_VIEWS: Readonly<Record<GameAxis, { readonly positive: OrthoView; readonly negative: OrthoView }>> = {
  x: { positive: "right", negative: "left" },
  y: { positive: "back", negative: "front" },
  z: { positive: "top", negative: "bottom" }
}

export const gizmoViewOf = (axis: GameAxis, positive: boolean): OrthoView =>
  END_VIEWS[axis][positive ? "positive" : "negative"]

const AXES: ReadonlyArray<readonly [GameAxis, Vec3]> = [
  ["x", { x: 1, y: 0, z: 0 }],
  ["y", { x: 0, y: 1, z: 0 }],
  ["z", { x: 0, y: 0, z: 1 }]
]

/** An end this close to the gizmo's centre is looked along, and would only cover the centre: hidden, like a handle end-on. */
const END_ON = 0.3

/** The ends a picture running along `axes` shows. */
export const gizmoEnds = ({ right, up, toward }: ScreenAxes): ReadonlyArray<GizmoEnd> =>
  AXES.flatMap(([axis, direction]) =>
    [true, false].flatMap((positive) => {
      const sign = positive ? 1 : -1
      const x = sign * dot(direction, right)
      const y = sign * dot(direction, up)
      if (Math.hypot(x, y) < END_ON) return []
      return [{ axis, positive, view: gizmoViewOf(axis, positive), x, y, depth: sign * dot(direction, toward) }]
    })
  )

/** How far a press on the gizmo moves before it's a drag and not a click (px). */
const DRAG_START_PX = 4

/** Whether a press on the gizmo that has moved this far is a drag. */
export const isGizmoDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_START_PX

/** What a drag on the gizmo turns the pane by for each pixel (radians): Blender's 0.4°. */
const TURN_PER_PIXEL = (0.4 * Math.PI) / 180

/**
 * What a pointer's move of `dx` and `dy` pixels (y down) turns the pane by, for `PaneCamera.orbit`. The side of the gizmo
 * that faces the eye goes with the pointer, as if it were held: right swings the camera left, down lifts it.
 */
export const gizmoTurnOf = (dx: number, dy: number): { readonly yaw: number; readonly pitch: number } => ({
  yaw: -dx * TURN_PER_PIXEL,
  pitch: -dy * TURN_PER_PIXEL
})

/** Under a twentieth of a pixel on the gizmo: not worth drawing again. */
const SAME_END = 0.002

/** Whether two readings of the ends draw the same. */
export const sameGizmoEnds = (a: ReadonlyArray<GizmoEnd>, b: ReadonlyArray<GizmoEnd>): boolean =>
  a.length === b.length && a.every((end, i) => {
    const other = b[i]
    return other !== undefined && end.view === other.view && Math.abs(end.x - other.x) < SAME_END
      && Math.abs(end.y - other.y) < SAME_END && Math.abs(end.depth - other.depth) < SAME_END
  })
