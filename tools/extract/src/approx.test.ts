import { assert, describe, it } from "@effect/vitest"
import { approxOf, layersOf, picksOf, readsOf, sourceOf, type Surface, translucencyOf } from "./approx.ts"
import type { Leaf } from "./dxil.ts"
import type { Merged } from "./params.ts"
import type { MaterialShaders } from "./shaders.ts"

const leaf = (over: Partial<Leaf>): Leaf => ({
  kind: "input",
  source: "TEXCOORD0",
  component: "x",
  factor: 1,
  params: [],
  sceneDepth: 0,
  sceneScale: 0,
  ...over
})
const attribute0 = (component: string): Leaf => leaf({ source: "ATTRIBUTE0", component, factor: 1, sceneDepth: 1 })
const buffer = (component: string): Leaf => leaf({ kind: "buffer", source: "t5", component })

const NORMAL = "/Game/Art/T_Normal.T_Normal"
const GRID = "/Game/Art/T_Grid.T_Grid"
const MOTTLE = "/Game/Art/T_MacroVariation.T_MacroVariation"
const TEXTURES = [NORMAL, GRID, MOTTLE]
const textureOf = (slot: number) => TEXTURES[slot] ?? null
const textureInfo = (texture: string) =>
  texture === NORMAL ? { compression: "TC_Normalmap" } : texture === MOTTLE ? { sRGB: false } : { sRGB: true }
const texPath = (texture: string | null) => (texture === null ? null : `textures/${texture.split("/").pop()}.png`)

const SURFACE: Surface = {
  baseColor: [0.2, 0.3, 1.4],
  metallic: 0,
  roughness: 0.4,
  opacity: null,
  opacitySide: null,
  alphaRange: null,
  emissive: [0, 0, 0],
  emissiveSide: [0, 0, 0],
  programs: {},
  gains: { "1": { gain: [0.5, 0.1, 0], alpha: 0, mean: [0.4, 0.4, 0.4] } }
}

// An opaque master in the shape shaders.json gives: a normal map on the mesh UVs tiled 12 x `UV Tile`, a colour
// read projected from the object-aligned position (SV_Position through the object's inverse) once per 200 cm
// and scaled like the instance, the mottle on an interpolant the vertex shader fills from the world position,
// and an engine texture.
const SHADERS: MaterialShaders = {
  pixel: "M_Test/ps.dxil",
  vertex: "M_Test/vs.dxil",
  textures: [{ index: 0, param: "Normal" }, { index: 1, param: null }, { index: 2, param: null }],
  materialBuffer: "cb3",
  slots: [{ ref: "[0].x", param: "UV Tile" }, { ref: "[0].z", param: "ColorContrast" }],
  paramNames: ["UV Tile", "ColorContrast"],
  reads: [
    {
      texture: 0,
      op: "sample",
      channels: "xy",
      resultFactor: 2,
      coords: [
        { leaves: [leaf({ component: "x", factor: 12, params: ["cb3[0].x"] })] },
        { leaves: [leaf({ component: "y", factor: 12, params: ["cb3[0].x"] })] }
      ]
    },
    {
      texture: 1,
      op: "sample",
      channels: "xyz",
      resultFactor: null,
      coords: [
        { leaves: [leaf({ source: "SV_Position", component: "x", factor: 0.005, sceneDepth: 1, sceneScale: 1 })] },
        { leaves: [leaf({ source: "SV_Position", component: "y", factor: -0.005, sceneDepth: 1 })] }
      ]
    },
    {
      texture: 2,
      op: "sample",
      channels: "x",
      resultFactor: null,
      coords: [
        { leaves: [leaf({ source: "TEXCOORD1", component: "x", factor: 0.01 })] },
        { leaves: [leaf({ source: "TEXCOORD1", component: "y", factor: 0.01 })] }
      ]
    },
    { texture: -1, op: "sample", channels: "x", resultFactor: null, coords: [] }
  ],
  mottle: { reads: [2], offsets: [0.5], gain: { sign: -1, constant: 1, param: "cb3[0].z", paramAdd: -1 } },
  interpolants: {
    "TEXCOORD0.x": [buffer("x")],
    "TEXCOORD0.y": [buffer("y")],
    "TEXCOORD1.x": [attribute0("x")],
    "TEXCOORD1.y": [attribute0("y")]
  },
  surface: SURFACE
}

