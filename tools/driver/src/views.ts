import type { Vec3 } from "./handler.ts"

// The standard views of a piece (docs/DRIVER.md § Piece views): fixed names and directions, so renders of two pieces,
// or of one piece across two game versions, line up. Pure camera arithmetic; the game's frame is UE's (cm, Z up,
// left-handed; pitch up, yaw around Z).

export interface View {
  readonly name: string
  /** From the piece's centre towards the camera, any length. */
  readonly from: Vec3
}

/**
 * Front, back, left and right are elevations (the camera level with the piece's centre), so heights read off them:
 * where the gizmo sits on Z, how far a curtain rises. Top and bottom are plans; the two three-quarter views are
 * raised, for the shape.
 */
export const STANDARD_VIEWS: ReadonlyArray<View> = [
  { name: "front", from: [-1, 0, 0] },
  { name: "back", from: [1, 0, 0] },
  { name: "left", from: [0, -1, 0] },
  { name: "right", from: [0, 1, 0] },
  { name: "top", from: [0, -0.001, 1] },
  { name: "bottom", from: [0, -0.001, -1] },
  { name: "front-left", from: [-1, -1, 0.6] },
  { name: "back-right", from: [1, 1, 0.6] }
]

export interface Bounds {
  readonly min: Vec3
  readonly max: Vec3
}

/** A box's centre, half extents and the radius of its bounding sphere (at least 1). */
const boxOf = (bounds: Bounds) => {
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const half: Vec3 = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]
  return {
    center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] as Vec3,
    half,
    radius: Math.max(1, Math.hypot(...half))
  }
}

/** A piece's placement for the probe map: location, pitch yaw roll in degrees, scale. */
export interface Placement {
  readonly classPath: string
  readonly location: Vec3
  readonly rotation: Vec3
  readonly scale: Vec3
}

/** The primitive cube: 1000 cm a side at scale 1, its origin at the middle of its bottom face. */
export const CUBE =
  "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces/BP_Prim_Cube.BP_Prim_Cube_C"
const CUBE_SIDE = 1000
/** The studio's walls: cubes this many times the piece's bounding radius away, so the camera stays inside. */
const WALL_AT = 4
const WALL_SCALE = 30

/**
 * Six cubes around `bounds`, one behind the piece for each axis view, so every render has a plain wall (the cube's
 * dark blue, tiled every 2500 cm at this scale) behind the piece instead of the arena. The camera (3 radii out at
 * most) stays inside the box. The three-quarter views look into a corner.
 */
export const studio = (bounds: Bounds): ReadonlyArray<Placement> => {
  const { center, radius } = boxOf(bounds)
  const half = CUBE_SIDE * WALL_SCALE / 2
  const gap = radius * WALL_AT + half
  const scale: Vec3 = [WALL_SCALE, WALL_SCALE, WALL_SCALE]
  const wall = (dx: number, dy: number, dz: number): Placement => ({
    classPath: CUBE,
    // The cube's origin is at its bottom: the wall's middle is `half` above it.
    location: [center[0] + dx * gap, center[1] + dy * gap, center[2] + dz * gap - half],
    rotation: [0, 0, 0],
    scale
  })
  return [wall(1, 0, 0), wall(-1, 0, 0), wall(0, 1, 0), wall(0, -1, 0), wall(0, 0, 1), wall(0, 0, -1)]
}

/** A 100 cm cube beside the piece's near bottom corner: a known size in every view, for gauging a texture's scale. */
export const ruler = (bounds: Bounds): Placement => {
  const [x0, y0, z0] = bounds.min
  const side = CUBE_SIDE / 10
  return { classPath: CUBE, location: [x0 - 2 * side, y0 - 2 * side, z0], rotation: [0, 0, 0], scale: [0.1, 0.1, 0.1] }
}

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
 * A camera on `view`'s side of a box, looking at its centre from far enough for the box to fit the frame with a
 * margin: for a view down an axis, the two extents it sees against the horizontal and vertical fields of view; for
 * any other direction, the box's bounding sphere against the narrower (vertical) one.
 */
export const frame = (bounds: Bounds, view: View, fov = 60): Camera => {
  const { center, half, radius } = boxOf(bounds)
  const horizontal = fov / DEGREES
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / ASPECT)
  const length = Math.hypot(...view.from)
  const dir: Vec3 = [view.from[0] / length, view.from[1] / length, view.from[2] / length]
  const axis = dir.findIndex((v) => Math.abs(v) > 0.999)
  let distance: number
  if (axis === -1) {
    distance = radius * MARGIN / Math.sin(vertical / 2)
  } else {
    // Seen along X the frame's width is Y and its height Z; along Y, X and Z; along Z (a plan), Y and X.
    const [wide, high] = axis === 0 ? [half[1], half[2]] : axis === 1 ? [half[0], half[2]] : [half[1], half[0]]
    const depth = half[axis] ?? 0
    distance = depth + Math.max(1, wide / Math.tan(horizontal / 2), high / Math.tan(vertical / 2)) * MARGIN
  }
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
