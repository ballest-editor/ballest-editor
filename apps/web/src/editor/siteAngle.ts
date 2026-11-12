/**
 * The view an upload picks for the prefab's picture on ballestrecords.com (`SiteAngle`), in the site's own terms: the
 * direction to the camera, its distance over the one that just fits the prefab's bounding sphere at the site's field of
 * view, and where it looks from the centre in radii. The upload's angle picker frames its camera with `framingOf` and
 * reads it back with `angleOf`, so the site draws what the uploader saw.
 */
import { SITE_PAN_MAX, SITE_ZOOM_RANGE, type SiteAngle } from "@ballest/contracts"
import type { Tuple3 } from "../domain/coords"

/** The site viewer's field of view, which an angle's zoom is measured against. */
export const SITE_VIEW_FOV = 40

/** The site's view of a prefab with no angle of its own: three-quarters from above. */
export const DEFAULT_SITE_ANGLE: SiteAngle = { from: unit([1, 0.7, 1.2]), zoom: 1, pan: [0, 0, 0] }

function unit(v: Tuple3): Tuple3 {
  const n = Math.hypot(...v)
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** How far back a camera of `aspect` stands to just fit a sphere of `radius`, as the site works it out. */
const fitDistance = (aspect: number, radius: number) => {
  const v = (SITE_VIEW_FOV * Math.PI) / 360
  const h = Math.atan(Math.tan(v) * aspect)
  return (radius / Math.sin(Math.min(v, h))) * 1.05
}

const add = (a: Tuple3, b: Tuple3, k = 1): Tuple3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

/** Where the camera stands and looks for `angle`, around a prefab whose bounds have `centre` and `radius`. */
export const framingOf = (angle: SiteAngle, centre: Tuple3, radius: number, aspect: number) => {
  const target = add(centre, angle.pan, radius)
  return { target, position: add(target, unit(angle.from), fitDistance(aspect, radius) * angle.zoom) }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round = (x: number) => Math.round(x * 1e4) / 1e4 || 0

/**
 * The angle a camera at `position` looking at `target` shows, framing's inverse, clamped to what the site takes and
 * tidied to four places as the site keeps it. A camera on its target keeps the default direction.
 */
export const angleOf = (
  position: Tuple3,
  target: Tuple3,
  centre: Tuple3,
  radius: number,
  aspect: number
): SiteAngle => {
  const off: Tuple3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]]
  const length = Math.hypot(...off)
  const from = length < 1e-6 ? DEFAULT_SITE_ANGLE.from : unit(off)
  const zoom = clamp(length / fitDistance(aspect, radius), SITE_ZOOM_RANGE[0], SITE_ZOOM_RANGE[1])
  const pan = (i: 0 | 1 | 2) => round(clamp((target[i] - centre[i]) / radius, -SITE_PAN_MAX, SITE_PAN_MAX))
  return {
    from: [round(from[0]), round(from[1]), round(from[2])],
    zoom: round(zoom),
    pan: [pan(0), pan(1), pan(2)]
  }
}
