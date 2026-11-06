import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import {
  addDistanceFade,
  setWaterLight,
  setWaterTheme,
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

  it("thins out with distance, in a perspective pane only, before the rest of the fragment's output", () => {
    const { fragmentShader, vertexShader } = THREE.ShaderLib.basic
    const shader = addDistanceFade({ fragmentShader, vertexShader }, "/* extra */")
    assert.include(shader.vertexShader, "vWaterWorld = ")
    const fade = shader.fragmentShader.indexOf("if (!isOrthographic)")
    const extra = shader.fragmentShader.indexOf("/* extra */")
    const output = shader.fragmentShader.indexOf("#include <opaque_fragment>")
    assert.isTrue(fade >= 0 && fade < extra && extra < output)
    assert.include(shader.fragmentShader, "smoothstep(8000.0, 60000.0, away)")
  })
})
