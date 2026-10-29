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
 * - colour layers: textures the base colour depends on, each added around its mean at the gain the
 *   shader gives it (the pipes' grid lines, the air vent's slats);
 * - the grey mottle (T_MacroVariation) exactly as the game's shader forms it: a product of offset reads at
 *   three scales, times a gain, added to 1 and multiplied into the base colour;
 * - M_OutlineEdges' grey band along the UV border of a face.
 */
import * as THREE from "three"
import { lookupMaterial, type MaterialSpec, type MaterialTable, NEUTRAL, type Pair } from "../domain/Materials"
import { textureUrl } from "./assetUrl"
import { isMesh } from "./threeGuards"

/** Normal-map strength: the game's concrete grooves read crisper than a unit normal map gives. */
const NORMAL_STRENGTH = 1.6

const textureLoader = new THREE.TextureLoader()
const textures = new Map<string, THREE.Texture>()
const materials = new Map<string, THREE.MeshStandardMaterial>()
/** Settles (never rejects) once the texture's image has loaded or its load has failed. */
const loads = new WeakMap<THREE.Texture, Promise<void>>()

/** Resolves when `texture` has its image or has failed to load; at once for one that was never requested. */
export const textureLoaded = (texture: THREE.Texture): Promise<void> => loads.get(texture) ?? Promise.resolve()

const loadTexture = (
  path: string,
  colorSpace: THREE.ColorSpace,
  onError: () => void,
  // The glb UVs are UE's (origin top-left, copied as-is by the extractor). The programs run the game's own
  // math on them, so their textures keep the PNG's row order; three's default flip is what the tiled reads
  // were tuned with.
  flipY = true
): THREE.Texture => {
  const key = `${colorSpace}|${flipY}|${path}`
  const cached = textures.get(key)
  if (cached !== undefined) return cached
  // Without a DOM (unit tests) there's no image loader; keep an empty texture.
  let texture: THREE.Texture
  if (typeof document === "undefined") {
    texture = new THREE.Texture()
  } else {
    let settle = (): void => {}
    const load = new Promise<void>((resolve) => {
      settle = resolve
    })
    texture = textureLoader.load(textureUrl(path), settle, undefined, () => {
      textures.delete(key)
      onError()
      settle()
    })
    loads.set(texture, load)
  }
  texture.colorSpace = colorSpace
  texture.flipY = flipY
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  textures.set(key, texture)
  return texture
}

/** The shader patch's inputs; `defines` (and `glsl`, per material) make the program cache key. */
export interface Patch {
  readonly defines: Readonly<Record<string, number>>
  /** The material's own GLSL (an `approx.programs` function and its samplers), or "". */
  readonly glsl: string
  readonly uniforms: Record<string, THREE.IUniform> & {
    readonly uBaseColorTiling: THREE.IUniform<THREE.Vector2>
    readonly uNormalTiling: THREE.IUniform<THREE.Vector2>
    readonly uOpacityTiling: THREE.IUniform<THREE.Vector2>
    readonly uVariationTiling: THREE.IUniform<THREE.Vector2>
    readonly uVariationTiling2: THREE.IUniform<THREE.Vector2>
    readonly uVariationTiling3: THREE.IUniform<THREE.Vector2>
    /** The mottle's three offsets and, in w, its gain (`1 + gain * product`). */
    readonly uVariationShape: THREE.IUniform<THREE.Vector4>
    readonly uVariationMap: THREE.IUniform<THREE.Texture | null>
    readonly uNormalMap2: THREE.IUniform<THREE.Texture | null>
    readonly uColorMap1: THREE.IUniform<THREE.Texture | null>
    readonly uColorMap2: THREE.IUniform<THREE.Texture | null>
    readonly uColor1Tiling: THREE.IUniform<THREE.Vector2>
    readonly uColor2Tiling: THREE.IUniform<THREE.Vector2>
    readonly uColor1Gain: THREE.IUniform<THREE.Vector3>
    readonly uColor2Gain: THREE.IUniform<THREE.Vector3>
    readonly uColor1Mean: THREE.IUniform<THREE.Vector3>
    readonly uColor2Mean: THREE.IUniform<THREE.Vector3>
    readonly uAlphaMap: THREE.IUniform<THREE.Texture | null>
    readonly uAlphaTiling: THREE.IUniform<THREE.Vector2>
    /** gain, mean */
    readonly uAlphaShape: THREE.IUniform<THREE.Vector2>
    readonly uUpFade: THREE.IUniform<number>
    /** Game time in seconds for the programs that scroll (the vent's streaks); a fixed frame. */
    readonly uBallestTime: THREE.IUniform<number>
    readonly uNormal2Tiling: THREE.IUniform<THREE.Vector2>
    readonly uNormal2Strength: THREE.IUniform<number>
    readonly uOutlineInset: THREE.IUniform<THREE.Vector2>
    readonly uOutlineColor: THREE.IUniform<THREE.Color>
  }
}