const MERGED: Merged = {
  scalars: { "UV Tile": 2, ColorContrast: 1.1, "Size X": 0.75, "Size Y": 1 },
  vectors: { BaseColor: [1, 0, 0, 1], OutlineBase: [0.1, 0.1, 0.1, 1], EmissiveColor: [0, 0, 0, 1] },
  textures: { Normal: NORMAL },
  switches: {}
}

describe("sourceOf", () => {
  it("names where a coordinate leaf comes from: the UVs, or a projection of the object / world position", () => {
    assert.deepStrictEqual(sourceOf(SHADERS, leaf({ factor: 12 })), { projection: "uv", factor: 12, depth: 0 })
    assert.deepStrictEqual(sourceOf(SHADERS, leaf({ source: "TEXCOORD1", factor: -0.5 })), {
      projection: "world",
      factor: 0.5,
      depth: 1
    })
    assert.deepStrictEqual(sourceOf(SHADERS, leaf({ source: "SV_Position", factor: 0.01 })), {
      projection: "world",
      factor: 0.01,
      depth: 0
    })
    assert.deepStrictEqual(sourceOf(SHADERS, leaf({ source: "SV_Position", factor: 0.01, sceneDepth: 2 })), {
      projection: "object",
      factor: 0.01,
      depth: 2
    })
    assert.isUndefined(sourceOf(SHADERS, leaf({ kind: "param", source: "cb3[0].x" })))
    assert.isUndefined(sourceOf(SHADERS, leaf({ source: "TEXCOORD7" }))) // no such interpolant
  })

  it("prefers the deeper of two equal-factor paths through an interpolant", () => {
    const sh: MaterialShaders = {
      ...SHADERS,
      interpolants: {
        "TEXCOORD2.x": [attribute0("x"), { ...attribute0("x"), sceneDepth: 2 }, buffer("x")]
      }
    }
    assert.deepStrictEqual(sourceOf(sh, leaf({ source: "TEXCOORD2" })), { projection: "object", factor: 1, depth: 2 })
    const scaled: MaterialShaders = {
      ...sh,
      interpolants: { "TEXCOORD2.x": [attribute0("x"), { ...buffer("x"), factor: 3 }] }
    }
    assert.deepStrictEqual(sourceOf(scaled, leaf({ source: "TEXCOORD2" })), { projection: "uv", factor: 3, depth: 0 })
  })
})

describe("readsOf", () => {
  it("resolves each read's projection, scale, instance scale and role", () => {
    const { index, reads } = readsOf(SHADERS, MERGED, textureOf, textureInfo, false)
    assert.deepStrictEqual(index, [0, 1, 2]) // the engine texture is not a material read
    const [normal, grid, mottle] = reads
    assert.deepStrictEqual(
      [normal?.projection, normal?.scale, normal?.role, normal?.strength, normal?.instanceScale],
      ["uv", [24, 24], "normal", 1, 0]
    )
    assert.deepStrictEqual([grid?.projection, grid?.scale, grid?.role, grid?.instanceScale], [
      "object",
      [0.005, 0.005],
      "color",
      1
    ])
    assert.deepStrictEqual([mottle?.projection, mottle?.scale, mottle?.role], ["world", [0.01, 0.01], "variation"])
    assert.isTrue(reads.every((r) => r.unresolved.length === 0 && r.gain === null))
  })

  it("marks a read whose parameter the preshader could not name, and a cell-sized projected read", () => {
    const cells: MaterialShaders = {
      ...SHADERS,
      reads: [{
        texture: 1,
        op: "sample",
        channels: "xyz",
        resultFactor: null,
        coords: [
          { leaves: [leaf({ source: "SV_Position", factor: 0.5, sceneDepth: 2, params: ["cb3[5].w"] })] },
          { leaves: [leaf({ source: "SV_Position", component: "y", factor: 0.5, sceneDepth: 2 })] }
        ]
      }]
    }
    const [read] = readsOf(cells, MERGED, textureOf, textureInfo, false).reads
    assert.deepStrictEqual(read?.unresolved, ["cb3[5].w", "scale"])
    assert.strictEqual(read?.projection, "object")
  })

  it("calls a single-channel read of a translucent pass its opacity, and of a linear texture a mask", () => {
    const one: MaterialShaders = { ...SHADERS, reads: [SHADERS.reads[2]!], mottle: null }
    const grey = (texture: string) => (texture === MOTTLE ? { sRGB: false } : {})
    assert.strictEqual(readsOf(one, MERGED, textureOf, grey, true).reads[0]?.role, "variation")
    const other = (slot: number) => (slot === 2 ? GRID : null)
    assert.strictEqual(readsOf(one, MERGED, other, () => ({ sRGB: false }), true).reads[0]?.role, "opacity")
    assert.strictEqual(readsOf(one, MERGED, other, () => ({ sRGB: false }), false).reads[0]?.role, "mask")
    assert.strictEqual(readsOf(one, MERGED, other, () => ({}), false).reads[0]?.role, "color")
  })
})

