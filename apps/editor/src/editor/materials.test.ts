import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { parseMaterialsFile } from "../domain/Materials"
import { BLUE, GLASS, GLOW, materialsFile, OUTLINE, PIPE, primitive, TILES, WIND } from "../test/materials"
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
  // What onBeforeCompile receives: includes still unexpanded.
  const program = (): ShaderProgram => ({
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader:
      "#include <common>\n#include <normalmap_pars_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>\n#include <emissivemap_fragment>\n#include <normal_fragment_maps>"
  })

  it("builds cached three materials: blue is blue, glass is translucent, unknown is neutral", () => {
    const table = parseMaterialsFile(materialsFile)
    const blue = materialFor(table, BLUE)
    assert.isTrue(blue.color.b > blue.color.r && blue.color.b > blue.color.g)
    assert.strictEqual(materialFor(table, BLUE), blue) // cached
    const glass = materialFor(table, GLASS)
    assert.isTrue(glass.transparent)
    assert.isBelow(glass.opacity, 1)
    assert.strictEqual(glass.normalMap?.colorSpace, THREE.NoColorSpace)
    assert.isBelow(glass.normalScale.y, 0) // DirectX green flipped
    assert.strictEqual(glass.side, THREE.DoubleSide) // the game material is two-sided
    assert.strictEqual(blue.side, THREE.FrontSide)
    assert.strictEqual(materialFor(table, "/Game/Unknown.Unknown"), neutralMaterial())
    assert.strictEqual(materialFor(null, BLUE), neutralMaterial())
    // plain PBR: no shader patch
    assert.isUndefined(shaderPatchOf(blue))
  })

  it("patches the shader for tiling, a second normal layer, the mottle and the outline band", () => {
    const table = parseMaterialsFile(materialsFile)
    const outline = materialFor(table, OUTLINE)
    assert.deepStrictEqual(Object.keys(shaderPatchOf(outline)?.defines ?? {}).sort(), [
      "BALLEST_NORMAL2",
      "BALLEST_OUTLINE",
      "BALLEST_TILING",
      "BALLEST_VARIATION"
    ])
    assert.isDefined(outline.normalMap)
    // Materials with different patches must not share a compiled program.
    assert.notStrictEqual(outline.customProgramCacheKey(), materialFor(table, BLUE).customProgramCacheKey())
    const shader = program()
    const patch = shaderPatchOf(outline)
    assert.isDefined(patch)
    applyShaderPatch(shader, patch)
    assert.deepStrictEqual(shader.uniforms["uNormalTiling"]?.value, new THREE.Vector2(12, 12))
    assert.deepStrictEqual(shader.uniforms["uNormal2Tiling"]?.value, new THREE.Vector2(4, 4))
    assert.strictEqual(shader.uniforms["uNormal2Strength"]?.value, 0.2)
    assert.deepStrictEqual(shader.uniforms["uVariationTiling3"]?.value, new THREE.Vector2(0.002, 0.002))
    assert.deepStrictEqual(shader.uniforms["uVariationShape"]?.value, new THREE.Vector4(0.1, 0.2, 0.5, -0.1))
    assert.strictEqual(patch.defines["BALLEST_VARIATION"], 3)
    assert.include(shader.fragmentShader, "diffuseColor.rgb *= 1.0 + uVariationShape.w * ballestMottle;")
    assert.deepStrictEqual(shader.uniforms["uOutlineInset"]?.value, new THREE.Vector2(0, 0.1))
    assert.include(shader.fragmentShader, "uOutlineColor")
    assert.include(shader.fragmentShader, "uVariationMap")
    // UV projection keeps three's tangent frame: only the map read is swapped for the layered one.
    assert.include(shader.fragmentShader, "vec3 mapN = ballestMapN();")
    assert.notInclude(shader.fragmentShader, "texture2D( normalMap, vNormalMapUv )")
    assert.include(shader.fragmentShader, "texture2D( alphaMap, ballestUv( uOpacityTiling ) )")
    assert.include(shader.fragmentShader, "texture2D( map, ballestUv( uBaseColorTiling ) )")
    assert.notInclude(shader.fragmentShader, "#include <map_fragment>")
    assert.include(shader.vertexShader, "vBallestScale")
  })

  it("projects object-aligned materials through the face's dominant axis, scaled like the piece", () => {
    const table = parseMaterialsFile(materialsFile)
    const tiles = materialFor(table, TILES)
    const patch = shaderPatchOf(tiles)
    assert.isDefined(patch)
    assert.deepStrictEqual(Object.keys(patch.defines).sort(), [
      "BALLEST_INSTANCE_SCALE",
      "BALLEST_NORMAL2",
      "BALLEST_OBJECT",
      "BALLEST_TILING",
      "BALLEST_VARIATION"
    ])
    assert.deepStrictEqual(patch.uniforms.uNormalTiling.value, new THREE.Vector2(0.005, 0.005))
    // one mottle layer: the other two read as constant 1
    assert.strictEqual(patch.defines["BALLEST_VARIATION"], 1)
    assert.deepStrictEqual(patch.uniforms.uVariationShape.value, new THREE.Vector4(0.5, 1, 1, -0.1))
    const shader: ShaderProgram = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <project_vertex>",
      fragmentShader: "#include <common>\n#include <normalmap_pars_fragment>\n#include <normal_fragment_maps>"
    }
    applyShaderPatch(shader, patch)
    // the whole normal chunk goes: the perturbation happens in the object frame
    assert.notInclude(shader.fragmentShader, "#include <normal_fragment_maps>")
    assert.include(shader.fragmentShader, "vBallestNormalMatrix * pn")
    assert.include(shader.fragmentShader, "c *= vBallestScale.xy")
  })

  it("adds colour layers to the base colour at their gain", () => {
    const table = parseMaterialsFile(materialsFile)
    const pipe = materialFor(table, PIPE)
    const patch = shaderPatchOf(pipe)
    assert.isDefined(patch)
    assert.deepStrictEqual(patch.defines, { BALLEST_COLOR: 1 })
    assert.deepStrictEqual(patch.uniforms.uColor1Gain.value, new THREE.Vector3(0.83, 0.124, 0))
    assert.isNull(pipe.map) // the layer is not three's own map
    const shader: ShaderProgram = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <project_vertex>",
      fragmentShader:
        "#include <common>\n#include <normalmap_pars_fragment>\n#include <map_fragment>\n#include <normal_fragment_maps>"
    }
    applyShaderPatch(shader, patch)
    assert.include(
      shader.fragmentShader,
      "uColor1Gain * ( texture2D( uColorMap1, ballestUv( uColor1Tiling ) ).rgb - uColor1Mean )"
    )
    assert.deepStrictEqual(patch.uniforms.uColor1Mean.value, new THREE.Vector3(0.1, 0.1, 0.1))
    // no normal map: the normal-layer helper must not reference one
    assert.include(shader.fragmentShader, "#ifdef USE_NORMALMAP\nvec3 ballestMapN()")
  })

  it("shapes a translucent effect with its opacity texture and adds it to the scene", () => {
    const table = parseMaterialsFile(materialsFile)
    const wind = materialFor(table, WIND)
    assert.isTrue(wind.transparent)
    assert.isNull(wind.alphaMap) // the alpha layer is the patch's, around the evaluated opacity
    assert.strictEqual(wind.blending, THREE.NormalBlending)
    assert.isFalse(wind.depthWrite)
    // The game's own alpha math replaces the layered stand-in and its up fade.
    assert.deepStrictEqual(shaderPatchOf(wind)?.defines, {
      BALLEST_TILING: 1,
      BALLEST_ALPHA: 1,
      BALLEST_ALPHA_CHANNEL: "r",
      BALLEST_PROGRAM_ALPHA: 1
    })
    assert.deepStrictEqual(shaderPatchOf(wind)?.uniforms.uAlphaShape.value, new THREE.Vector2(0.6, 0.3))
    assert.isDefined(shaderPatchOf(wind)?.uniforms["uTex0"])
    assert.strictEqual(shaderPatchOf(wind)?.uniforms.uBallestTime.value, 0)
    assert.strictEqual(wind.defines?.["STANDARD"], "") // three's own define survives the patch
    const shader = program()
    applyShaderPatch(shader, shaderPatchOf(wind)!)
    assert.include(shader.vertexShader, "vBallestUp = abs( vBallestWorldNormal.z )")
    assert.include(shader.fragmentShader, "uniform sampler2D uTex0;\nfloat ballestAlpha(")
    assert.include(shader.fragmentShader, "ballestUv( uAlphaTiling ) ).BALLEST_ALPHA_CHANNEL")
    assert.include(
      shader.fragmentShader,
      "diffuseColor.a = ballestAlpha( vBallestUv, vBallestWorldNormal, vBallestLocal, uBallestTime )"
    )
    assert.include(shader.fragmentShader, "#include <emissivemap_fragment>")
    // the program is part of the material, so it cannot share a compiled program with another
    assert.notStrictEqual(wind.customProgramCacheKey(), materialFor(table, GLASS).customProgramCacheKey())
  })

  it("adds an additive glow to the scene and fades its end caps", () => {
    const table = parseMaterialsFile(materialsFile)
    const glow = materialFor(table, GLOW)
    assert.isTrue(glow.transparent)
    assert.strictEqual(glow.blending, THREE.AdditiveBlending)
    assert.strictEqual(glow.opacity, 1)
    assert.deepStrictEqual(glow.emissive.toArray().map((c) => +c.toFixed(2)), [0.63, 0.03, 0.04])
    assert.deepStrictEqual(shaderPatchOf(glow)?.defines, { BALLEST_PROGRAM_GLOW: 1 })
    const shader = program()
    applyShaderPatch(shader, shaderPatchOf(glow)!)
    assert.include(
      shader.fragmentShader,
      "totalEmissiveRadiance = ballestGlow( vBallestUv, vBallestWorldNormal, vBallestLocal, uBallestTime );"
    )
    assert.notInclude(shader.fragmentShader, "#include <emissivemap_fragment>")
  })

  it("assigns materials per primitive by UE slot index", () => {
    const table = parseMaterialsFile(materialsFile)
    const root = new THREE.Group()
    const a = primitive("0:Base")
    const b = primitive("1:Glass")
    root.add(a, b)
    assert.deepStrictEqual([slotIndexOf(a), slotIndexOf(b)], [0, 1])
    applySlotMaterials(root, table, [BLUE, GLASS])
    assert.strictEqual(a.material, materialFor(table, BLUE))
    assert.strictEqual(b.material, materialFor(table, GLASS))
  })
})
