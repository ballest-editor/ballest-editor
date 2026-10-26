import * as fs from "node:fs"
import * as path from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import * as THREE from "three"
import { applySlotMaterials, materialFor, neutralMaterial, slotIndexOf } from "../editor/materials"
import { MaterialLibrary } from "../services/MaterialLibrary"
import { repoRoot } from "../test/samples"
import { lookupMaterial, parseMaterialsFile } from "./Materials"

const BLUE = "/Game/Art/Materials/Environment/Materials/Instances_2/MI_Env_Blue_Smooth.MI_Env_Blue_Smooth"
const GLASS = "/Game/Art/Materials/M_GlassV2.M_GlassV2"
const OLD = "/Game/Art/Materials/Masters/M_BaseSurface_Metal.M_BaseSurface_Metal"
const file = {
  version: 1,
  materials: [
    {
      path: BLUE,
      blendMode: "BLEND_Opaque",
      approx: { baseColor: [0.02, 0.1, 0.8], metallic: 0, roughness: 0.3, normalTexture: "textures/n.png", ormTexture: "textures/n.png" },
      recovered: true
    },
    {
      path: GLASS,
      blendMode: "BLEND_TranslucentGreyTransmittance",
      twoSided: true,
      approx: { baseColor: [0.8, 0.9, 1], opacity: 0.7, normalTexture: "textures/glass_n.png" },
      recovered: true
    },
    { path: "/Game/New/M_Metal.M_Metal", redirectedTo: OLD, approx: { baseColor: [0.5, 0.5, 0.5] } },
    { path: "/Game/Broken.Broken", approx: { baseColor: "red" } }
  ],
  textures: [{ png: "textures/n.png", sRGB: false }]
}

describe("materials", () => {
  it("parses tolerant entries, skips broken ones, and resolves class-qualified paths", () => {
    const table = parseMaterialsFile(file)
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
    assert.strictEqual(parseMaterialsFile({ [BLUE]: file.materials[0] }).materials.size, 1) // bare map
    assert.strictEqual(parseMaterialsFile("nope").materials.size, 0)
  })

  it("builds cached three materials: blue is blue, glass is translucent, unknown is neutral", () => {
    const table = parseMaterialsFile(file)
    const blue = materialFor(table, BLUE)
    assert.isTrue(blue.color.b > blue.color.r && blue.color.b > blue.color.g)
    assert.strictEqual(materialFor(table, BLUE), blue) // cached
    const glass = materialFor(table, GLASS)
    assert.isTrue(glass.transparent)
    assert.isBelow(glass.opacity, 1)
    assert.strictEqual(glass.normalMap?.colorSpace, THREE.NoColorSpace)
    assert.strictEqual(glass.normalScale.y, -1)
    assert.strictEqual(glass.side, THREE.DoubleSide) // the game material is two-sided
    assert.strictEqual(blue.side, THREE.FrontSide)
    assert.strictEqual(materialFor(table, "/Game/Unknown.Unknown"), neutralMaterial())
    assert.strictEqual(materialFor(null, BLUE), neutralMaterial())
  })

  it("assigns materials per primitive by UE slot index", () => {
    const table = parseMaterialsFile(file)
    const root = new THREE.Group()
    const prim = (name: string) => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name }))
    const a = prim("0:Base")
    const b = prim("1:Glass")
    root.add(a, b)
    assert.deepStrictEqual([slotIndexOf(a), slotIndexOf(b)], [0, 1])
    applySlotMaterials(root, table, [BLUE, GLASS])
    assert.strictEqual(a.material, materialFor(table, BLUE))
    assert.strictEqual(b.material, materialFor(table, GLASS))
  })

  it.effect("falls back to an empty table when the file is missing", () =>
    Effect.gen(function*() {
      const library = MaterialLibrary.make(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") }))
      assert.strictEqual((yield* library.load).materials.size, 0)
    }))

  const real = path.join(repoRoot, "assets", "materials.json")
  it.skipIf(!fs.existsSync(real))("decodes assets/materials.json", () => {
    const table = parseMaterialsFile(JSON.parse(fs.readFileSync(real, "utf8")))
    assert.isAbove(table.materials.size, 0)
    assert.strictEqual(table.skipped, 0)
    const blue = lookupMaterial(table, "/Game/Art/Materials/Environment/Materials/Instances/MI_Env_Glossy_Blue.MI_Env_Glossy_Blue")!
    assert.isTrue(blue.baseColor[2] > blue.baseColor[0] && blue.baseColor[2] > blue.baseColor[1])
    const glass = lookupMaterial(table, "/Game/Art/Materials/Masters/M_GlassV2.M_GlassV2")!
    assert.isTrue(glass.translucent)
    // old maps reference this path; it must resolve (redirect or by name)
    assert.isDefined(lookupMaterial(table, "/Script/Engine.Material'/Game/Art/Materials/Masters/M_BaseSurface_Metal.M_BaseSurface_Metal'"))
    assert.isBelow(glass.opacity, 1)
  })
})
