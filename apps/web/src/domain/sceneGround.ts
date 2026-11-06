/**
 * The viewport's clear colour per theme: the ground under the grid, all an orthographic pane shows behind it, and all
 * a perspective pane shows with the sky off. Close to the chrome, so the map's sky and water are the only real colour:
 * dark is a near-neutral charcoal, and light a very pale cool grey-blue, so its orthographic panes sit with the water.
 */
export const SCENE_COLORS = { dark: "#1a1d21", light: "#d8e1e8" } as const

const channelsOf = (hex: string): ReadonlyArray<number> => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))

/** `hex` moved `amount` (0-1) of the way to `toward`, per sRGB channel. */
export const shadeOf = (hex: string, toward: string, amount: number): string => {
  const target = channelsOf(toward)
  const mixed = channelsOf(hex).map((channel, i) => Math.round(channel + ((target[i] ?? channel) - channel) * amount))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}
