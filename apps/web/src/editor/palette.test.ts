import { assert, describe, it } from "@effect/vitest"
import { globalsCss as css } from "../test/globalsCss"

type Rgb = readonly [number, number, number]

const tokensOf = (selector: string): ReadonlyMap<string, string> => {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf("}", start))
  return new Map([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name ?? "", value ?? ""]))
}

const THEMES = { dark: tokensOf(".dark"), light: tokensOf(":root") }

/** A token's numbers. An alpha or a `var()` throws: the tokens tested here have to be opaque. */
const oklchOf = (tokens: ReadonlyMap<string, string>, name: string): Rgb => {
  const match = tokens.get(name)?.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (!match) throw new Error(`--${name} isn't an opaque oklch(): ${tokens.get(name)}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** OKLCH to linear sRGB (Ottosson's matrices), clipped as a browser clips it. */
const linearOf = ([lightness, chroma, hue]: Rgb): Rgb => {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (channel: number) => Math.min(1, Math.max(0, channel))
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ]
}

const encoded = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
const decoded = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

/** `top` at `alpha` over `under`, blended in encoded sRGB as a browser blends it. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => {
  const mix = (i: 0 | 1 | 2) => decoded(encoded(top[i]) * alpha + encoded(under[i]) * (1 - alpha))
  return [mix(0), mix(1), mix(2)]
}

const contrast = (a: Rgb, b: Rgb) => {
  const luminance = ([r, g, bl]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * bl
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** WCAG's bars: text, and graphics. */
const TEXT = 4.5
const GRAPHIC = 3

/** The steps' contrast on --card, as docs/design/ui-system.md gives them. */
const STEPS = {
  dark: { "fg-secondary": 11, "fg-tertiary": 7.3, "fg-disabled": 3.2 },
  light: { "fg-secondary": 8.7, "fg-tertiary": 5.4, "fg-disabled": 2.3 }
}

const PANELS = ["card", "popover"]
const STATUSES = ["status-ok", "status-warn", "status-neutral"]

const pairsOf = (theme: "dark" | "light"): ReadonlyArray<readonly [string, string, number]> => [
  ...Object.entries(STEPS[theme]).map(([step, bar]) => [step, "card", bar] as const),
  ...PANELS.flatMap((panel) => [
    ["foreground", panel, TEXT] as const,
    ["fg-secondary", panel, TEXT] as const,
    ["fg-tertiary", panel, TEXT] as const,
    // a line or a dot, never small text
    ["primary", panel, GRAPHIC] as const,
    // Settings › Game uses a status's text with no fill
    ...STATUSES.map((status) => [`${status}-foreground`, panel, TEXT] as const)
  ]),
  ["primary-foreground", "primary", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ...STATUSES.map((status) => [`${status}-foreground`, status, TEXT] as const),
  ...[1, 2, 3, 4, 5].map((level) => [`difficulty-${level}`, "popover", GRAPHIC] as const),
  ...["s", "m", "l"].flatMap((size) => [
    ["background", `size-${size}`, TEXT] as const,
    [`size-${size}`, "card", GRAPHIC] as const
  ])
]

describe("the palette", () => {
  for (const theme of ["dark", "light"] as const) {
    const tokens = THEMES[theme]
    const color = (name: string) => linearOf(oklchOf(tokens, name))

    for (const [text, on, bar] of pairsOf(theme)) {
      it(`${theme}: --${text} reads on --${on}`, () => {
        assert.isAtLeast(contrast(color(text), color(on)), bar)
      })
    }

    // The menus' focus swaps bg-accent for bg-foreground/10 and keeps text-accent-foreground.
    it(`${theme}: a focused menu item can be read`, () => {
      const row = over(color("foreground"), 0.1, color("popover"))
      assert.isAtLeast(contrast(color("accent-foreground"), row), TEXT)
    })

    it(`${theme}: each surface rises above the last, none of them neutral`, () => {
      const [background, card, popover] = ["background", "card", "popover"].map((name) => oklchOf(tokens, name))
      assert.isBelow(background?.[0] ?? 1, card?.[0] ?? 0)
      assert.isBelow(card?.[0] ?? 1, popover?.[0] ?? 0)
      for (const surface of [background, card, popover]) assert.isAbove(surface?.[1] ?? 0, 0)
    })
  }
})
