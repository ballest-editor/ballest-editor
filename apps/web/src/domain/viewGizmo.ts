/**
 * The axis gizmo in a pane's corner (docs/DESKTOP.md § View panes): the six ends of the game's axes as the pane's picture
 * turns them, and the view each one snaps to. Everything here is in game space.
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

/** Under a twentieth of a pixel on the gizmo: not worth drawing again. */
const SAME_END = 0.002

/** Whether two readings of the ends draw the same. */
export const sameGizmoEnds = (a: ReadonlyArray<GizmoEnd>, b: ReadonlyArray<GizmoEnd>): boolean =>
  a.length === b.length && a.every((end, i) => {
    const other = b[i]
    return other !== undefined && end.view === other.view && Math.abs(end.x - other.x) < SAME_END
      && Math.abs(end.y - other.y) < SAME_END && Math.abs(end.depth - other.depth) < SAME_END
  })
