/**
 * Where on an end a piece can connect (docs/SNAPPING.md § Connectors): a fixed set of spots on its cap, in the piece's
 * frame. A rectangle or polygon has its box's four corners, the middles of its four sides and its centre; a circle or a
 * ring has the four points of its rim straight up, down and to each side, and its centre. Left and right are as seen
 * looking out of the end with its up up, the game's +Y to the right of its +X, so left is along forward × up.
 */
import type { Connector } from "./Catalog"

type Tuple = Connector["position"]

/** A spot by the cap's row and column, the same names for both shapes. */
export const SPOT_IDS = [
  "topLeft",
  "top",
  "topRight",
  "left",
  "centre",
  "right",
  "bottomLeft",
  "bottom",
  "bottomRight"
] as const
export type SpotId = (typeof SPOT_IDS)[number]

/** Which spot each end of an item connects at, by end index; an end it doesn't name connects where it was measured. */
export type ConnectAt = Readonly<Record<string, SpotId>>

export const SPOT_NAMES: Readonly<Record<SpotId, string>> = {
  topLeft: "Top left",
  top: "Top",
  topRight: "Top right",
  left: "Left",
  centre: "Center",
  right: "Right",
  bottomLeft: "Bottom left",
  bottom: "Bottom",
  bottomRight: "Bottom right"
}

/** Each spot's place on the cap: along forward × up (left is +1), and along up (top is +1). */
const PLACES: Readonly<Record<SpotId, readonly [number, number]>> = {
  topLeft: [1, 1],
  top: [0, 1],
  topRight: [-1, 1],
  left: [1, 0],
  centre: [0, 0],
  right: [-1, 0],
  bottomLeft: [1, -1],
  bottom: [0, -1],
  bottomRight: [-1, -1]
}

const ROUND_SPOTS: ReadonlySet<SpotId> = new Set(["top", "left", "centre", "right", "bottom"])

export interface ConnectorSpot {
  readonly id: SpotId
  readonly name: string
  /** In the piece's frame, on the cap's plane. */
  readonly position: Tuple
}

/** What a spot is placed from: an end's point and directions (mirrored, if the item is), and its cap. */
type SpotSource = Pick<Connector, "position" | "forward" | "up" | "cap">

const cross = (
  [ax, ay, az]: Tuple,
  [bx, by, bz]: Tuple
): Tuple => [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]

const unit = (v: Tuple): Tuple => {
  const length = Math.hypot(...v)
  return length === 0 ? v : [v[0] / length, v[1] / length, v[2] / length]
}

/** The spots an end offers, in `SPOT_IDS` order; none for an end without a cap. */
export const spotsOf = ({ cap, forward, position, up }: SpotSource): ReadonlyArray<ConnectorSpot> => {
  if (cap === undefined) return []
  const round = cap.shape === "circle" || cap.shape === "annulus"
  const [halfWidth, halfHeight] = round ? [cap.radius, cap.radius] : [cap.width / 2, cap.height / 2]
  const centre = cap.centre ?? position
  const left = unit(cross(forward, up))
  const upward = unit(up)
  return SPOT_IDS.filter((id) => !round || ROUND_SPOTS.has(id)).map((id) => {
    const [across, along] = PLACES[id]
    const at = (i: 0 | 1 | 2) => centre[i] + left[i] * across * halfWidth + upward[i] * along * halfHeight
    return { id, name: SPOT_NAMES[id], position: [at(0), at(1), at(2)] }
  })
}

/** How near a spot must be to the measured point to be where the end connects by default, in cm. */
const SAME_CM = 0.05

/** The spot at the end's measured point, which is where it connects until one is chosen: a track's Top, a tube's Centre. */
export const defaultSpotOf = (end: SpotSource): SpotId | undefined =>
  spotsOf(end).find(({ position }) =>
    Math.hypot(position[0] - end.position[0], position[1] - end.position[1], position[2] - end.position[2]) <= SAME_CM
  )?.id

/** Where an end connects at `spot`: that spot's point, or the measured one for no spot or one its cap doesn't have. */
export const spotPosition = (end: SpotSource, spot: SpotId | undefined): Tuple =>
  spot === undefined ? end.position : spotsOf(end).find(({ id }) => id === spot)?.position ?? end.position
