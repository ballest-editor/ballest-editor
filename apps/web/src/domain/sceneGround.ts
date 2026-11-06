/** The viewport's clear colour per theme: the ground under the grid, and all an orthographic pane shows behind it. */
export const SCENE_COLORS = { dark: "#18242d", light: "#c8dbe8" } as const

const channelsOf = (hex: string): ReadonlyArray<number> => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))

/** `hex` moved `amount` (0-1) of the way to `toward`, per sRGB channel. */
export const shadeOf = (hex: string, toward: string, amount: number): string => {
  const target = channelsOf(toward)
  const mixed = channelsOf(hex).map((channel, i) => Math.round(channel + ((target[i] ?? channel) - channel) * amount))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}
