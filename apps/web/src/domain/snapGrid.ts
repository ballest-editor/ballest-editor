/** The grid as a target (docs/SNAPPING.md § Grid): a step, an origin and a yaw, in game space. */
import type { Vec3 } from "./coords"
import { snapValue } from "./snap"
import type { SnapConfig } from "./snapConfig"
import { vecAdd, vecDot, vecScale, vecSub } from "./ueMath"

/** The grid's X, Y and Z in the world: Z stays up, as a tilted grid is a construction plane's job. */
export const gridAxes = (config: SnapConfig): readonly [Vec3, Vec3, Vec3] => {
  const yaw = config.targets.grid.yaw * Math.PI / 180
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [{ x: c, y: s, z: 0 }, { x: -s, y: c, z: 0 }, { x: 0, y: 0, z: 1 }]
}

/** The grid point nearest `point`, each axis on its nearest line. */
export const nearestGridPoint = (config: SnapConfig, point: Vec3): Vec3 => {
  const { origin } = config.targets.grid
  const from = vecSub(point, origin)
  return gridAxes(config).reduce(
    (at, axis) => vecAdd(at, vecScale(axis, snapValue(vecDot(from, axis), config.gridSize))),
    origin
  )
}

/**
 * Where a base goes on the grid from `start` under a free move to `free`: on the grid's lines, or in whole steps from
 * where it started along `stepAxes`, a handle on the item's own axes.
 */
export const gridLanding = (
  config: SnapConfig,
  start: Vec3,
  free: Vec3,
  stepAxes?: ReadonlyArray<Vec3>
): Vec3 => {
  if (stepAxes === undefined) return nearestGridPoint(config, free)
  const moved = vecSub(free, start)
  return stepAxes.reduce(
    (at, axis) => vecAdd(at, vecScale(axis, snapValue(vecDot(moved, axis), config.gridSize))),
    start
  )
}

/** How far apart the grid's lines show, at `cmPerPixel`. */
export const gridSpacingPixels = (config: SnapConfig, cmPerPixel: number): number => config.gridSize / cmPerPixel

/**
 * The grid as an orthographic pane draws it, on a view of `right` and `up`: its origin in the view's own cm, and the two
 * rows that turn a point of the view (from that origin) into grid steps, one per line family. A family's rows hold how
 * fast it changes across the view, which also says how far apart its lines fall on a view that sees the grid edge on.
 */
export const gridInView = (config: SnapConfig, right: Vec3, up: Vec3) => {
  const axes = gridAxes(config)
  const nearest = (view: Vec3) =>
    axes.reduce((best, axis) => Math.abs(vecDot(axis, view)) > Math.abs(vecDot(best, view)) ? axis : best, axes[0])
  const rowOf = (axis: Vec3) => ({ x: vecDot(axis, right), y: vecDot(axis, up) })
  const { origin } = config.targets.grid
  return {
    origin: { x: vecDot(origin, right), y: vecDot(origin, up) },
    across: rowOf(nearest(right)),
    along: rowOf(nearest(up))
  }
}
