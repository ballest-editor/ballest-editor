import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { sceneAxisColors } from "./axisColors"
import { SCENE_COLORS } from "./sceneColors"
import { OUTLINE_COLORS } from "./selectionOutline"

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
})
