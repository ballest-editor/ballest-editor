/** A small extractor-style materials.json for the material tests. */
export const BLUE = "/Game/Art/Materials/Environment/Materials/Instances_2/MI_Env_Blue_Smooth.MI_Env_Blue_Smooth"
export const GLASS = "/Game/Art/Materials/M_GlassV2.M_GlassV2"
export const OLD = "/Game/Art/Materials/Masters/M_BaseSurface_Metal.M_BaseSurface_Metal"
/** Triplanar tiles with the grey mottle and an outline band, like M_OutlineEdges. */
export const OUTLINE = "/Game/Art/Materials/Masters/M_OutlineEdges.M_OutlineEdges"
/** A shaped translucent effect, like the air vent's wind column. */
export const WIND = "/Game/Art/UsedMarketPlace/StylizedFX_Collection_q/M_AJ_LandRay.M_AJ_LandRay"
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
        tiling: { baseColor: 1, normal: 12, variation: 1, opacity: 1 },
        projection: "triplanar",
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
    { path: "/Game/New/M_Metal.M_Metal", redirectedTo: OLD, approx: { baseColor: [0.5, 0.5, 0.5] } },
    { path: "/Game/Broken.Broken", approx: { baseColor: "red" } }
  ],
  textures: [{ png: "textures/n.png", sRGB: false }]
}
