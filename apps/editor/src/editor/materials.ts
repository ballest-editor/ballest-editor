/**
 * three.js materials for game materials, cached per material object path, plus a texture
 * cache. Base-colour textures are sRGB; normal and ORM textures stay linear. Anything
 * unknown renders with one shared neutral grey material.
 *
 * MeshStandardMaterial covers the PBR part. What it can't express on its own, the
 * extractor's `approx` describes (read off the game's compiled shaders) and a small shader
 * patch (`patchShader`) adds:
 *
 * - per-texture UV tiling, [u, v];
 * - object-aligned projection for the Env masters and the plastics: the texture coordinate is
 *   the position in the piece's own frame, scaled like the piece, read through the face's
 *   dominant axis, and (as the game's instances do) multiplied again by the piece's x/y scale;
 *   world-aligned projection for the few masters that use the world position;
 * - a second normal layer (the Env masters' fine x12 tiles, the metal's coarse ones);
 * - the grey mottle (T_MacroVariation) at the game's three octaves, multiplied into the base colour;
 * - M_OutlineEdges' grey band along the UV border of a face.
 */
import * as THREE from "three"
import { lookupMaterial, type MaterialSpec, type MaterialTable, NEUTRAL, type Pair } from "../domain/Materials"
import { textureUrl } from "./assetUrl"
import { isMesh } from "./threeGuards"

/**
 * How much of the grey mottle shows (0 = none, 1 = the game's product of three octaves in whole).
 * The game lerps its colour contrast with it; tuned against in-game cubes.
 */
const VARIATION_STRENGTH = 0.35
/** Normal-map strength: the game's concrete grooves read crisper than a unit normal map gives. */
const NORMAL_STRENGTH = 1.6

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
    readonly uBaseColorTiling: THREE.IUniform<THREE.Vector2>
    readonly uNormalTiling: THREE.IUniform<THREE.Vector2>
    readonly uOpacityTiling: THREE.IUniform<THREE.Vector2>
    readonly uVariationTiling: THREE.IUniform<THREE.Vector2>
    readonly uVariationTiling2: THREE.IUniform<THREE.Vector2>
    readonly uVariationTiling3: THREE.IUniform<THREE.Vector2>
    readonly uVariationMap: THREE.IUniform<THREE.Texture | null>
    readonly uNormalMap2: THREE.IUniform<THREE.Texture | null>
    readonly uNormal2Tiling: THREE.IUniform<THREE.Vector2>
    readonly uNormal2Strength: THREE.IUniform<number>
    readonly uOutlineInset: THREE.IUniform<THREE.Vector2>
    readonly uOutlineColor: THREE.IUniform<THREE.Color>
  }
}

const vec2 = (p: Pair) => new THREE.Vector2(p[0], p[1])
const isOne = (p: Pair) => p[0] === 1 && p[1] === 1

const patchOf = (
  spec: Omit<MaterialSpec, "path">,
  variation: THREE.Texture | null,
  normal2: THREE.Texture | null
): Patch | undefined => {
  const defines: Record<string, 1> = {}
  const { tiling } = spec
  const projected = spec.projection !== "uv"
  if (projected || !isOne(tiling.baseColor) || !isOne(tiling.normal) || !isOne(tiling.opacity)) {
    defines["BALLEST_TILING"] = 1
  }
  if (spec.projection === "object") defines["BALLEST_OBJECT"] = 1
  if (spec.projection === "world") defines["BALLEST_WORLD"] = 1
  if (projected && spec.instanceScale) defines["BALLEST_INSTANCE_SCALE"] = 1
  if (variation !== null) defines["BALLEST_VARIATION"] = 1
  if (normal2 !== null) defines["BALLEST_NORMAL2"] = 1
  if (spec.outline !== undefined) defines["BALLEST_OUTLINE"] = 1
  if (Object.keys(defines).length === 0) return undefined
  const outline = spec.outline
  const [v2, v3] = spec.variationTilings
  return {
    defines,
    uniforms: {
      uBaseColorTiling: { value: vec2(tiling.baseColor) },
      uNormalTiling: { value: vec2(tiling.normal) },
      uOpacityTiling: { value: vec2(tiling.opacity) },
      uVariationTiling: { value: vec2(tiling.variation) },
      // The game's second and third octaves are 1/4 and 1/100 of the first; used when the shader didn't say.
      uVariationTiling2: { value: vec2(v2 ?? [tiling.variation[0] / 4, tiling.variation[1] / 4]) },
      uVariationTiling3: { value: vec2(v3 ?? [tiling.variation[0] / 100, tiling.variation[1] / 100]) },
      uVariationMap: { value: variation },
      uNormalMap2: { value: normal2 },
      uNormal2Tiling: { value: vec2(spec.normalLayer?.tiling ?? [1, 1]) },
      uNormal2Strength: { value: spec.normalLayer?.strength ?? 0 },
      uOutlineInset: { value: new THREE.Vector2(outline?.inset[0] ?? 0, outline?.inset[1] ?? 0) },
      uOutlineColor: {
        value: new THREE.Color().setRGB(...(outline?.color ?? [0.5, 0.5, 0.5]), THREE.LinearSRGBColorSpace)
      }
    }
  }
}

