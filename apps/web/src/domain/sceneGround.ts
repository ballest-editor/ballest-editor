/**
 * The viewport's clear colour per theme: the ground under the grid, and all a perspective pane shows with the sky off.
 * The blue a default-painted piece shows under the default light (`M_BaseSurface_Metal` at 07:18, OKLCH hue about 230),
 * so the ground and the pieces read as one family: dark is that blue taken down until the pieces pop off it, with only
 * as much chroma as sRGB holds there, and light is that blue pale and desaturated.
 */
export const SCENE_COLORS = { dark: "#0f242f", light: "#d0e4ef" } as const

/**
 * What an orthographic pane shows behind the grid: one step bluer than the clear colour. A side view sees the water
 * edge-on, so without this it would be the one grey pane among blue ones.
 */
export const ORTHO_GROUND = { dark: "#0d2c3a", light: "#b7d5e6" } as const

const channelsOf = (hex: string): ReadonlyArray<number> => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))

/** `hex` moved `amount` (0-1) of the way to `toward`, per sRGB channel. */
export const shadeOf = (hex: string, toward: string, amount: number): string => {
  const target = channelsOf(toward)
  const mixed = channelsOf(hex).map((channel, i) => Math.round(channel + ((target[i] ?? channel) - channel) * amount))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}
