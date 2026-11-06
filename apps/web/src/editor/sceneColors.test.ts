import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { shadeOf } from "../domain/sceneGround"
import { AUTO_GRID_COLORS } from "../domain/Settings"
import { sceneAxisColors } from "./axisColors"
import { SCENE_COLORS, sceneBackgroundClass } from "./sceneColors"
import { OUTLINE_COLORS } from "./selectionOutline"
import { waterTopMaterial } from "./water"

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

/** The bars for the grid: sections are read at a glance, cells only have to show. */
const GRID_SECTION = 3
const GRID_CELL = 1.5

/** The water as it reaches the screen, past the renderer's tone mapping (measured in the app). */
const WATER_ON_SCREEN = "#00669e"

describe("what's drawn over the scene", () => {
  for (const dark of [true, false]) {
    const theme = dark ? "dark" : "light"
    it(`reads against the ${theme} theme's background`, () => {
      const colors = [...Object.values(sceneAxisColors(dark)), ...Object.values(OUTLINE_COLORS[theme])]
      for (const color of colors) {
        assert.isAtLeast(contrast(color, SCENE_COLORS[theme]), READABLE, color)
      }
    })
  }

  it("draws the grid in the light theme so it reads on the ground and on the water over it", () => {
    const ground = SCENE_COLORS.light
    for (const floor of [ground, shadeOf(ground, WATER_ON_SCREEN, waterTopMaterial.opacity)]) {
      assert.isAtLeast(contrast(AUTO_GRID_COLORS.light.cell, floor), GRID_CELL, `cell on ${floor}`)
      assert.isAtLeast(contrast(AUTO_GRID_COLORS.light.section, floor), GRID_SECTION, `section on ${floor}`)
    }
  })

  it("draws the grid in the dark theme so it reads on the ground", () => {
    const ground = SCENE_COLORS.dark
    assert.isAtLeast(contrast(AUTO_GRID_COLORS.dark.cell, ground), GRID_CELL)
    assert.isAtLeast(contrast(AUTO_GRID_COLORS.dark.section, ground), GRID_SECTION)
  })

  it("spells the ground out for Tailwind as it is", () => {
    assert.include(sceneBackgroundClass, `bg-[${SCENE_COLORS.light}]`)
    assert.include(sceneBackgroundClass, `dark:bg-[${SCENE_COLORS.dark}]`)
  })
})