describe("picksOf", () => {
  it("picks the PBR parameters by name, first pattern wins, tints and highlights excluded", () => {
    const picks = picksOf({
      scalars: { "Roughness Max": 0.9, "Roughness Min": 0.3, Metallic: 1, "Emissive Intensity": 2, Opacity: 0.4 },
      vectors: {
        "Fresnel Color": [0, 1, 0, 1],
        "Base Color": [1, 0, 0, 1],
        HighlightColor: [1, 1, 1, 1],
        "Emissive Color": [1, 0.5, 0, 1]
      },
      textures: {},
      switches: {}
    }, ["EmissiveColor"])
    assert.deepStrictEqual(picks.baseColor, { key: "Base Color", value: [1, 0, 0, 1] })
    assert.deepStrictEqual(picks.roughness, { key: "Roughness Min", value: 0.3 })
    assert.deepStrictEqual(picks.metallic, { key: "Metallic", value: 1 })
    assert.deepStrictEqual(picks.opacity, { key: "Opacity", value: 0.4 })
    assert.deepStrictEqual(picks.emissive.key, "Emissive Color")
    assert.deepStrictEqual(picks.emissiveIntensity.key, "Emissive Intensity")
    assert.deepStrictEqual(picks.pickedEmissive, [2, 1, 0])
    assert.isTrue(picks.emissiveOnly)
  })

  it("leaves what it cannot find null, and a black emissive is no emissive", () => {
    const picks = picksOf(MERGED, ["BaseColor", "EmissiveColor"])
    assert.deepStrictEqual(picks.baseColor, { key: "BaseColor", value: [1, 0, 0, 1] })
    assert.deepStrictEqual(picks.roughness, { key: null, value: null })
    assert.strictEqual(picks.emissive.key, "EmissiveColor")
    assert.isNull(picks.pickedEmissive)
    assert.isFalse(picks.emissiveOnly)
    assert.isFalse(picksOf(MERGED, null).emissiveOnly)
  })
})

describe("translucencyOf", () => {
  it("shows a beam on its sides: the larger alpha, and what is left of it facing up", () => {
    const t = translucencyOf("BLEND_Translucent", { ...SURFACE, opacity: 0.1, opacitySide: 0.5 }, null)
    assert.deepStrictEqual([t.translucent, t.additive, t.alphaShown, t.glowEvaluated], [true, false, 0.5, false])
    assert.closeTo(t.upFade ?? 0, 0.2, 1e-12)
    assert.isNull(t.emissiveColor)
  })

  it("renders an additive pass as its evaluated glow on the face that shows it", () => {
    const t = translucencyOf("BLEND_Additive", {
      ...SURFACE,
      opacity: 0,
      opacitySide: 0,
      emissive: [0.1, 0, 0],
      emissiveSide: [0.6, 0, 0.1]
    }, [9, 9, 9])
    assert.deepStrictEqual(t.emissiveColor, [0.6, 0, 0.1])
    assert.isTrue(t.glowEvaluated)
    assert.closeTo(t.upFade ?? 0, 0.1 / 0.6, 1e-12)
    assert.strictEqual(t.alphaShown, 0)
  })

  it("keeps the picked emissive without an evaluation, and an opaque pass has no alpha", () => {
    const t = translucencyOf("BLEND_Opaque", null, [1, 2, 3])
    assert.deepStrictEqual([t.translucent, t.additive, t.alphaShown, t.upFade, t.emissiveColor], [
      false,
      false,
      null,
      null,
      [1, 2, 3]
    ])
    assert.isNull(translucencyOf("BLEND_Opaque", SURFACE, null).upFade)
  })
})

