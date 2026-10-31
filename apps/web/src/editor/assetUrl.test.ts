import { describe, expect, it } from "@effect/vitest"
import { assetUrl, textureUrl } from "./assetUrl"

describe("asset urls", () => {
  it("serves every asset from the app's own /assets/", () => {
    expect(assetUrl("catalog.json")).toBe("/assets/catalog.json")
    expect(assetUrl("pieces/Maps/SM_500.glb")).toBe("/assets/pieces/Maps/SM_500.glb")
  })

  it("asks for the AVIF of a texture the extractor named as png", () => {
    expect(textureUrl("textures/T_Grid_N.png")).toBe("/assets/textures/T_Grid_N.avif")
    expect(textureUrl("/absolute/x.png")).toBe("/absolute/x.png")
  })
})
