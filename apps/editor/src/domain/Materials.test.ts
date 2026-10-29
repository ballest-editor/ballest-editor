import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { BLUE, GLASS, GLOW, materialsFile, OLD, OUTLINE, PIPE, TILES, WIND } from "../test/materials"
import { repoRoot } from "../test/samples"
import { lookupMaterial, parseMaterialsFile } from "./Materials"

describe("materials", () => {
  it("parses tolerant entries, skips broken ones, and resolves class-qualified paths", () => {
    const table = parseMaterialsFile(materialsFile)
    assert.strictEqual(table.skipped, 1)
    const blue = lookupMaterial(table, `/Script/Engine.MaterialInstanceConstant'${BLUE}'`)!
    assert.deepStrictEqual(blue.baseColor, [0.02, 0.1, 0.8])
    assert.isUndefined(blue.ormTexture) // the normal map reported as ORM is ignored
    const glass = lookupMaterial(table, GLASS)!
    assert.isTrue(glass.translucent && glass.twoSided)
    assert.isDefined(lookupMaterial(table, OLD)) // redirect alias
    // moved asset: same name, different folder
    assert.strictEqual(lookupMaterial(table, "/Game/Elsewhere/MI_Env_Blue_Smooth.MI_Env_Blue_Smooth"), blue)
    assert.isFalse(table.textureSrgb.get("textures/n.png"))
    // defaults for the texturing keys older files lack
    assert.deepStrictEqual(blue.tiling, { baseColor: [1, 1], normal: [1, 1], variation: [1, 1], opacity: [1, 1] })
    assert.strictEqual(blue.projection, "uv")
    assert.isUndefined(blue.outline)
    assert.isUndefined(blue.normalLayer)
    const outline = lookupMaterial(table, OUTLINE)!
    assert.strictEqual(outline.projection, "uv")
    assert.deepStrictEqual(outline.tiling.normal, [12, 12]) // a plain number widens to [u, v]
    assert.strictEqual(outline.variationTexture, "textures/macro.png")
    // the second normal read is the coarse layer at 0.2; the other variation octaves follow
    assert.deepStrictEqual(outline.normalLayer, { texture: "textures/tiles_n.png", tiling: [4, 4], strength: 0.2 })
    assert.deepStrictEqual(outline.variation, {
      texture: "textures/macro.png",
      tilings: [[0.2134, 0.2134], [0.05341, 0.05341], [0.002, 0.002]],
      offsets: [0.1, 0.2, 0.5],
      gain: -0.1
    })
    const tiles = lookupMaterial(table, TILES)!
    assert.strictEqual(tiles.projection, "object")
    assert.isTrue(tiles.instanceScale)
    assert.deepStrictEqual(tiles.tiling.normal, [0.005, 0.005])
    assert.deepStrictEqual(tiles.normalLayer, { texture: "textures/tiles_n.png", tiling: [0.06, 0.06], strength: 1 })
    assert.strictEqual(tiles.variation?.tilings.length, 1)
    assert.isUndefined(blue.variation)
    assert.deepStrictEqual(blue.colorLayers, [])
    const pipe = lookupMaterial(table, PIPE)!
    assert.deepStrictEqual(pipe.colorLayers, [
      { texture: "textures/grid.png", tiling: [5, 5], gain: [0.83, 0.124, 0], mean: [0.1, 0.1, 0.1] }
    ])
    assert.deepStrictEqual(outline.outline, { inset: [0, 0.1], color: [0.59, 0.59, 0.59] })
    const wind = lookupMaterial(table, WIND)!
    assert.isTrue(wind.translucent)
    assert.strictEqual(wind.opacityTexture, "textures/ray.png")
    assert.deepStrictEqual(wind.tiling.opacity, [0.25, 0.25])
    assert.deepStrictEqual(wind.opacityLayer, {
      texture: "textures/ray.png",
      tiling: [0.25, 0.25],
      gain: 0.6,
      mean: 0.3
    })
    assert.strictEqual(wind.upFade, 0)
    assert.isFalse(wind.additive)
    assert.deepStrictEqual(wind.programs.alpha?.textures, [{ uniform: "uTex0", texture: "textures/ray.png" }])
    assert.include(wind.programs.alpha?.code, "float ballestAlpha(")
    assert.isUndefined(wind.programs.base)
    assert.deepStrictEqual(blue.programs, {})
    const glow = lookupMaterial(table, GLOW)!
    assert.isTrue(glow.translucent && glow.additive)
    assert.deepStrictEqual([glow.opacity, glow.upFade, glow.emissive], [1, 0, [0.63, 0.03, 0.04]])
    assert.strictEqual(blue.upFade, 1)
    assert.strictEqual(parseMaterialsFile({ [BLUE]: materialsFile.materials[0] }).materials.size, 1) // bare map
    assert.strictEqual(parseMaterialsFile("nope").materials.size, 0)
  })

  const real = path.join(repoRoot, "assets", "materials.json")
  it.skipIf(!fs.existsSync(real))("decodes assets/materials.json", () => {
    const table = parseMaterialsFile(JSON.parse(fs.readFileSync(real, "utf8")))
    assert.isAbove(table.materials.size, 0)
    assert.strictEqual(table.skipped, 0)
    const blue = lookupMaterial(
      table,
      "/Game/Art/Materials/Environment/Materials/Instances/MI_Env_Glossy_Blue.MI_Env_Glossy_Blue"
    )!
    assert.isTrue(blue.baseColor[2] > blue.baseColor[0] && blue.baseColor[2] > blue.baseColor[1])
    const glass = lookupMaterial(table, "/Game/Art/Materials/Masters/M_GlassV2.M_GlassV2")!
    assert.isTrue(glass.translucent)
    // old maps reference this path; it must resolve (redirect or by name)
    assert.isDefined(
      lookupMaterial(
        table,
        "/Script/Engine.Material'/Game/Art/Materials/Masters/M_BaseSurface_Metal.M_BaseSurface_Metal'"
      )
    )
    assert.isBelow(glass.opacity, 1)
  })
})
