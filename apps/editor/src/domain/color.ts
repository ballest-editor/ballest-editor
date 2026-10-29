/**
 * Colours. Item properties store a colour as three linear channels (`DecalRed` 0.1 is drawn
 * by the game's own swatch as sRGB 89, not 26), while pickers and hex codes are sRGB.
 * Converting between them happens here and nowhere else.
 */
import { Option } from "effect"

export type Rgb = readonly [red: number, green: number, blue: number]

const clamp01 = (c: number) => Math.min(1, Math.max(0, c))

/** The sRGB transfer function (IEC 61966-2-1); the game's swatches match it. */
export const linearToSrgb = (c: number): number => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

export const srgbToLinear = (c: number): number => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

/** A linear colour as an sRGB `#rrggbb`; channels outside 0–1 are clamped (a swatch can't show them). */
export const linearToHex = (rgb: Rgb): string =>
  `#${rgb.map((c) => Math.round(linearToSrgb(clamp01(c)) * 255).toString(16).padStart(2, "0")).join("")}`

/** An sRGB `#rrggbb` as linear channels; None when it isn't one. */
export const hexToLinear = (hex: string): Option.Option<Rgb> => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (match === null) return Option.none()
  const [r, g, b] = match.slice(1).map((digits) => srgbToLinear(Number.parseInt(digits, 16) / 255))
  return r === undefined || g === undefined || b === undefined ? Option.none() : Option.some([r, g, b])
}
