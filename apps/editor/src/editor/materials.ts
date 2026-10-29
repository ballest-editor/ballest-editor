/**
 * three.js materials for game materials, cached per material object path, plus a texture
 * cache. Base-colour textures are sRGB; normal and ORM textures stay linear. Anything
 * unknown renders with one shared neutral grey material.
 *
 * MeshStandardMaterial covers the PBR part. What it can't express on its own, the
 * extractor's `approx` describes and a small shader patch (`patchShader`) adds:
 *
 * - per-texture UV tiling (the cooked material's TextureStreamingData scales);
 * - world-space triplanar projection for the Env masters, whose textures never follow
 *   mesh UVs in the game;
 * - the grey mottle (T_MacroVariation) multiplied into the base colour;
 * - M_OutlineEdges' grey band along the UV border of a face.
 */
import * as THREE from "three"
import { lookupMaterial, type MaterialSpec, type MaterialTable, NEUTRAL } from "../domain/Materials"
import { textureUrl } from "./assetUrl"
import { isMesh } from "./threeGuards"

/**
 * World-space period (cm) of a triplanar texture at tiling 1. The game's value isn't in the
 * cooked data; 1024 cm is UE's WorldAlignedTexture default and gives the 4-per-repeat
 * concrete tiles (tiling 4) a 64 cm pitch, which matches the in-game palette renders.
 */
export const TRIPLANAR_PERIOD_CM = 1024
/** How much of the grey mottle shows (0 = none, 1 = multiplied in whole); tuned against the palette renders. */
const VARIATION_STRENGTH = 0.45

const textureLoader = new THREE.TextureLoader()
const textures = new Map<string, THREE.Texture>()
const materials = new Map<string, THREE.MeshStandardMaterial>()

const loadTexture = (path: string, colorSpace: THREE.ColorSpace, onError: () => void): THREE.Texture => {
  const key = `${colorSpace}|${path}`
  const cached = textures.get(key)
  if (cached !== undefined) return cached
  // Without a DOM (unit tests) there's no image loader; keep an empty texture.
  const texture = typeof document === "undefined"
    ? new THREE.Texture()
    : textureLoader.load(textureUrl(path), undefined, undefined, () => {
      textures.delete(key)
      onError()
    })
  texture.colorSpace = colorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  textures.set(key, texture)
  return texture
}

/** The shader patch's inputs; `defines` doubles as the program cache key. */
export interface Patch {
  readonly defines: Readonly<Record<string, 1>>
  readonly uniforms: {
    readonly uBaseColorTiling: THREE.IUniform<number>
    readonly uNormalTiling: THREE.IUniform<number>
    readonly uOpacityTiling: THREE.IUniform<number>
    readonly uVariationTiling: THREE.IUniform<number>
    readonly uVariationMap: THREE.IUniform<THREE.Texture | null>
    readonly uOutlineInset: THREE.IUniform<THREE.Vector2>
    readonly uOutlineColor: THREE.IUniform<THREE.Color>
  }
}

const patchOf = (spec: Omit<MaterialSpec, "path">, variation: THREE.Texture | null): Patch | undefined => {
  const defines: Record<string, 1> = {}
  const { tiling } = spec
  if (tiling.baseColor !== 1 || tiling.normal !== 1 || tiling.opacity !== 1) defines["BALLEST_TILING"] = 1
  if (spec.triplanar && (spec.normalTexture !== undefined || variation !== null)) defines["BALLEST_TRIPLANAR"] = 1
  if (variation !== null) defines["BALLEST_VARIATION"] = 1
  if (spec.outline !== undefined) defines["BALLEST_OUTLINE"] = 1
  if (Object.keys(defines).length === 0) return undefined
  const outline = spec.outline
  return {
    defines,
    uniforms: {
      uBaseColorTiling: { value: tiling.baseColor },
      uNormalTiling: { value: tiling.normal },
      uOpacityTiling: { value: tiling.opacity },
      uVariationTiling: { value: tiling.variation },
      uVariationMap: { value: variation },
      uOutlineInset: { value: new THREE.Vector2(outline?.inset[0] ?? 0, outline?.inset[1] ?? 0) },
      uOutlineColor: {
        value: new THREE.Color().setRGB(...(outline?.color ?? [0.5, 0.5, 0.5]), THREE.LinearSRGBColorSpace)
      }
    }
  }
}

