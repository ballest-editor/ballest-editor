import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { shadeOf } from "../domain/sceneGround"
import { AUTO_GRID_COLORS } from "../domain/Settings"
import { AXIS_BG_CLASSES, sceneAxisColors } from "./axisColors"
import { ORTHO_GROUND, SCENE_COLORS, sceneBackgroundClass } from "./sceneColors"
import { OUTLINE_COLORS } from "./selectionOutline"
import { WATER_LOOKS } from "./water"

const luminance = (hex: string) => {
  const { r, g, b } = new THREE.Color(hex) // linear
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** WCAG's bar for graphics. */
const READABLE = 3

/**
 * The bars for the grid: sections are read at a glance, cells only have to show. Light's are lower: its water is a mid
 * blue, and there the dark theme's bars make the grid the loudest thing on screen.
 */
const GRID_BARS = { dark: { section: 3, cell: 1.5 }, light: { section: 2, cell: 1.3 } } as const

/** The floors the grid's full colour is seen on: the ground, the water over it at full light, an orthographic pane's. */
const floorsOf = (theme: "dark" | "light") => {
  const { color, opacity } = WATER_LOOKS[theme]
  return [SCENE_COLORS[theme], shadeOf(SCENE_COLORS[theme], color, opacity), ORTHO_GROUND[theme]]
}

describe("what's drawn over the scene", () => {
  for (const dark of [true, false]) {
    const theme = dark ? "dark" : "light"
    it(`reads against the ${theme} theme's background`, () => {
      const colors = [...Object.values(sceneAxisColors(dark)), ...Object.values(OUTLINE_COLORS[theme])]
      for (const color of colors) {
        assert.isAtLeast(contrast(color, SCENE_COLORS[theme]), READABLE, color)
        assert.isAtLeast(contrast(color, ORTHO_GROUND[theme]), READABLE, `${color} in an orthographic pane`)
      }
    })

    it(`draws the grid in the ${theme} theme so it reads on the ground and on the water over it`, () => {
      for (const floor of floorsOf(theme)) {
        assert.isAtLeast(contrast(AUTO_GRID_COLORS[theme].cell, floor), GRID_BARS[theme].cell, `cell on ${floor}`)
        assert.isAtLeast(
          contrast(AUTO_GRID_COLORS[theme].section, floor),
          GRID_BARS[theme].section,
          `section on ${floor}`
        )
      }
    })
  }

  it("keeps the light theme's orthographic ground between the clear colour and the water", () => {
    const { color, opacity } = WATER_LOOKS.light
    const water = shadeOf(SCENE_COLORS.light, color, opacity)
    assert.isBelow(luminance(ORTHO_GROUND.light), luminance(SCENE_COLORS.light))
    assert.isAbove(luminance(ORTHO_GROUND.light), luminance(water))
  })

  it("spells the axes out for Tailwind as they are", () => {
    for (const axis of ["x", "y", "z"] as const) {
      assert.strictEqual(AXIS_BG_CLASSES[axis], `bg-[${sceneAxisColors(true)[axis]}]`)
    }
  })

  it("spells the ground out for Tailwind as it is", () => {
    assert.include(sceneBackgroundClass, `bg-[${SCENE_COLORS.light}]`)
    assert.include(sceneBackgroundClass, `dark:bg-[${SCENE_COLORS.dark}]`)
  })
})
