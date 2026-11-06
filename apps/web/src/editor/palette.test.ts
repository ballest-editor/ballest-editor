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

/** OKLCH to linear sRGB (Ottosson's matrices). A channel outside 0 to 1 is outside sRGB. */
const unclippedOf = ([lightness, chroma, hue]: Rgb): Rgb => {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

/** Clipped as a browser clips it. */
const linearOf = (oklch: Rgb): Rgb => {
  const clip = (channel: number) => Math.min(1, Math.max(0, channel))
  const [r, g, b] = unclippedOf(oklch)
  return [clip(r), clip(g), clip(b)]
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
  dark: { foreground: 16, "fg-secondary": 11, "fg-tertiary": 7.5, "fg-disabled": 3.2 },
  light: { "fg-secondary": 10.7, "fg-tertiary": 6.3, "fg-disabled": 2.6 }
}

const PANELS = ["card", "popover"]
const SURFACES = ["background", "card", "popover"]
/** Past this a surface starts to read as blue: docs/design/ui-system.md § Colour. */
const MAX_SURFACE_CHROMA = 0.012
const STATUSES = ["status-ok", "status-warn", "status-neutral"]

const pairsOf = (theme: "dark" | "light"): ReadonlyArray<readonly [string, string, number]> => [
  ...Object.entries(STEPS[theme]).map(([step, bar]) => [step, "card", bar] as const),
  ...PANELS.flatMap((panel) => [
    ["foreground", panel, TEXT] as const,
    ["fg-secondary", panel, TEXT] as const,
    ["fg-tertiary", panel, TEXT] as const,
    // links and the active tab's text, as well as lines and dots
    ["primary", panel, TEXT] as const,
    ["destructive", panel, TEXT] as const,
    ["dirty", panel, GRAPHIC] as const,
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
    [`size-${size}`, "card", TEXT] as const
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

    // A menu row's focus is bg-foreground/8 under text-accent-foreground, on the glass's own surface.
    it(`${theme}: a focused menu item can be read`, () => {
      const row = over(color("foreground"), 0.08, color("popover"))
      assert.isAtLeast(contrast(color("accent-foreground"), row), TEXT)
    })

    // bg-primary/12: everything a selected row holds has to survive the wash.
    for (const panel of PANELS) {
      it(`${theme}: a selected row on --${panel} can be read`, () => {
        const row = over(color("primary"), 0.12, color(panel))
        for (const text of ["foreground", "fg-secondary", "fg-tertiary"]) {
          assert.isAtLeast(contrast(color(text), row), TEXT)
        }
      })

      // ::selection is bg-primary/30 under text-foreground
      it(`${theme}: selected text on --${panel} can be read`, () => {
        assert.isAtLeast(contrast(color("foreground"), over(color("primary"), 0.3, color(panel))), TEXT)
      })

      // bg-destructive/12 text-destructive, and a tag's bg-size-s/15 text-size-s
      it(`${theme}: a filled tint on --${panel} can be read`, () => {
        for (
          const [ink, alpha] of [["destructive", 0.12], ["size-s", 0.15], ["size-m", 0.15], ["size-l", 0.15]] as const
        ) {
          assert.isAtLeast(contrast(color(ink), over(color(ink), alpha, color(panel))), TEXT)
        }
      })
    }

    // bg-foreground/6 on a panel and /8 on a menu: docs/design/ui-system.md § Colour.
    it(`${theme}: a hover rises further than the surfaces step`, () => {
      const step = contrast(color("card"), color("popover"))
      assert.isAbove(contrast(over(color("foreground"), 0.06, color("card")), color("card")), step)
      assert.isAbove(contrast(over(color("foreground"), 0.08, color("popover")), color("popover")), step)
    })

    it(`${theme}: each surface rises above the last, with no hue to name`, () => {
      const [background, card, popover] = SURFACES.map((name) => oklchOf(tokens, name))
      assert.isBelow(background?.[0] ?? 1, card?.[0] ?? 0)
      assert.isBelow(card?.[0] ?? 1, popover?.[0] ?? 0)
      for (const name of [...SURFACES, "muted", "accent", "secondary"]) {
        assert.isAtMost(oklchOf(tokens, name)[1], MAX_SURFACE_CHROMA)
      }
    })
  }

  const dark = THEMES.dark

  // A track or a key chip sits on --popover in a dialog or a menu, so it can't share that tone.
  it("dark: the neutral fills rise above --popover", () => {
    for (const name of ["muted", "accent", "secondary"]) {
      assert.isAbove(oklchOf(dark, name)[0], oklchOf(dark, "popover")[0])
    }
  })

  // Past sRGB a browser clips the accent to a harsher cyan than the value says.
  it("dark: --primary stays inside sRGB", () => {
    for (const channel of unclippedOf(oklchOf(dark, "primary"))) {
      assert.isAtLeast(channel, 0)
      assert.isAtMost(channel, 1)
    }
  })
})