// The glb vertices are raw UE values (cm, UE axes); the scene converts them with a parent matrix, so
// `transformed` is the position in the piece's own frame and `objectNormal` its normal there. three's
// world frame is UE's with y and z swapped.
const VERTEX_DECLS = /* glsl */ `
varying vec3 vBallestPos;
varying vec3 vBallestNormal;
varying vec3 vBallestScale;
varying vec2 vBallestUv;
varying mat3 vBallestNormalMatrix;
`
const VERTEX_BODY = /* glsl */ `
vBallestScale = vec3( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ), length( modelMatrix[ 2 ].xyz ) );
#ifdef BALLEST_WORLD
  vBallestPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xzy;
  vBallestNormal = normalize( mat3( modelMatrix ) * objectNormal ).xzy;
#else
  vBallestPos = transformed * vBallestScale;
  vBallestNormal = objectNormal;
#endif
vBallestUv = uv;
vBallestNormalMatrix = normalMatrix;
`
const FRAGMENT_DECLS = /* glsl */ `
varying vec3 vBallestPos;
varying vec3 vBallestNormal;
varying vec3 vBallestScale;
varying vec2 vBallestUv;
varying mat3 vBallestNormalMatrix;
uniform vec2 uBaseColorTiling;
uniform vec2 uNormalTiling;
uniform vec2 uOpacityTiling;
uniform vec2 uVariationTiling;
uniform vec2 uVariationTiling2;
uniform vec2 uVariationTiling3;
uniform sampler2D uVariationMap;
uniform sampler2D uNormalMap2;
uniform vec2 uNormal2Tiling;
uniform float uNormal2Strength;
uniform vec2 uOutlineInset;
uniform vec3 uOutlineColor;
// The face's dominant axis in the projection frame: 0 = x, 1 = y, 2 = z.
int ballestAxis() {
  vec3 n = abs( vBallestNormal );
  return n.z >= n.x && n.z >= n.y ? 2 : ( n.x >= n.y ? 0 : 1 );
}
// The projected position through that axis: (x, y) on z faces, (y, z) on x faces, (x, z) on y faces.
vec2 ballestProjected() {
  int a = ballestAxis();
  vec2 c = a == 2 ? vBallestPos.xy : ( a == 0 ? vBallestPos.yz : vBallestPos.xz );
  #ifdef BALLEST_INSTANCE_SCALE
    c *= vBallestScale.xy;
  #endif
  return c;
}
vec2 ballestUv( vec2 tiling ) {
  #if defined( BALLEST_OBJECT ) || defined( BALLEST_WORLD )
    return ballestProjected() * tiling;
  #else
    return vBallestUv * tiling;
  #endif
}
`
// After three's own map sampling: the mottle multiplies in, then the outline band paints over.
// The mottle is the game's product of three octaves, normalised to its mean so it only modulates,
// then blended towards white: the game mixes it into its colour contrast, not straight into the colour.
const COLOR_EXTRAS = /* glsl */ `
#ifdef BALLEST_VARIATION
  float ballestMottle = ( texture2D( uVariationMap, ballestUv( uVariationTiling ) ).r + 0.5 )
    * ( texture2D( uVariationMap, ballestUv( uVariationTiling2 ) ).r + 0.4 )
    * ( texture2D( uVariationMap, ballestUv( uVariationTiling3 ) ).r + 0.3 ) / 0.72;
  diffuseColor.rgb *= mix( 1.0, ballestMottle, ${VARIATION_STRENGTH.toFixed(2)} );
#endif
#ifdef BALLEST_OUTLINE
  vec2 ballestEdge = min( vBallestUv, 1.0 - vBallestUv );
  float ballestBand = max( step( ballestEdge.x, uOutlineInset.x ), step( ballestEdge.y, uOutlineInset.y ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uOutlineColor, ballestBand );
#endif
`
// The tangent-space perturbation from the normal map(s): the second layer adds at its strength.
const NORMAL_LAYERS = /* glsl */ `
vec3 ballestMapN() {
  vec3 mapN = texture2D( normalMap, ballestUv( uNormalTiling ) ).xyz * 2.0 - 1.0;
  #ifdef BALLEST_NORMAL2
    mapN.xy += ( texture2D( uNormalMap2, ballestUv( uNormal2Tiling ) ).xy * 2.0 - 1.0 ) * uNormal2Strength;
  #endif
  mapN.xy *= normalScale;
  return mapN;
}
`
// Replaces three's normal_fragment_maps when projecting: the perturbation is applied in the projection
// frame along the two axes the face is read through, then taken to view space.
const PROJECTED_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP
  {
    vec3 n = normalize( vBallestNormal );
    #ifdef DOUBLE_SIDED
      n *= faceDirection;
    #endif
    vec3 mapN = ballestMapN();
    int a = ballestAxis();
    vec3 du = a == 2 ? vec3( 1.0, 0.0, 0.0 ) : ( a == 0 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) );
    vec3 dv = a == 0 ? vec3( 0.0, 0.0, 1.0 ) : ( a == 1 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 ) );
    vec3 pn = normalize( n + du * mapN.x + dv * mapN.y );
    #ifdef BALLEST_WORLD
      normal = normalize( ( viewMatrix * vec4( pn.xzy, 0.0 ) ).xyz );
    #else
      normal = normalize( vBallestNormalMatrix * pn );
    #endif
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
const tiled = (chunk: keyof typeof THREE.ShaderChunk, read: string, replacement: string): string => {
  const source = THREE.ShaderChunk[chunk]
  if (!source.includes(read)) throw new Error(`three's ${chunk} no longer reads "${read}"`)
  // Every occurrence: normal_fragment_maps reads the map once per branch (object space, tangent space).
  return source.replaceAll(read, replacement)
}

