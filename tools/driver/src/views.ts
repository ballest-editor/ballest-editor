import type { Vec3 } from "./handler.ts"

// The standard views of a piece (docs/DRIVER.md § Piece views): fixed names and directions, so renders of two pieces,
// or of one piece across two game versions, line up. Pure camera arithmetic; the game's frame is UE's (cm, Z up,
// left-handed; pitch up, yaw around Z).

export interface View {
  readonly name: string
  /** From the piece's centre towards the camera, any length. */
  readonly from: Vec3
}

export const STANDARD_VIEWS: ReadonlyArray<View> = [
  { name: "front", from: [-1, 0, 0.4] },
  { name: "back", from: [1, 0, 0.4] },
  { name: "left", from: [0, -1, 0.4] },
  { name: "right", from: [0, 1, 0.4] },
  { name: "top", from: [0, -0.001, 1] },
  { name: "bottom", from: [0, -0.001, -1] },
  { name: "front-left", from: [-1, -1, 0.6] },
  { name: "back-right", from: [1, 1, 0.6] }
]

export interface Camera {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly pitch: number
  readonly yaw: number
  readonly fov: number
}

const DEGREES = 180 / Math.PI
/** The render is 1280x720; the game's fov is the horizontal one. */
const ASPECT = 16 / 9
const MARGIN = 1.15

/**
 * A camera on `view`'s side of a box that fits the box's bounding sphere in the frame: looking at the centre, far
 * enough for the sphere to fit the narrower (vertical) field of view, with a margin.
 */
export const frame = (bounds: { readonly min: Vec3; readonly max: Vec3 }, view: View, fov = 60): Camera => {
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const center: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
  const radius = Math.max(1, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2)
  const vertical = 2 * Math.atan(Math.tan(fov / 2 / DEGREES) / ASPECT)
  const distance = radius * MARGIN / Math.sin(vertical / 2)
  const length = Math.hypot(...view.from)
  const dir: Vec3 = [view.from[0] / length, view.from[1] / length, view.from[2] / length]
  const forward: Vec3 = [-dir[0], -dir[1], -dir[2]]
  return {
    x: center[0] + dir[0] * distance,
    y: center[1] + dir[1] * distance,
    z: center[2] + dir[2] * distance,
    pitch: Math.asin(Math.max(-1, Math.min(1, forward[2]))) * DEGREES,
    yaw: Math.atan2(forward[1], forward[0]) * DEGREES,
    fov
  }
}
