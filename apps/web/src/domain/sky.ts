/**
 * The game's sky, from the sun (see sunlight.ts), in the game's frame.
 *
 * The level's sky is `BP_Sky_Sphere_Stylized`, a sphere drawn with the unlit material
 * `M_Sky_Panning_Clouds_Stylized`. Recovered from the pak (docs/FORMAT.md, "Lighting"):
 *
 * - The Blueprint (`RefreshMaterial`) sets the material's parameters from the sun. By day
 *   (4:00 to 20:00) the horizon and zenith colours come from the engine's
 *   `C_Sky_Horizon_Color` / `C_Sky_Zenith_Color` curves at the sun's height (elevation / 90),
 *   the horizon falloff is lerp(3, 7, |height|) and the sun brightness 20; at night they are
 *   fixed dark blues with stars.
 * - The material's compiled pixel shader then draws, for a view direction `d`:
 *   `1.5 * (lerp(zenith + stars, horizon, pow(1 - saturate(d.z), falloff)) + sun)`, where the
 *   sun disc is `sunColor * brightness * saturate(1 - |dot(d, toSun) - 1| / 0.0003)`.
 *
 * Its clouds and star field are textures (not served yet); the renderer leaves the clouds out
 * and draws procedural stars.
 */
import { linearToHex } from "./color"
import type { Tuple3, Vec3 } from "./coords"
import { type Sun, sunOf } from "./sunlight"

/** One curve key: time, value, arrive and leave tangents (UE `FRichCurveKey`, cubic, auto tangents). */
type Key = readonly [time: number, value: number, arrive: number, leave: number]
type ColorCurve = readonly [r: ReadonlyArray<Key>, g: ReadonlyArray<Key>, b: ReadonlyArray<Key>]

/** `/Engine/EngineSky/C_Sky_Horizon_Color`, linear RGB. */
const HORIZON_CURVE: ColorCurve = [
  [
    [-0.994358, 0.048, 0, 0],
    [-0.55225, 0.475, 1.96478, 1.96478],
    [-0.000863314, 2, 0.200593, 0.200593],
    [0.172755, 2, -0.329943, -0.329943],
    [0.379341, 0.6975, -3.89405, -3.89405],
    [0.450101, 0.92, 0, 0]
  ],
  [
    [-0.994358, 0.052, 0, 0],
    [-0.55225, 0.135915, 0.0509216, 0.0509216],
    [-0.000863314, 0.6, 0.0530312, 0.0530312],
    [0.172755, 0.604272, 0.0380554, 0.0380554],
    [0.379341, 0.943151, 2.58908, 2.58908],
    [0.450101, 1.32234, 0, 0]
  ],
  [
    [-0.994358, 0.075, 0, 0],
    [-0.55225, 0.11322, 0.0236528, 0.0236528],
    [-0.000863314, 0.2, 0.172832, 0.172832],
    [0.172755, 0.238523, 0.220265, 0.220265],
    [0.379341, 1.5, 6.35119, 6.35119],
    [0.450101, 2, 0, 0]
  ]
]

/** `/Engine/EngineSky/C_Sky_Zenith_Color`, linear RGB. */
const ZENITH_CURVE: ColorCurve = [
  [
    [-0.950263, 0, 0, 0],
    [-0.403666, 0.0781866, 0.291961, 0.291961],
    [0.000393271, 0.225, 0.436093, 0.436093],
    [0.0820404, 0.29, -0.700058, -0.700058],
    [0.182798, 0.0973061, -0.889177, -0.889177],
    [0.303617, 0.044, -0.259358, -0.259358],
    [0.470069, 0.0228, 0, 0]
  ],
  [
    [-0.950263, 0, 0, 0],
    [-0.403666, 0.0644, 0.177413, 0.177413],
    [0.000393271, 0.0987964, 0.156074, 0.156074],
    [0.0820404, 0.140206, 0.217388, 0.217388],
    [0.182798, 0.138449, -0.708979, -0.708979],
    [0.303617, 0.087, -0.311395, -0.311395],
    [0.470069, 0.0489939, 0, 0]
  ],
  [
    [-0.950263, 0, 0, 0],
    [-0.403666, 0.08, 0.0985293, 0.0985293],
    [0.000393271, 0.0936675, 0.0800894, 0.0800894],
    [0.0820404, 0.1189, 0.377577, 0.377577],
    [0.182798, 0.178948, 0.388579, 0.388579],
    [0.303617, 0.205, -0.2052, -0.2052],
    [0.470069, 0.12, 0, 0]
  ]
]

