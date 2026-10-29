import { assert, describe, it } from "@effect/vitest"
import { setWaterLight, waterTopMaterial, waterUnderMaterial } from "./water"

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
})