describe("layersOf", () => {
  it("folds the evaluated gains in, names the primary read per role and the mottle with its gain", () => {
    const layers = layersOf(SHADERS, MERGED, textureOf, textureInfo, false)
    assert.strictEqual(layers.normalRead?.texture, NORMAL)
    assert.strictEqual(layers.variationRead?.texture, MOTTLE)
    assert.isUndefined(layers.opacityRead)
    assert.isUndefined(layers.ormRead)
    assert.deepStrictEqual(layers.colorLayers.map((r) => [r.texture, r.gain, r.mean]), [[GRID, [0.5, 0.1, 0], [
      0.4,
      0.4,
      0.4
    ]]])
    assert.strictEqual(layers.projection, "uv") // the normal map decides
    assert.strictEqual(layers.variation?.texture, MOTTLE)
    assert.deepStrictEqual(layers.variation?.tilings, [[0.01, 0.01]])
    assert.deepStrictEqual(layers.variation?.offsets, [0.5])
    assert.closeTo(layers.variation?.gain ?? 0, -0.1, 1e-12) // -(ColorContrast - 1)
  })

  it("has nothing without a shader, and no mottle when its parameter is unknown", () => {
    const none = layersOf(undefined, MERGED, textureOf, textureInfo, false)
    assert.deepStrictEqual([none.reads, none.colorLayers, none.projection, none.variation], [[], [], "uv", null])
    const unknown = layersOf(SHADERS, { ...MERGED, scalars: { "UV Tile": 2 } }, textureOf, textureInfo, false)
    assert.isNull(unknown.variation)
  })
})