/** `RefreshMaterial`'s night look (before 4:00 and after 20:00). */
const NIGHT = {
  horizon: [0.012044, 0.014294, 0.03125],
  zenith: [0, 0.067719, 0.135417],
  horizonFalloff: 0.2,
  stars: 25
} as const

/**
 * The horizon as it reaches the screen, by the sun's height, linear RGB: the sky alone, sampled from the game at 5:00
 * (#d18548), 6:00 (#d0884b), 7:18 (#cc9f8b) and from 9:00 to noon (#abbcce); docs/qa/sky-horizon.md has how. The curves'
 * noon horizon is near white, and only the game's own tone mapping and exposure turn it blue-grey: the viewport's would
 * show it as white haze.
 */
const SHOWN_HORIZON_CURVE: ColorCurve = [
  [[-1 / 9, 0.638, 0, 0], [0, 0.631, 0, 0], [0.2166, 0.604, 0, 0], [0.5, 0.407, 0, 0]],
  [[-1 / 9, 0.235, 0, 0], [0, 0.246, 0, 0], [0.2166, 0.347, 0, 0], [0.5, 0.503, 0, 0]],
  [[-1 / 9, 0.065, 0, 0], [0, 0.07, 0, 0], [0.2166, 0.258, 0, 0], [0.5, 0.617, 0, 0]]
]
/** The same at night, #171b31. */
const SHOWN_NIGHT_HORIZON: Tuple3 = [0.0086, 0.0109, 0.0307]

/** The material's `Sun Radius`: the disc is where 1 - cos(angle to the sun) is below it (about 1.4°). */
export const SUN_RADIUS = 0.0003
/** The material scales its whole output by this. */
export const SKY_GAIN = 1.5

/** UE's FRichCurve cubic segment: a Bézier through the keys with control points a third along the tangents. */
export const evalCurve = (keys: ReadonlyArray<Key>, time: number): number => {
  const first = keys[0]
  const last = keys.at(-1)
  if (first === undefined || last === undefined) return 0
  if (time <= first[0]) return first[1]
  if (time >= last[0]) return last[1]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (a === undefined || b === undefined || time > b[0]) continue
    const dt = b[0] - a[0]
    const s = (time - a[0]) / dt
    const p1 = a[1] + (a[3] * dt) / 3
    const p2 = b[1] - (b[2] * dt) / 3
    const u = 1 - s
    return u * u * u * a[1] + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * b[1]
  }
  return last[1]
}

/** `GetClampedLinearColorValue`: the curve's colour, each channel clamped to 0-1. */
const colorAt = (curve: ColorCurve, time: number): Tuple3 => {
  const channel = (i: 0 | 1 | 2) => Math.min(1, Math.max(0, evalCurve(curve[i], time)))
  return [channel(0), channel(1), channel(2)]
}

export interface Sky {
  readonly zenith: Tuple3
  readonly horizon: Tuple3
  /** `horizon` as the visible sky shows it, past tone mapping. */
  readonly shownHorizon: Tuple3
  readonly horizonFalloff: number
  /** Multiplies the sun colour in the disc (0 at night). */
  readonly sunBrightness: number
  /** The star layer's weight: the material's `Stars brightness` times `Sun height` (only below the horizon). */
  readonly stars: number
  /** Unit vector towards the sun, game frame. */
  readonly toSun: Vec3
}

