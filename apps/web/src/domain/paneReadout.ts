/**
 * The scale readout in a perspective pane's corner (docs/DESKTOP.md § View panes): how high the camera stands and how far
 * off the selection is. Game space, in cm.
 */
import type { Vec3 } from "./coords"
import { vecAdd } from "./ueMath"

/** What the camera is measured to: the selection's centre, and what the readout calls it. */
export interface PaneMark {
  readonly point: Vec3
  readonly name: string
}

/**
 * A distance at the size a camera moves in: metres to a decimal place, or whole past 100, as a map is laid out in metres
 * whichever unit the fields use. Under a metre, `units` says.
 */
const formatDistance = (cm: number, units: "cm" | "m"): string => {
  const metres = cm / 100
  if (units === "cm" && metres < 1) return `${Math.round(cm)} cm`
  return `${Number(metres.toFixed(metres < 100 ? 1 : 0))} m`
}

/** A selection's centre and name: `name` for one thing, a count for several; `undefined` with nothing selected. */
export const paneMarkOf = (points: ReadonlyArray<Vec3>, name: string | undefined): PaneMark | undefined => {
  if (points.length === 0) return undefined
  const sum = points.reduce(vecAdd)
  const { length } = points
  return {
    point: { x: sum.x / length, y: sum.y / length, z: sum.z / length },
    name: name ?? `${length} items`
  }
}

/** "12.4 m up · 31 m to Goal": the camera over the grid plane at `floor`, and to `mark` when there's one. */
export const formatPaneReadout = (
  eye: Vec3,
  floor: number,
  mark: PaneMark | undefined,
  units: "cm" | "m"
): string => {
  const height = eye.z - floor
  const over = `${formatDistance(Math.abs(height), units)} ${height < 0 ? "down" : "up"}`
  if (mark === undefined) return over
  const { x, y, z } = mark.point
  const distance = Math.hypot(eye.x - x, eye.y - y, eye.z - z)
  return `${over} · ${formatDistance(distance, units)} to ${mark.name}`
}
