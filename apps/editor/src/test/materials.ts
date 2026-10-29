/** A small extractor-style materials.json for the material tests. */
export const BLUE = "/Game/Art/Materials/Environment/Materials/Instances_2/MI_Env_Blue_Smooth.MI_Env_Blue_Smooth"
export const GLASS = "/Game/Art/Materials/M_GlassV2.M_GlassV2"
export const OLD = "/Game/Art/Materials/Masters/M_BaseSurface_Metal.M_BaseSurface_Metal"
/** UV-tiled normals with the grey mottle and an outline band, like M_OutlineEdges. */
export const OUTLINE = "/Game/Art/Materials/Masters/M_OutlineEdges.M_OutlineEdges"
/** A shaped translucent effect, like the air vent's wind column. */
export const WIND = "/Game/Art/UsedMarketPlace/StylizedFX_Collection_q/M_AJ_LandRay.M_AJ_LandRay"
/** A base colour with a grid texture added on top, like MI_Pipes. */
export const PIPE = "/Game/Art/Materials/Instances/MI_Pipes.MI_Pipes"
/** Object-aligned tiles that scale with the piece, like MI_Env_Blue_Tiles. */
export const TILES = "/Game/Art/Materials/Environment/Materials/Instances_2/MI_Env_Blue_Tiles.MI_Env_Blue_Tiles"
export const materialsFile = {
  version: 1,
  materials: [
    {
      path: BLUE,
      blendMode: "BLEND_Opaque",
      approx: {
        baseColor: [0.02, 0.1, 0.8],
        metallic: 0,
        roughness: 0.3,
        normalTexture: "textures/n.png",
        ormTexture: "textures/n.png"
      },
      recovered: true
    },
    {
      path: GLASS,
      blendMode: "BLEND_TranslucentGreyTransmittance",
      twoSided: true,
      approx: { baseColor: [0.8, 0.9, 1], opacity: 0.7, normalTexture: "textures/glass_n.png" },
      recovered: true
    },
    {
      path: OUTLINE,
      blendMode: "BLEND_Opaque",
      approx: {
        baseColor: [0.16, 0.67, 1],
        normalTexture: "textures/tiles_n.png",
        variationTexture: "textures/macro.png",
        tiling: { baseColor: 1, normal: 12, variation: [0.2134, 0.2134], opacity: 1 },
        projection: "uv",
        variation: {
          texture: "textures/macro.png",
          tilings: [[0.2134, 0.2134], [0.05341, 0.05341], [0.002, 0.002]],
          offsets: [0.1, 0.2, 0.5],
          gain: -0.1
        },
        reads: [
          { texture: "textures/tiles_n.png", role: "normal", scale: [12, 12], projection: "uv", strength: 1 },
          { texture: "textures/tiles_n.png", role: "normal", scale: [4, 4], projection: "uv", strength: 0.2 },
          { texture: "textures/macro.png", role: "variation", scale: [0.2134, 0.2134], projection: "uv" },
          { texture: "textures/macro.png", role: "variation", scale: [0.05341, 0.05341], projection: "uv" },
          { texture: "textures/macro.png", role: "variation", scale: [0.002, 0.002], projection: "uv" }
        ],
        outline: { inset: [0, 0.1], color: [0.59, 0.59, 0.59] }
      },
      recovered: true
    },
    {
      path: WIND,
      blendMode: "BLEND_TranslucentGreyTransmittance",
      twoSided: true,
      approx: { opacity: 0.5, opacityTexture: "textures/ray.png", tiling: { opacity: 0.25 } },
      recovered: false
    },
    {
      path: TILES,
      blendMode: "BLEND_Opaque",
      approx: {
        baseColor: [0.02, 0.1, 0.8],
        normalTexture: "textures/tiles_n.png",
        variationTexture: "textures/macro.png",
        tiling: { normal: [0.005, 0.005], variation: [0.00105, 0.00105] },
        projection: "object",
        instanceScale: 1,
        variation: { texture: "textures/macro.png", tilings: [[0.00105, 0.00105]], offsets: [0.5], gain: -0.1 },
        reads: [
          {
            texture: "textures/tiles_n.png",
            role: "normal",
            scale: [0.06, 0.06],
            projection: "object",
            instanceScale: 1,
            strength: 1
          },
          {
            texture: "textures/tiles_n.png",
            role: "normal",
            scale: [0.005, 0.005],
            projection: "object",
            instanceScale: 1,
            strength: 1
          },
          { texture: "textures/macro.png", role: "variation", scale: [0.00105, 0.00105], projection: "object" }
        ]
      },
      recovered: true
    },
    {
      path: PIPE,
      blendMode: "BLEND_Opaque",
      approx: {
        baseColor: [0.17, 0.876, 1],
        metallic: 0,
        roughness: 0.8,
        evaluated: true,
        colorLayers: [{
          texture: "textures/grid.png",
          tiling: [5, 5],
          projection: "uv",
          gain: [0.83, 0.124, 0],
          mean: [0.1, 0.1, 0.1]
        }]
      },
      recovered: true
    },
    { path: "/Game/New/M_Metal.M_Metal", redirectedTo: OLD, approx: { baseColor: [0.5, 0.5, 0.5] } },
    { path: "/Game/Broken.Broken", approx: { baseColor: "red" } }
  ],
  textures: [{ png: "textures/n.png", sRGB: false }]
}