const VERTEX_DECLS = /* glsl */ `
varying vec3 vBallestWorldPos;
varying vec3 vBallestWorldNormal;
varying vec2 vBallestUv;
`
const VERTEX_BODY = /* glsl */ `
vBallestWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vBallestWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
vBallestUv = uv;
`
const FRAGMENT_DECLS = /* glsl */ `
varying vec3 vBallestWorldPos;
varying vec3 vBallestWorldNormal;
varying vec2 vBallestUv;
uniform float uBaseColorTiling;
uniform float uNormalTiling;
uniform float uOpacityTiling;
uniform float uVariationTiling;
uniform sampler2D uVariationMap;
uniform vec2 uOutlineInset;
uniform vec3 uOutlineColor;
// Blend weights of the three world-axis projections (sharpened so flat faces read one map).
vec3 ballestTriplanarWeights( vec3 worldNormal ) {
  vec3 w = pow( abs( worldNormal ), vec3( 4.0 ) );
  return w / ( w.x + w.y + w.z );
}
vec4 ballestSample( sampler2D map, float tiling ) {
  #ifdef BALLEST_TRIPLANAR
    vec3 p = vBallestWorldPos / ${TRIPLANAR_PERIOD_CM.toFixed(1)} * tiling;
    vec3 w = ballestTriplanarWeights( vBallestWorldNormal );
    return texture2D( map, p.yz ) * w.x + texture2D( map, p.xz ) * w.y + texture2D( map, p.xy ) * w.z;
  #else
    return texture2D( map, vBallestUv * tiling );
  #endif
}
`
// After three's own map sampling: the mottle multiplies in, then the outline band paints over.
// The mottle is blended towards white first: multiplied in whole it darkens the Env colours
// well below the in-game renders, so the masters must mix it in at reduced strength.
const COLOR_EXTRAS = /* glsl */ `
#ifdef BALLEST_VARIATION
  diffuseColor.rgb *= mix( vec3( 1.0 ), ballestSample( uVariationMap, uVariationTiling ).rgb, ${
  VARIATION_STRENGTH.toFixed(2)
} );
#endif
#ifdef BALLEST_OUTLINE
  vec2 ballestEdge = min( vBallestUv, 1.0 - vBallestUv );
  float ballestBand = max( step( ballestEdge.x, uOutlineInset.x ), step( ballestEdge.y, uOutlineInset.y ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uOutlineColor, ballestBand );
#endif
`
// Replaces three's normal_fragment_maps when projecting: three tangent-space samples, one per world
// axis, blended as perturbations of the world normal (the "UDN" blend), then taken to view space.
const TRIPLANAR_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP
  {
    vec3 wn = normalize( vBallestWorldNormal );
    #ifdef DOUBLE_SIDED
      wn *= faceDirection;
    #endif
    vec3 p = vBallestWorldPos / ${TRIPLANAR_PERIOD_CM.toFixed(1)} * uNormalTiling;
    vec3 w = ballestTriplanarWeights( wn );
    vec3 tx = texture2D( normalMap, p.yz ).xyz * 2.0 - 1.0;
    vec3 ty = texture2D( normalMap, p.xz ).xyz * 2.0 - 1.0;
    vec3 tz = texture2D( normalMap, p.xy ).xyz * 2.0 - 1.0;
    tx.xy *= normalScale; ty.xy *= normalScale; tz.xy *= normalScale;
    vec3 worldN = normalize( wn + vec3( 0.0, tx.y, tx.x ) * w.x + vec3( ty.x, 0.0, ty.y ) * w.y + vec3( tz.x, tz.y, 0.0 ) * w.z );
    normal = normalize( ( viewMatrix * vec4( worldN, 0.0 ) ).xyz );
  }
#endif
`

/** What three hands to `onBeforeCompile`, minus the parts the patch doesn't touch. */
export interface ShaderProgram {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}

/**
 * A three.js chunk with one texture read scaled by a tiling uniform. The program handed to
 * `onBeforeCompile` still has its `#include`s unexpanded, so the chunk text has to be brought
 * in here for the substitution to find anything.
 */
const tiled = (chunk: keyof typeof THREE.ShaderChunk, read: string, uniform: string): string => {
  const source = THREE.ShaderChunk[chunk]
  if (!source.includes(read)) throw new Error(`three's ${chunk} no longer reads "${read}"`)
  // Every occurrence: normal_fragment_maps reads the map once per branch (object space, tangent space).
  return source.replaceAll(read, `${read.slice(0, -2)} * ${uniform} )`)
}

/** Rewrites a MeshStandardMaterial program for `patch` (the body of `onBeforeCompile`). */
export const applyShaderPatch = (shader: ShaderProgram, patch: Patch): void => {
  Object.assign(shader.uniforms, patch.uniforms)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_DECLS}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`)
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLS}`)
    .replace(
      "#include <map_fragment>",
      `${tiled("map_fragment", "texture2D( map, vMapUv )", "uBaseColorTiling")}\n${COLOR_EXTRAS}`
    )
    .replace(
      "#include <alphamap_fragment>",
      tiled("alphamap_fragment", "texture2D( alphaMap, vAlphaMapUv )", "uOpacityTiling")
    )
    .replace(
      "#include <normal_fragment_maps>",
      "BALLEST_TRIPLANAR" in patch.defines
        ? TRIPLANAR_NORMAL
        : tiled("normal_fragment_maps", "texture2D( normalMap, vNormalMapUv )", "uNormalTiling")
    )
}

const patches = new WeakMap<THREE.Material, Patch>()

/** The shader patch installed on a material by `materialFor`, if it needed one. */
export const shaderPatchOf = (material: THREE.Material): Patch | undefined => patches.get(material)

