import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { SCENE_COLORS } from "../domain/sceneGround"
import { SEA_RELIEF, SEA_SHADE_GLSL, SEA_SHOWN, SKY_HAZE_GLSL } from "./sky"
import {
  addFade,
  SEA_SURFACE,
  setWaterLight,
  setWaterShown,
  setWaterTheme,
  THIN_INTO_SKY,
  THIN_WITH_DISTANCE,
  WATER_LOOKS,
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

  // The canvas blends encoded colours, so a sum made before encoding wouldn't match the dome's.
  it("adds the sea's surface to the finished colour, by the same sum as the dome", () => {
    const { fragmentShader, vertexShader } = THREE.ShaderLib.basic
    const shader = addFade({ fragmentShader, vertexShader }, "", "", SEA_SURFACE)
    assert.include(shader.fragmentShader, SEA_SHADE_GLSL)
    assert.isAbove(
      shader.fragmentShader.indexOf("ballestSeaShade(vWaterWorld.xz"),
      shader.fragmentShader.indexOf("#include <colorspace_fragment>")
    )
    assert.include(SEA_SURFACE, "/ opacity")
  })

  // Measuring it from the sea's colour went the wrong way on a pale sea: the clear colour keeps that bright as the water dims.
  it("dims the sea's surface with the light, in each theme's strength", () => {
    for (const theme of ["light", "dark"] as const) {
      setWaterTheme(theme)
      setWaterLight(1)
      assert.strictEqual(SEA_RELIEF.value, WATER_LOOKS[theme].relief)
      setWaterLight(0.25)
      assert.closeTo(SEA_RELIEF.value, WATER_LOOKS[theme].relief * 0.25, 1e-6)
    }
    setWaterLight(1)
    setWaterTheme("dark")
  })

  // A curve that took the camera's height in covered the whole floor from high enough up.
  it("thins out from above by the sky's curve, which goes by the direction alone", () => {
    assert.include(THIN_INTO_SKY, "ballestSkyHaze(toWater)")
    assert.notInclude(SKY_HAZE_GLSL, "cameraPosition")
  })

  it("gives the dome the sea as it reaches the screen: the water over the clear colour, in the light it is under", () => {
    const encoded = (hex: string) => new THREE.Color(hex).convertLinearToSRGB()
    for (const theme of ["light", "dark"] as const) {
      setWaterTheme(theme)
      const { color, opacity } = WATER_LOOKS[theme]
      const sea = encoded(SCENE_COLORS[theme]).lerp(encoded(color), opacity).convertSRGBToLinear()
      assert.closeTo(SEA_SHOWN.value.x, sea.r, 1e-6, theme)
      assert.closeTo(SEA_SHOWN.value.y, sea.g, 1e-6, theme)
      assert.closeTo(SEA_SHOWN.value.z, sea.b, 1e-6, theme)
    }
    const lit = SEA_SHOWN.value.y
    setWaterLight(0.25)
    assert.isBelow(SEA_SHOWN.value.y, lit)
    setWaterLight(1)
    setWaterTheme("dark")
  })

  // The dome makes up what the fading sheet leaves, which depends on how thick the sheet goes on.
  it("tells the dome the sheet's opacity, and takes the sea out of it with the water", () => {
    setWaterTheme("light")
    assert.strictEqual(SEA_SHOWN.value.w, WATER_LOOKS.light.opacity)
    setWaterShown(false)
    assert.strictEqual(SEA_SHOWN.value.w, 0)
    setWaterTheme("dark")
    assert.strictEqual(SEA_SHOWN.value.w, 0)
    setWaterShown(true)
    assert.strictEqual(SEA_SHOWN.value.w, WATER_LOOKS.dark.opacity)
  })

  it("thins out from below by distance, because looking up is all haze", () => {
    assert.include(THIN_WITH_DISTANCE, "smoothstep(8000.0, 60000.0, away)")
    assert.notInclude(THIN_WITH_DISTANCE, "ballestSkyHaze")
  })
})
