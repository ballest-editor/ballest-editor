import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { parseMaterialsFile } from "../domain/Materials"
import { BLUE, GLASS, materialsFile, OUTLINE, WIND } from "../test/materials"
import {
  applyShaderPatch,
  applySlotMaterials,
  materialFor,
  neutralMaterial,
  shaderPatchOf,
  type ShaderProgram,
  slotIndexOf
} from "./materials"

describe("three materials", () => {
  it("builds cached three materials: blue is blue, glass is translucent, unknown is neutral", () => {
    const table = parseMaterialsFile(materialsFile)
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
    // plain PBR: no shader patch
    assert.isUndefined(shaderPatchOf(blue))
  })

  it("patches the shader for tiling, triplanar projection, the mottle and the outline band", () => {
    const table = parseMaterialsFile(materialsFile)
    const outline = materialFor(table, OUTLINE)
    assert.deepStrictEqual(Object.keys(shaderPatchOf(outline)?.defines ?? {}).sort(), [
      "BALLEST_OUTLINE",
      "BALLEST_TILING",
      "BALLEST_TRIPLANAR",
      "BALLEST_VARIATION"
    ])
    assert.isDefined(outline.normalMap)
    // Materials with different patches must not share a compiled program.
    assert.notStrictEqual(outline.customProgramCacheKey(), materialFor(table, BLUE).customProgramCacheKey())
    const shader: ShaderProgram = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <project_vertex>",
      fragmentShader:
        "#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>\ntexture2D( normalMap, vNormalMapUv )"
    }
    const patch = shaderPatchOf(outline)
    assert.isDefined(patch)
    applyShaderPatch(shader, patch)
    assert.strictEqual(shader.uniforms["uNormalTiling"]?.value, 12)
    assert.deepStrictEqual(shader.uniforms["uOutlineInset"]?.value, new THREE.Vector2(0, 0.1))
    assert.include(shader.fragmentShader, "uOutlineColor")
    assert.include(shader.fragmentShader, "uVariationMap")
    assert.notInclude(shader.fragmentShader, "#include <normal_fragment_maps>") // replaced by the triplanar normal
    assert.include(shader.vertexShader, "vBallestWorldPos")
  })

  it("shapes a translucent effect with its opacity texture and adds it to the scene", () => {
    const table = parseMaterialsFile(materialsFile)
    const wind = materialFor(table, WIND)
    assert.isTrue(wind.transparent)
    assert.isDefined(wind.alphaMap)
    assert.strictEqual(wind.blending, THREE.AdditiveBlending)
    assert.isFalse(wind.depthWrite)
    assert.deepStrictEqual(shaderPatchOf(wind)?.defines, { BALLEST_TILING: 1 })
    assert.strictEqual(wind.defines?.["STANDARD"], "") // three's own define survives the patch
  })

  it("assigns materials per primitive by UE slot index", () => {
    const table = parseMaterialsFile(materialsFile)
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
})
