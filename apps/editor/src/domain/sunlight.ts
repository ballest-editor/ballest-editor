/**
 * The game's sun and sky light, from a map's `worldSettings`, in the game's frame.
 *
 * Recovered from the pak (see docs/FORMAT.md, "Lighting"): the level editor's World
 * Settings panel (`W_WorldSettings`) has three sliders, "time of day", "sunlight" and
 * "light rotation". They drive one `SKGMapEditorDirectionalLight`:
 *
 * - time of day (hours) sets the light's pitch, -(t - 6) * 15 degrees: sunrise at 6:00,
 *   overhead at 12:00, sunset at 18:00, straight below at midnight. The editor map's light
 *   sits at exactly that pitch for the default time (7.2997 h -> -19.4956 degrees).
 * - light rotation is the light's yaw in degrees (`directionalLightAngle`).
 * - sunlight is the light's intensity (`brightness`; the editor map's light is 12, which is
 *   also what new maps save, though the slider only spans 1.25-7).
 *
 * The sky light isn't a control: on load and on every time change the game sets it from
 * the time of day, 3 at noon falling linearly to a minimum fill at midnight, clamped to
 * 1-3. `skylightIntensity` in the file is always 1 and isn't read for it.
 *
 * What's approximated: the game lights through a sky atmosphere, which reddens and dims a
 * low sun and hides it below the horizon. Here the sun fades out between HORIZON_FADE
 * degrees and warms towards SUNSET_TINT near the horizon. The minimum fill (a game-instance
 * default we can't read) is taken as 1, the clamp's floor.
 */
import type { Tuple3, Vec3 } from "./coords"
import type { WorldSettings } from "./MapFile"

/** The three values the game's World Settings panel edits. */
export interface Lighting {
  /** Hours, 0-24. */
  readonly timeOfDay: number
  /** The sun's intensity. */
  readonly brightness: number
  /** The sun's yaw in degrees. */
  readonly angle: number
}

/** The game's slider ranges, from `W_WorldSettings`. */
export const LIGHTING_RANGES = {
  timeOfDay: { min: 0, max: 24 },
  brightness: { min: 1.25, max: 7 },
  angle: { min: -360, max: 360 }
} as const satisfies Record<keyof Lighting, { readonly min: number; readonly max: number }>

/** The editor map's light yaw, used when a file has no `directionalLightAngle` (older saves). */
export const DEFAULT_LIGHT_ANGLE = -20.6474552154541

export const lightingOf = (world: WorldSettings): Lighting => ({
  timeOfDay: world.directionalLight.timeOfDay,
  brightness: world.directionalLight.brightness,
  angle: world.directionalLightAngle ?? DEFAULT_LIGHT_ANGLE
})

/** The light's pitch in degrees for a time of day (negative points down). */
export const sunPitch = (timeOfDay: number): number => -(timeOfDay - 6) * 15

/** The sky light's intensity for a time of day, as the game sets it (1-3). */
export const skyLightIntensity = (timeOfDay: number, minimumFill = 1): number => {
  const t = timeOfDay
  const raw = t < 12
    ? lerp(minimumFill, 3, t / 12)
    : t >= 24 || t <= 0
    ? minimumFill
    : lerp(3, minimumFill, (t - 12) / 12)
  return clamp(raw, 1, 3)
}

/** Degrees of elevation over which the sun fades in: gone at the first, full at the second. */
export const HORIZON_FADE = [-4, 6] as const
/** The sun's colour at the horizon, before the light's own colour; linear RGB. */
const SUNSET_TINT: Tuple3 = [1, 0.42, 0.16]
/** Elevation (degrees) at which the sunset tint has gone. */
const TINT_GONE_AT = 25
/** The light's colour temperature (6000 K) as linear RGB. */
const LIGHT_COLOR: Tuple3 = [1, 0.9, 0.81]

export interface Sun {
  /** Unit vector from the scene towards the sun, game frame (Z up). */
  readonly toSun: Vec3
  /** Degrees above the horizon (negative below). */
  readonly elevation: number
  /** The sun's intensity after the horizon fade, in the game's units (`brightness`). */
  readonly intensity: number
  /** Linear RGB, about 1 at the brightest channel. */
  readonly color: Tuple3
  /** The sky light's intensity (1-3). */
  readonly skyIntensity: number
}

export const sunOf = (lighting: Lighting): Sun => {
  const pitch = rad(sunPitch(lighting.timeOfDay))
  const yaw = rad(lighting.angle)
  // UE's FRotator forward vector; a directional light shines along it, so the sun is behind it.
  const toSun: Vec3 = {
    x: -Math.cos(pitch) * Math.cos(yaw),
    y: -Math.cos(pitch) * Math.sin(yaw),
    z: -Math.sin(pitch)
  }
  const elevation = deg(Math.asin(clamp(toSun.z, -1, 1)))
  const tint = smoothstep(0, TINT_GONE_AT, elevation)
  const channel = (i: 0 | 1 | 2) => LIGHT_COLOR[i] * lerp(SUNSET_TINT[i], 1, tint)
  return {
    toSun,
    elevation,
    intensity: Math.max(0, lighting.brightness) * smoothstep(HORIZON_FADE[0], HORIZON_FADE[1], elevation),
    color: [channel(0), channel(1), channel(2)],
    skyIntensity: skyLightIntensity(lighting.timeOfDay)
  }
}

/** `hours` as a 24-hour clock, e.g. 7.2997 -> "07:18". */
export const formatTimeOfDay = (hours: number): string => {
  const minutes = Math.round(clamp(hours, 0, 24) * 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
const rad = (degrees: number) => (degrees * Math.PI) / 180
const deg = (radians: number) => (radians * 180) / Math.PI
