/**
 * The viewport's clear colour per theme: the ground under the grid, and all a perspective pane shows with the sky off.
 * Close to the chrome, so the map's sky and water are the only real colour: dark is a cool near-black between the
 * chrome's base and its panels, and light a very pale cool grey-blue.
 */
export const SCENE_COLORS = { dark: "#0e1013", light: "#d8e1e8" } as const

/**
 * What an orthographic pane shows behind the grid. In light, one step bluer than the clear colour: a side view sees the
 * water edge-on, so without this it would be the one grey pane among blue ones. Dark's water is close enough already.
 */
export const ORTHO_GROUND = { dark: SCENE_COLORS.dark, light: "#bfd3e2" } as const

const channelsOf = (hex: string): ReadonlyArray<number> => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))

/** `hex` moved `amount` (0-1) of the way to `toward`, per sRGB channel. */
export const shadeOf = (hex: string, toward: string, amount: number): string => {
  const target = channelsOf(toward)
  const mixed = channelsOf(hex).map((channel, i) => Math.round(channel + ((target[i] ?? channel) - channel) * amount))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}
