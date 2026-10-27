import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { BLUE, GLASS, materialsFile, OLD } from "../test/materials"
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