/** Rewrites a MeshStandardMaterial program for `patch` (the body of `onBeforeCompile`). */
export const applyShaderPatch = (shader: ShaderProgram, patch: Patch): void => {
  Object.assign(shader.uniforms, patch.uniforms)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_DECLS}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`)
  const projected = "BALLEST_OBJECT" in patch.defines || "BALLEST_WORLD" in patch.defines
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLS}`)
    .replace("#include <normalmap_pars_fragment>", `#include <normalmap_pars_fragment>\n${NORMAL_LAYERS}`)
    .replace(
      "#include <map_fragment>",
      `${
        tiled("map_fragment", "texture2D( map, vMapUv )", "texture2D( map, ballestUv( uBaseColorTiling ) )")
      }\n${COLOR_EXTRAS}`
    )
    .replace(
      "#include <alphamap_fragment>",
      tiled(
        "alphamap_fragment",
        "texture2D( alphaMap, vAlphaMapUv )",
        "texture2D( alphaMap, ballestUv( uOpacityTiling ) )"
      )
    )
    .replace(
      "#include <normal_fragment_maps>",
      projected
        ? PROJECTED_NORMAL
        : tiled("normal_fragment_maps", "texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0", "ballestMapN()")
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
    material.normalScale.set(NORMAL_STRENGTH, -NORMAL_STRENGTH) // UE normal maps use DirectX green (-Y)
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
  const dropDefine = (define: string) => () => {
    material.defines = { ...material.defines }
    delete material.defines[define]
    material.needsUpdate = true
  }
  const variation = spec.variationTexture === undefined
    ? null
    : loadTexture(
      spec.variationTexture,
      colorSpaceOf(spec.variationTexture, THREE.SRGBColorSpace),
      dropDefine("BALLEST_VARIATION")
    )
  const normal2 = spec.normalLayer === undefined || spec.normalTexture === undefined
    ? null
    : loadTexture(spec.normalLayer.texture, THREE.NoColorSpace, dropDefine("BALLEST_NORMAL2"))
  const patch = patchOf(spec, variation, normal2)
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