/** Installs the patch on `material`; see the module comment for what it adds. */
const patchShader = (material: THREE.MeshStandardMaterial, patch: Patch): void => {
  material.defines = { ...material.defines, ...patch.defines }
  const key = Object.keys(patch.defines).sort().join(",")
  material.customProgramCacheKey = () => key
  material.onBeforeCompile = (shader) => applyShaderPatch(shader, patch)
  patches.set(material, patch)
}

const build = (
  spec: Omit<MaterialSpec, "path"> & { readonly path?: string },
  table: MaterialTable | null
): THREE.MeshStandardMaterial => {
  // Per-texture sRGB flags from materials.json; base colour defaults to sRGB, data maps to linear.
  const colorSpaceOf = (png: string, fallback: THREE.ColorSpace) => {
    const srgb = table?.textureSrgb.get(png)
    return srgb === undefined ? fallback : srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  }
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...spec.baseColor, THREE.LinearSRGBColorSpace),
    metalness: spec.metallic,
    roughness: spec.roughness,
    emissive: new THREE.Color().setRGB(...spec.emissive, THREE.LinearSRGBColorSpace),
    // Two-sided only where the game material says so (glass panes and other open meshes).
    side: spec.twoSided ? THREE.DoubleSide : THREE.FrontSide
  })
  material.name = spec.path ?? "neutral"
  if (spec.translucent) {
    material.transparent = true
    material.opacity = spec.opacity
    material.depthWrite = false
  }
  const drop =
    (slot: "map" | "normalMap" | "roughnessMap" | "metalnessMap" | "aoMap" | "emissiveMap" | "alphaMap") => () => {
      material[slot] = null
      material.needsUpdate = true
    }
  if (spec.baseColorTexture !== undefined) {
    material.map = loadTexture(
      spec.baseColorTexture,
      colorSpaceOf(spec.baseColorTexture, THREE.SRGBColorSpace),
      drop("map")
    )
  }
  if (spec.normalTexture !== undefined) {
    material.normalMap = loadTexture(spec.normalTexture, THREE.NoColorSpace, drop("normalMap"))
    material.normalScale.set(1, -1) // UE normal maps use DirectX green (-Y)
  }
  if (spec.ormTexture !== undefined) {
    const orm = loadTexture(spec.ormTexture, THREE.NoColorSpace, () => {
      drop("roughnessMap")()
      drop("metalnessMap")()
    })
    material.roughnessMap = orm // G channel
    material.metalnessMap = orm // B channel
  }
  if (spec.emissiveTexture !== undefined) {
    material.emissiveMap = loadTexture(
      spec.emissiveTexture,
      colorSpaceOf(spec.emissiveTexture, THREE.SRGBColorSpace),
      drop("emissiveMap")
    )
    if (spec.emissive.every((c) => c === 0)) material.emissive.setRGB(1, 1, 1)
  }
  // A shaped translucent effect (the air vent's wind, light beams): its streak texture is the alpha,
  // and it adds light rather than shading what's behind it.
  if (spec.translucent && spec.opacityTexture !== undefined) {
    material.alphaMap = loadTexture(spec.opacityTexture, THREE.NoColorSpace, drop("alphaMap"))
    material.blending = THREE.AdditiveBlending
  }
  const variation = spec.variationTexture === undefined
    ? null
    : loadTexture(spec.variationTexture, colorSpaceOf(spec.variationTexture, THREE.SRGBColorSpace), () => {
      material.defines = { ...material.defines }
      delete material.defines["BALLEST_VARIATION"]
      material.needsUpdate = true
    })
  const patch = patchOf(spec, variation)
  if (patch !== undefined) patchShader(material, patch)
  return material
}

let neutral: THREE.MeshStandardMaterial | undefined
export const neutralMaterial = (): THREE.MeshStandardMaterial => (neutral ??= build(NEUTRAL, null))

/** The cached material for a game material path (class-qualified or bare), or neutral grey. */
export const materialFor = (table: MaterialTable | null, path: string | undefined): THREE.MeshStandardMaterial => {
  const spec = lookupMaterial(table, path)
  if (spec === undefined) return neutralMaterial()
  const cached = materials.get(spec.path)
  if (cached !== undefined) return cached
  const material = build(spec, table)
  materials.set(spec.path, material)
  return material
}

/** UE slot index of a glb primitive: `extras.ueMaterialIndex`, else the "<i>:<slot>" material name. */
export const slotIndexOf = (mesh: THREE.Mesh): number => {
  const fromExtras: unknown = mesh.geometry.userData["ueMaterialIndex"]
  if (typeof fromExtras === "number") return fromExtras
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const fromMaterialExtras: unknown = material?.userData["ueMaterialIndex"]
  if (typeof fromMaterialExtras === "number") return fromMaterialExtras
  const match = /^(\d+):/.exec(material?.name ?? "")
  return match ? Number(match[1]) : 0
}

/** Assigns game materials to every primitive under `root` by UE slot index. */
export const applySlotMaterials = (
  root: THREE.Object3D,
  table: MaterialTable | null,
  slotMaterials: ReadonlyArray<string | undefined>
): void =>
  root.traverse((object) => {
    if (isMesh(object)) object.material = materialFor(table, slotMaterials[slotIndexOf(object)])
  })
