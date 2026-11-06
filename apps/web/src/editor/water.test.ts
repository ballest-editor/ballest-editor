import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { addDistanceFade, setWaterLight, waterTopMaterial, waterUnderMaterial } from "./water"

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