describe("approxOf", () => {
  const build = (sh: MaterialShaders | undefined, merged = MERGED, blendMode = "BLEND_Opaque", override?: {
    baseColor: () => ReadonlyArray<number>
  }) => {
    const evaluated = sh?.surface ?? null
    const picks = picksOf(merged, null)
    const translucency = translucencyOf(blendMode, evaluated, picks.pickedEmissive)
    const layers = layersOf(sh, merged, textureOf, textureInfo, translucency.translucent)
    return approxOf({ merged, evaluated, picks, translucency, layers, override, texPath, textureOf })
  }

  it("takes the evaluated surface for an opaque pass, with its layers, mottle and outline band", () => {
    const a = build(SHADERS)
    assert.deepStrictEqual(a.baseColor, [0.2, 0.3, 1]) // clamped
    assert.deepStrictEqual([a.metallic, a.roughness, a.opacity, a.upFade, a.evaluated], [0, 0.4, 1, null, true])
    assert.isNull(a.emissive)
    assert.strictEqual(a.normalTexture, "textures/T_Normal.T_Normal.png")
    assert.deepStrictEqual(a.tiling.normal, [24, 24])
    assert.deepStrictEqual([a.projection, a.instanceScale], ["uv", 0])
    assert.deepStrictEqual(a.colorLayers, [{
      texture: "textures/T_Grid.T_Grid.png",
      tiling: [0.005, 0.005],
      projection: "object",
      instanceScale: 1,
      gain: [0.5, 0.1, 0],
      mean: [0.4, 0.4, 0.4]
    }])
    assert.strictEqual(a.variation?.texture, "textures/T_MacroVariation.T_MacroVariation.png")
    assert.deepStrictEqual(a.outline, { inset: [0.125, 0], color: [0.1, 0.1, 0.1] })
    assert.deepStrictEqual(a.programs, {})
    assert.deepStrictEqual(a.keys, {
      baseColor: null,
      metallic: null,
      roughness: null,
      opacity: null,
      emissive: "EmissiveColor",
      emissiveIntensity: null
    })
  })

  it("falls back to the name picks without a shader", () => {
    const a = build(undefined, { ...MERGED, scalars: { Roughness: 0.7, Metallic: 1 } })
    assert.deepStrictEqual(a.baseColor, [1, 0, 0])
    assert.deepStrictEqual([a.metallic, a.roughness, a.opacity, a.evaluated], [1, 0.7, 1, false])
    assert.deepStrictEqual([a.keys.baseColor, a.keys.metallic, a.keys.roughness], [
      "BaseColor",
      "Metallic",
      "Roughness"
    ])
    assert.isNull(a.normalTexture)
    assert.isNull(a.outline) // no Size X
    assert.deepStrictEqual(a.colorLayers, [])
  })

  it("shapes a translucent pass by its alpha reads and keeps its alpha program", () => {
    const sh: MaterialShaders = {
      ...SHADERS,
      // one single-channel read of a colour texture: a translucent pass's alpha shape
      reads: [{ ...SHADERS.reads[2]!, texture: 1 }],
      mottle: null,
      surface: {
        ...SURFACE,
        metallic: null,
        roughness: null,
        opacity: 0.1,
        opacitySide: 0.5,
        alphaRange: [0, 0.9],
        programs: { alpha: { code: "float ballestAlpha() {}", textures: [{ uniform: "uTex0", texture: 1 }] } },
        gains: { "0": { gain: [0, 0, 0], alpha: 0.3, mean: [0.2, 0.2, 0.2] } }
      }
    }
    const a = build(sh, { ...MERGED, scalars: { Opacity: 0.9, Roughness: 0.3 } }, "BLEND_Translucent")
    assert.strictEqual(a.opacity, 0.5)
    assert.closeTo(a.upFade ?? 0, 0.2, 1e-12)
    assert.deepStrictEqual([a.metallic, a.roughness], [0, 0.3]) // no GBuffer: the picks
    assert.strictEqual(a.opacityTexture, "textures/T_Grid.T_Grid.png")
    assert.deepStrictEqual(a.opacityLayers, [{
      texture: "textures/T_Grid.T_Grid.png",
      tiling: [0.01, 0.01],
      projection: "world",
      instanceScale: 0,
      channel: "r",
      gain: 0.9, // the whole swing, larger than the read's own gain
      mean: 0.2
    }])
    // a read of the green channel says so, and its mean is the green one
    const green = build(
      {
        ...sh,
        reads: [{ ...sh.reads[0]!, channels: "y" }],
        surface: { ...sh.surface!, gains: { "0": { gain: [0, 0, 0], alpha: 0.3, mean: [0.2, 0.7, 0.2] } } }
      },
      { ...MERGED, scalars: {} },
      "BLEND_Translucent"
    )
    assert.deepStrictEqual([green.opacityLayers[0]?.channel, green.opacityLayers[0]?.mean], ["g", 0.7])
    assert.deepStrictEqual(a.programs, {
      alpha: {
        code: "float ballestAlpha() {}",
        textures: [{ uniform: "uTex0", texture: "textures/T_Grid.T_Grid.png" }]
      }
    })
    assert.deepStrictEqual([a.keys.opacity, a.keys.roughness], [null, "Roughness"])
  })

  it("renders an additive pass as black plus its glow at full opacity", () => {
    const sh: MaterialShaders = {
      ...SHADERS,
      reads: [],
      mottle: null,
      surface: { ...SURFACE, metallic: null, roughness: null, opacity: 0, opacitySide: 0, emissive: [0.3, 0, 0] }
    }
    const a = build(sh, { ...MERGED, vectors: { GlowColor: [1, 1, 1, 1] } }, "BLEND_Additive")
    assert.deepStrictEqual([a.baseColor, a.opacity, a.emissive, a.upFade], [[0, 0, 0], 1, [0.3, 0, 0], 1])
    assert.isNull(a.keys.emissive) // the glow is evaluated, not the pick
  })

  it("runs a base program only where a read is unplaced, and never for an overridden material", () => {
    const unplaced: MaterialShaders = {
      ...SHADERS,
      reads: [...SHADERS.reads, {
        texture: 1,
        op: "sample",
        channels: "xyz",
        resultFactor: null,
        coords: [{ leaves: [leaf({ params: ["cb3[5].w"] })] }, { leaves: [leaf({ component: "y" })] }]
      }],
      surface: {
        ...SURFACE,
        programs: { base: { code: "vec3 ballestBase() {}", textures: [{ uniform: "uTex0", texture: 1 }] } }
      }
    }
    const a = build(unplaced)
    assert.deepStrictEqual(a.programs["base"]?.textures, [{ uniform: "uTex0", texture: "textures/T_Grid.T_Grid.png" }])
    assert.deepStrictEqual(a.colorLayers, []) // the program draws them
    assert.isNull(a.variation)
    // placed reads only: the layers suffice
    assert.deepStrictEqual(build({ ...unplaced, reads: SHADERS.reads }).programs, {})
    const overridden = build(unplaced, MERGED, "BLEND_Opaque", { baseColor: () => [0.9, 0.8, 0.7] })
    assert.deepStrictEqual(overridden.baseColor, [0.9, 0.8, 0.7])
    assert.deepStrictEqual(overridden.programs, {})
  })
})
