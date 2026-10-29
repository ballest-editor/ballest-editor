import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { BLUE, GLASS, materialsFile, OLD, OUTLINE, WIND } from "../test/materials"
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
    assert.deepStrictEqual(blue.tiling, { baseColor: 1, normal: 1, variation: 1, opacity: 1 })
    assert.isFalse(blue.triplanar)
    assert.isUndefined(blue.outline)
    const outline = lookupMaterial(table, OUTLINE)!
    assert.isTrue(outline.triplanar)
    assert.strictEqual(outline.tiling.normal, 12)
    assert.strictEqual(outline.variationTexture, "textures/macro.png")
    assert.deepStrictEqual(outline.outline, { inset: [0, 0.1], color: [0.59, 0.59, 0.59] })
    const wind = lookupMaterial(table, WIND)!
    assert.isTrue(wind.translucent)
    assert.strictEqual(wind.opacityTexture, "textures/ray.png")
    assert.strictEqual(wind.tiling.opacity, 0.25)
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
