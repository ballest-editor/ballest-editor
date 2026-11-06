import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { SKY_HAZE_BELOW } from "./sky"
import {
  addFade,
  setWaterFloor,
  setWaterLight,
  setWaterTheme,
  THIN_INTO_SKY,
  THIN_WITH_DISTANCE,
  WATER_LOOKS,
  waterHaze,
  waterTopMaterial,
  waterUnderMaterial
} from "./water"

describe("water", () => {
  it("dims both sides with the light and restores them at 1", () => {
    setWaterLight(1)
    const full = waterTopMaterial.color.clone()
    setWaterLight(0.25)
    assert.closeTo(waterTopMaterial.color.r, full.r * 0.25, 1e-6)
    assert.closeTo(waterUnderMaterial.color.b, full.b * 0.25, 1e-6)
    setWaterLight(1)
    assert.isTrue(waterTopMaterial.color.equals(full))
  })

  it("takes each theme's colour and opacity, and keeps the light it is under", () => {
    setWaterLight(0.5)
    for (const theme of ["light", "dark"] as const) {
      setWaterTheme(theme)
      const { color, opacity } = WATER_LOOKS[theme]
      const lit = new THREE.Color(color).multiplyScalar(0.5)
      assert.isTrue(waterTopMaterial.color.equals(lit), theme)
      assert.isTrue(waterUnderMaterial.color.equals(lit), theme)
      assert.strictEqual(waterTopMaterial.opacity, opacity)
    }
    setWaterLight(1)
  })

  it("reaches the screen as it is written, past the renderer's tone mapping", () => {
    assert.isFalse(waterTopMaterial.toneMapped)
    assert.isFalse(waterUnderMaterial.toneMapped)
  })

  it("thins out in a perspective pane only, before the rest of the fragment's output", () => {
    const { fragmentShader, vertexShader } = THREE.ShaderLib.basic
    const shader = addFade({ fragmentShader, vertexShader }, "/* fade */", "/* extra */")
    assert.include(shader.vertexShader, "vWaterWorld = ")
    const orthographic = shader.fragmentShader.indexOf("if (!isOrthographic)")
    const fade = shader.fragmentShader.indexOf("/* fade */")
    const extra = shader.fragmentShader.indexOf("/* extra */")
    const output = shader.fragmentShader.indexOf("#include <opaque_fragment>")
    assert.isTrue(orthographic >= 0 && orthographic < fade && fade < extra && extra < output)
  })

  // Both go by the sky's own curve, so the water can't thin out before the haze has come in.
  it("thins out from above by the sky's haze, for the floor and the theme", () => {
    assert.include(THIN_INTO_SKY, "ballestSkyHaze(toWater, min(uClipY, cameraPosition.y), uHazeBelow)")
    setWaterFloor(8615)
    setWaterTheme("light")
    assert.strictEqual(waterHaze.uClipY.value, 8615)
    assert.strictEqual(waterHaze.uHazeBelow.value, SKY_HAZE_BELOW.light)
    setWaterTheme("dark")
    assert.strictEqual(waterHaze.uHazeBelow.value, SKY_HAZE_BELOW.dark)
  })

  it("thins out from below by distance, because looking up is all haze", () => {
    assert.include(THIN_WITH_DISTANCE, "smoothstep(8000.0, 60000.0, away)")
    assert.notInclude(THIN_WITH_DISTANCE, "ballestSkyHaze")
  })
})
