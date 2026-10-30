/**
 * The in-game editor's material picker ("Paint"), from the `paint` key of
 * `assets/materials.json` (tools/extract): finishes (smooth, rough, glossy, ...) in the game's
 * order, each listing its colours and the class-qualified material a map file stores for
 * that choice. A slot's material is one of these, or anything else a map or catalog default
 * carries (which the picker can't show as a choice).
 */
import { Option, Schema } from "effect"
import { objectPathOf } from "./MapFile"
import { assetNameOf, type MaterialSpec, NEUTRAL } from "./Materials"
import { open } from "./schema"

const Rgb = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

export const PaintColor = open({
  color: Schema.String,
  material: Schema.String,
  /** Linear RGB swatch colour, where the game sets one explicitly. */
  displayColor: Schema.optionalKey(Rgb)
})
export type PaintColor = typeof PaintColor.Type

export const PaintFinish = open({ name: Schema.String, colors: Schema.Array(PaintColor) })
export type PaintFinish = typeof PaintFinish.Type

export type PaintPicker = ReadonlyArray<PaintFinish>

const decodeFinish = Schema.decodeUnknownOption(PaintFinish)

/** The picker from a materials.json; finishes that don't decode are dropped, a missing key gives none. */
export const parsePaint = (json: unknown): PaintPicker => {
  const list = typeof json === "object" && json !== null && "paint" in json ? json.paint : undefined
  return Array.isArray(list) ? list.flatMap((value) => Option.toArray(decodeFinish(value))) : []
}

export interface PaintChoice {
  readonly finish: PaintFinish
  readonly color: PaintColor
}

/**
 * The picker choice a stored material corresponds to: the same object path, else the same
 * asset name (a moved or redirected asset). Undefined for materials the picker doesn't offer.
 */
export const choiceOf = (picker: PaintPicker, material: string | undefined): PaintChoice | undefined => {
  if (material === undefined) return undefined
  const all = picker.flatMap((finish) => finish.colors.map((color) => ({ finish, color })))
  const path = objectPathOf(material)
  const name = assetNameOf(material)
  return all.find(({ color }) => objectPathOf(color.material) === path) ??
    all.find(({ color }) => assetNameOf(color.material) === name)
}

type Linear = readonly [number, number, number]

const brightness = (c: Linear) => Math.max(...c)

/**
 * The colour a swatch shows for a material, linear RGB: the game's own display colour when
 * it has one, else what the renderer draws, i.e. the emissive colour when it outshines the
 * base colour (scaled into range), else the base colour.
 */
export const swatchColor = (spec: MaterialSpec | undefined, displayColor?: Linear): Linear => {
  if (displayColor !== undefined) return displayColor
  const base = spec?.baseColor ?? NEUTRAL.baseColor
  const emissive = spec?.emissive ?? NEUTRAL.emissive
  const glow = brightness(emissive)
  if (glow <= brightness(base)) return base
  return glow > 1 ? [emissive[0] / glow, emissive[1] / glow, emissive[2] / glow] : emissive
}

const toSrgb = (c: number) => {
  const x = Math.min(1, Math.max(0, c))
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055
}

/** Linear RGB -> CSS `#rrggbb` (sRGB). */
export const cssColor = (c: Linear): string =>
  `#${c.map((x) => Math.round(toSrgb(x) * 255).toString(16).padStart(2, "0")).join("")}`