type ProgramKind = "alpha" | "glow" | "base"

const vec2 = (p: Pair) => new THREE.Vector2(p[0], p[1])
const isOne = (p: Pair) => p[0] === 1 && p[1] === 1

const patchOf = (
  spec: Omit<MaterialSpec, "path">,
  variation: THREE.Texture | null,
  normal2: THREE.Texture | null,
  colorMaps: ReadonlyArray<THREE.Texture>,
  alphaMap: THREE.Texture | null,
  program:
    | { readonly kind: ProgramKind; readonly code: string; readonly maps: ReadonlyArray<[string, THREE.Texture]> }
    | null
): Patch | undefined => {
  const defines: Record<string, number> = {}
  const { tiling } = spec
  const projected = spec.projection !== "uv"
  if (projected || !isOne(tiling.baseColor) || !isOne(tiling.normal) || !isOne(tiling.opacity)) {
    defines["BALLEST_TILING"] = 1
  }
  if (spec.projection === "object") defines["BALLEST_OBJECT"] = 1
  if (spec.projection === "world") defines["BALLEST_WORLD"] = 1
  if (projected && spec.instanceScale) defines["BALLEST_INSTANCE_SCALE"] = 1
  if (variation !== null && spec.variation !== undefined) {
    defines["BALLEST_VARIATION"] = Math.min(3, spec.variation.tilings.length)
  }
  if (normal2 !== null) defines["BALLEST_NORMAL2"] = 1
  if (colorMaps.length > 0) defines["BALLEST_COLOR"] = colorMaps.length
  if (alphaMap !== null) defines["BALLEST_ALPHA"] = 1
  // A program carries the game's own cap mask; the up fade stands in only without one.
  if (spec.translucent && spec.upFade < 1 && program === null) defines["BALLEST_UP_FADE"] = 1
  if (spec.outline !== undefined) defines["BALLEST_OUTLINE"] = 1
  if (program !== null) defines[`BALLEST_PROGRAM_${program.kind.toUpperCase()}`] = 1
  if (Object.keys(defines).length === 0) return undefined
  const outline = spec.outline
  const vt = spec.variation?.tilings ?? []
  const vo = spec.variation?.offsets ?? []
  const glsl = program === null
    ? ""
    : `${program.maps.map(([uniform]) => `uniform sampler2D ${uniform};`).join("\n")}\n${program.code}\n`
  return {
    defines,
    glsl,
    uniforms: {
      ...Object.fromEntries((program?.maps ?? []).map(([uniform, map]) => [uniform, { value: map }])),
      uBallestTime: { value: 0 },
      uBaseColorTiling: { value: vec2(tiling.baseColor) },
      uNormalTiling: { value: vec2(tiling.normal) },
      uOpacityTiling: { value: vec2(tiling.opacity) },
      uVariationTiling: { value: vec2(vt[0] ?? [1, 1]) },
      uVariationTiling2: { value: vec2(vt[1] ?? vt[0] ?? [1, 1]) },
      uVariationTiling3: { value: vec2(vt[2] ?? vt[0] ?? [1, 1]) },
      // A missing layer reads as a constant 1 (offset 1, and the texture term is dropped by the shader).
      uVariationShape: {
        value: new THREE.Vector4(
          vo[0] ?? 0,
          vt.length > 1 ? vo[1] ?? 0 : 1,
          vt.length > 2 ? vo[2] ?? 0 : 1,
          spec.variation?.gain ?? 0
        )
      },
      uVariationMap: { value: variation },
      uNormalMap2: { value: normal2 },
      uColorMap1: { value: colorMaps[0] ?? null },
      uColorMap2: { value: colorMaps[1] ?? null },
      uColor1Tiling: { value: vec2(spec.colorLayers[0]?.tiling ?? [1, 1]) },
      uColor2Tiling: { value: vec2(spec.colorLayers[1]?.tiling ?? [1, 1]) },
      uColor1Gain: { value: new THREE.Vector3(...(spec.colorLayers[0]?.gain ?? [0, 0, 0])) },
      uColor2Gain: { value: new THREE.Vector3(...(spec.colorLayers[1]?.gain ?? [0, 0, 0])) },
      uColor1Mean: { value: new THREE.Vector3(...(spec.colorLayers[0]?.mean ?? [0.5, 0.5, 0.5])) },
      uColor2Mean: { value: new THREE.Vector3(...(spec.colorLayers[1]?.mean ?? [0.5, 0.5, 0.5])) },
      uAlphaMap: { value: alphaMap },
      uAlphaTiling: { value: vec2(spec.opacityLayer?.tiling ?? [1, 1]) },
      uAlphaShape: { value: new THREE.Vector2(spec.opacityLayer?.gain ?? 0, spec.opacityLayer?.mean ?? 0.5) },
      uUpFade: { value: spec.upFade },
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
varying float vBallestUp;
varying vec3 vBallestWorldNormal;
varying vec3 vBallestLocal;
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
// The world normal in UE's frame (three's y is UE's z); the beams fade their end caps by its z.
vBallestWorldNormal = normalize( mat3( modelMatrix ) * objectNormal ).xzy;
vBallestUp = abs( vBallestWorldNormal.z );
// The object-space position in cm with the piece's own scale: what the game's shaders see for a piece at the origin.
vBallestLocal = transformed * vBallestScale;
`
const FRAGMENT_DECLS = /* glsl */ `
varying vec3 vBallestPos;
varying vec3 vBallestNormal;
varying vec3 vBallestScale;
varying vec2 vBallestUv;
varying mat3 vBallestNormalMatrix;
varying float vBallestUp;
varying vec3 vBallestWorldNormal;
varying vec3 vBallestLocal;
uniform float uBallestTime;
uniform vec2 uBaseColorTiling;
uniform vec2 uNormalTiling;
uniform vec2 uOpacityTiling;
uniform vec2 uVariationTiling;
uniform vec2 uVariationTiling2;
uniform vec2 uVariationTiling3;
uniform vec4 uVariationShape;
uniform sampler2D uVariationMap;
uniform sampler2D uNormalMap2;
uniform sampler2D uColorMap1;
uniform sampler2D uColorMap2;
uniform vec2 uColor1Tiling;
uniform vec2 uColor2Tiling;
uniform vec3 uColor1Gain;
uniform vec3 uColor2Gain;
uniform vec3 uColor1Mean;
uniform vec3 uColor2Mean;
uniform sampler2D uAlphaMap;
uniform vec2 uAlphaTiling;
uniform vec2 uAlphaShape;
uniform float uUpFade;
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
// The mottle is the game's own expression: (r1 + o1)(r2 + o2)(r3 + o3) * gain + 1 (the Env masters' gain is
// ColorContrast - 1, the metal's -0.1: a few percent either way).
const COLOR_EXTRAS = /* glsl */ `
#ifdef BALLEST_PROGRAM_BASE
  diffuseColor.rgb = ballestBase( vBallestUv, vBallestWorldNormal, vBallestLocal, uBallestTime );
#endif
#ifdef BALLEST_COLOR
  diffuseColor.rgb += uColor1Gain * ( texture2D( uColorMap1, ballestUv( uColor1Tiling ) ).rgb - uColor1Mean );
  #if BALLEST_COLOR >= 2
    diffuseColor.rgb += uColor2Gain * ( texture2D( uColorMap2, ballestUv( uColor2Tiling ) ).rgb - uColor2Mean );
  #endif
  diffuseColor.rgb = clamp( diffuseColor.rgb, 0.0, 1.0 );
#endif
#ifdef BALLEST_ALPHA
  diffuseColor.a = clamp( diffuseColor.a + uAlphaShape.x * ( texture2D( uAlphaMap, ballestUv( uAlphaTiling ) ).r - uAlphaShape.y ), 0.0, 1.0 );
#endif
#ifdef BALLEST_UP_FADE
  // The game's beams multiply their alpha by 1 - |world normal z|: only the vertical faces show.
  diffuseColor.a *= mix( 1.0, uUpFade, vBallestUp );
#endif
#ifdef BALLEST_PROGRAM_ALPHA
  diffuseColor.a = ballestAlpha( vBallestUv, vBallestWorldNormal, vBallestLocal, uBallestTime );
#endif
#ifdef BALLEST_VARIATION
  #if BALLEST_VARIATION >= 3
    float ballestMottle3 = texture2D( uVariationMap, ballestUv( uVariationTiling3 ) ).r + uVariationShape.z;
  #else
    float ballestMottle3 = uVariationShape.z;
  #endif
  #if BALLEST_VARIATION >= 2
    float ballestMottle2 = texture2D( uVariationMap, ballestUv( uVariationTiling2 ) ).r + uVariationShape.y;
  #else
    float ballestMottle2 = uVariationShape.y;
  #endif
  float ballestMottle = ( texture2D( uVariationMap, ballestUv( uVariationTiling ) ).r + uVariationShape.x )
    * ballestMottle2 * ballestMottle3;
  diffuseColor.rgb *= 1.0 + uVariationShape.w * ballestMottle;
#endif
#ifdef BALLEST_OUTLINE
  vec2 ballestEdge = min( vBallestUv, 1.0 - vBallestUv );
  float ballestBand = max( step( ballestEdge.x, uOutlineInset.x ), step( ballestEdge.y, uOutlineInset.y ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uOutlineColor, ballestBand );
#endif
`
// The tangent-space perturbation from the normal map(s): the second layer adds at its strength.
const NORMAL_LAYERS = /* glsl */ `
#ifdef USE_NORMALMAP
vec3 ballestMapN() {
  vec3 mapN = texture2D( normalMap, ballestUv( uNormalTiling ) ).xyz * 2.0 - 1.0;
  #ifdef BALLEST_NORMAL2
    mapN.xy += ( texture2D( uNormalMap2, ballestUv( uNormal2Tiling ) ).xy * 2.0 - 1.0 ) * uNormal2Strength;
  #endif
  return mapN; // three's own chunk applies normalScale after the read; PROJECTED_NORMAL does it itself
}
#endif
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
    mapN.xy *= normalScale;
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
    .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLS}\n${patch.glsl}`)
    .replace(
      "#include <emissivemap_fragment>",
      "BALLEST_PROGRAM_GLOW" in patch.defines
        ? "totalEmissiveRadiance = ballestGlow( vBallestUv, vBallestWorldNormal, vBallestLocal, uBallestTime );"
        : "#include <emissivemap_fragment>"
    )
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
  // Materials with their own GLSL cannot share a compiled program.
  const key = Object.keys(patch.defines).sort().join(",") + (patch.glsl === "" ? "" : `|${material.name}`)
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
    if (spec.additive) material.blending = THREE.AdditiveBlending
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
  // A shaped translucent effect (the air vent's streaks, the checkpoint's glow): the shader's alpha follows a
  // texture around the opacity evaluated at its mean.
  const dropDefine = (define: string) => () => {
    material.defines = { ...material.defines }
    delete material.defines[define]
    material.needsUpdate = true
  }
  const alphaMap = spec.translucent && spec.opacityLayer !== undefined
    ? loadTexture(spec.opacityLayer.texture, THREE.NoColorSpace, dropDefine("BALLEST_ALPHA"))
    : null
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
  const colorMaps = spec.colorLayers.map((layer) =>
    loadTexture(layer.texture, colorSpaceOf(layer.texture, THREE.SRGBColorSpace), dropDefine("BALLEST_COLOR"))
  )
  // The shader's own math where there is some (one kind per material: alpha, glow or base).
  const programKind: ProgramKind | undefined = spec.programs.alpha
    ? "alpha"
    : spec.programs.glow
    ? "glow"
    : spec.programs.base
    ? "base"
    : undefined
  const programSpec = programKind === undefined ? undefined : spec.programs[programKind]
  const program = programKind === undefined || programSpec === undefined
    ? null
    : {
      kind: programKind,
      code: programSpec.code,
      maps: programSpec.textures.map((t): [string, THREE.Texture] => [
        t.uniform,
        loadTexture(
          t.texture,
          colorSpaceOf(t.texture, THREE.SRGBColorSpace),
          dropDefine(`BALLEST_PROGRAM_${programKind.toUpperCase()}`),
          false
        )
      ])
    }
  const patch = patchOf(spec, variation, normal2, colorMaps, alphaMap, program)
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