/** The sky the game draws for this sun at `timeOfDay`. */
export const skyOf = (sun: Sun, timeOfDay: number): Sky => {
  const height = sun.elevation / 90
  // The material's `Sun height` is |height| below the horizon and 0 above it.
  const belowHorizon = height < 0 ? -height : 0
  if (timeOfDay < 4 || timeOfDay > 20) {
    return {
      zenith: NIGHT.zenith,
      horizon: NIGHT.horizon,
      shownHorizon: SHOWN_NIGHT_HORIZON,
      horizonFalloff: NIGHT.horizonFalloff,
      sunBrightness: 0,
      stars: NIGHT.stars * belowHorizon,
      toSun: sun.toSun
    }
  }
  // By day the Blueprint first sets the light to 12, so 10 * sky light * 12 is always past the clamp at 20,
  // and the stars term 1 - (sky light * 12 + 0.1) / 20.1 is 0 for every sky light above 1.67.
  const stars = 1 - Math.min(1, Math.max(0, (sun.skyIntensity * 12 + 0.1) / 20.1))
  return {
    zenith: colorAt(ZENITH_CURVE, height),
    horizon: colorAt(HORIZON_CURVE, height),
    shownHorizon: colorAt(SHOWN_HORIZON_CURVE, height),
    horizonFalloff: 3 + 4 * Math.abs(height),
    sunBrightness: 20,
    stars: stars * belowHorizon,
    toSun: sun.toSun
  }
}

/**
 * What the sky light can't see past. The game's capture holds the sky alone, but its global illumination and
 * reflections stop at the stadium: seen from the arena the stands reach about 15 degrees above the horizon, and they
 * and the water are blue-green with almost no red (measured in the game's renders). So the renderer's capture ends at
 * `ARENA_RIM`, the sine of that elevation, and holds the arena's colour below it.
 */
export const ARENA_RIM = 0.26
/** The arena's colour, linear RGB, as a fraction of the light on an up-facing surface. */
export const ARENA_COLOR: Tuple3 = [0.06, 0.27, 0.33]

/** The sky's colour (without stars or the sun) in direction `d` (game frame, unit). */
export const skyRadiance = (sky: Sky, d: Vec3): Tuple3 => {
  const f = Math.min(1, Math.pow(1 - Math.min(1, Math.max(0, d.z)), sky.horizonFalloff))
  const channel = (i: 0 | 1 | 2) => SKY_GAIN * (sky.zenith[i] + (sky.horizon[i] - sky.zenith[i]) * f)
  return [channel(0), channel(1), channel(2)]
}

/** Just above the stands, the lowest sky the arena shows and where most of its colour is. */
const SWATCH_VIEW: Vec3 = { x: Math.sqrt(1 - ARENA_RIM ** 2), y: 0, z: ARENA_RIM }

/** The sky at `timeOfDay` as one sRGB `#rrggbb`, for a swatch. The sky doesn't depend on the sun's brightness or yaw. */
export const skyColorAt = (timeOfDay: number): string =>
  linearToHex(skyRadiance(skyOf(sunOf({ timeOfDay, brightness: 0, angle: 0 }), timeOfDay), SWATCH_VIEW))

/**
 * Light (as a luminance) reaching a surface facing `normal` from the sky above `rim` (the
 * sine of an elevation) and an even `ground` below it: the cosine-weighted mean radiance over
 * the sphere. Sets the sky light's strength, so that the brightest-lit faces get the game's
 * sky-light intensity whatever the sky's own colours.
 */
export const skyIrradiance = (sky: Sky, normal: Vec3, ground: number, rim = 0): number => {
  const rings = 24
  const segments = 32
  let sum = 0
  let weight = 0
  for (let i = 0; i < rings; i++) {
    const elevation = ((i + 0.5) / rings - 0.5) * Math.PI
    const z = Math.sin(elevation)
    const r = Math.cos(elevation)
    for (let j = 0; j < segments; j++) {
      const azimuth = ((j + 0.5) / segments) * 2 * Math.PI
      const d = { x: r * Math.cos(azimuth), y: r * Math.sin(azimuth), z }
      const facing = d.x * normal.x + d.y * normal.y + d.z * normal.z
      if (facing <= 0) continue
      const w = facing * r // cos(angle to the normal) * solid-angle element
      const radiance = z < rim ? ground : luminance(skyRadiance(sky, d))
      sum += w * radiance
      weight += w
    }
  }
  return weight > 0 ? sum / weight : 0
}

export const luminance = ([r, g, b]: Tuple3): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
