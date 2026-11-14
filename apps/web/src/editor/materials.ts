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
 * - M_OutlineEdges' grey band along the UV border of a face;
 * - the game shader's own output chains (`approx.programs`): alpha and glow side by side for a translucent pass, glow
 *   alone (unlit) for an additive one, a base colour for what the layers can't say. They run on a shared clock, and
 *   read their mesh's bounds where the shader does.
 */
import * as THREE from "three"
import { lookupMaterial, type MaterialSpec, type MaterialTable, NEUTRAL, type Pair } from "../domain/Materials"
import { textureUrl } from "./assetUrl"
import { isMesh } from "./threeGuards"

/** Normal-map strength: the game's concrete grooves read crisper than a unit normal map gives. */
const NORMAL_STRENGTH = 1.6
/** The exponent that makes an additive glow's sum on the display-encoded framebuffer read like the game's HDR one. */
const ADDITIVE_CURVE = 1.75

/**
 * Decodes off the page's thread. An `<img>` is decoded again, on the page's thread, when WebGL uploads it without the
 * browser's colour conversion: a map's 2048 px AVIFs held up its first draw for seconds that way. A bitmap is decoded
 * once, as it will be uploaded: rows as stored (the `flipY` convention below), alpha straight, colours untouched (as a
 * data map wants, and a no-op for the sRGB colour maps).
 */
const bitmapLoader = typeof createImageBitmap === "function"
  ? new THREE.ImageBitmapLoader().setOptions({
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none"
  })
  : undefined
const textures = new Map<string, THREE.Texture>()
const materials = new Map<string, THREE.MeshStandardMaterial>()
/** Settles (never rejects) once the texture's image has loaded or its load has failed. */
const loads = new WeakMap<THREE.Texture, Promise<void>>()

/** Resolves when `texture` has its image or has failed to load; at once for one that was never requested. */
export const textureLoaded = (texture: THREE.Texture): Promise<void> => loads.get(texture) ?? Promise.resolve()

/**
 * One convention for every texture read, the game's: the glb UVs are UE's (origin top-left, copied as-is
 * by the extractor) and the projected coordinates are the game's object / world positions, so textures
 * keep the PNG's row order (`flipY` off) instead of three's default flip. The programs (`approx.programs`)
 * run the game's own math on the same reads.
 */
const loadTexture = (path: string, colorSpace: THREE.ColorSpace, onError: () => void): THREE.Texture => {
  const key = `${colorSpace}|${path}`
  const cached = textures.get(key)
  if (cached !== undefined) return cached
  // Without image decoding (unit tests) the texture stays empty.
  const texture = new THREE.Texture()
  if (bitmapLoader !== undefined) {
    const load = new Promise<void>((settle) => {
      bitmapLoader.load(
        textureUrl(path),
        (bitmap) => {
          texture.image = bitmap
          texture.needsUpdate = true
          settle()
        },
        undefined,
        () => {
          textures.delete(key)
          onError()
          settle()
        }
      )
    })
    loads.set(texture, load)
  }
  texture.colorSpace = colorSpace
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  textures.set(key, texture)
  return texture
}

/** The shader patch's inputs; `defines` (and `glsl`, per material) make the program cache key. */
interface Patch {
  readonly defines: Readonly<Record<string, number | string>>
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
    readonly uSubsurface: THREE.IUniform<THREE.Vector4>
    readonly uSubsurfaceBare: THREE.IUniform<THREE.Vector3>
    /** The frost clouds' noise scale, per cm. */
    readonly uFrostScale: THREE.IUniform<number>
    /** Game time in seconds for the programs that move (the vent's streaks); shared, see `gameTime`. */
    readonly uBallestTime: THREE.IUniform<number>
    /** The mesh's local bounds (the programs' "bounding box 0-1" coordinates); see `materialForMesh`. */
    readonly uBallestBoundsMin: THREE.IUniform<THREE.Vector3>
    readonly uBallestBoundsMax: THREE.IUniform<THREE.Vector3>
    readonly uNormal2Tiling: THREE.IUniform<THREE.Vector2>
    readonly uNormal2Strength: THREE.IUniform<number>
    readonly uOutlineInset: THREE.IUniform<THREE.Vector2>
    readonly uOutlineColor: THREE.IUniform<THREE.Color>
  }
}

/**
 * The game time the programs read. It starts well past 0 because a checkpoint's shaders count from its activation
 * (`time - ActivationTime`, 0 until the ball reaches it): at 0 they would draw the flash of the moment it is reached.
 */
const GAME_TIME_START = 600
const gameTime: THREE.IUniform<number> = { value: GAME_TIME_START }

/** Moves the programs' clock on by `seconds`: the air and the glows scroll as they do in the game. */
export const advanceGameTime = (seconds: number): void => {
  gameTime.value += seconds
}

type ProgramKind = "alpha" | "glow" | "base"

/** One of the game shader's output chains: its GLSL and the samplers it reads, as `[uniform, texture]`. */
interface Program {
  readonly kind: ProgramKind
  readonly code: string
  readonly maps: ReadonlyArray<[string, THREE.Texture]>
}

const vec2 = (p: Pair) => new THREE.Vector2(p[0], p[1])
const isOne = (p: Pair) => p[0] === 1 && p[1] === 1

const patchOf = (
  spec: Omit<MaterialSpec, "path">,
  variation: THREE.Texture | null,
  normal2: THREE.Texture | null,
  colorMaps: ReadonlyArray<THREE.Texture>,
  alphaMap: THREE.Texture | null,
  programs: ReadonlyArray<Program>
): Patch | undefined => {
  const defines: Record<string, number | string> = {}
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
  if (alphaMap !== null) {
    defines["BALLEST_ALPHA"] = 1
    // The channel the game's shader reads the alpha shape from (a swizzle, so a define).
    defines["BALLEST_ALPHA_CHANNEL"] = spec.opacityLayer?.channel ?? "r"
  }
  // A program carries the game's own cap mask; the up fade stands in only without one.
  if (spec.translucent && spec.upFade < 1 && programs.length === 0) defines["BALLEST_UP_FADE"] = 1
  if (spec.outline !== undefined) defines["BALLEST_OUTLINE"] = 1
  for (const program of programs) defines[`BALLEST_PROGRAM_${program.kind.toUpperCase()}`] = 1
  if (spec.additive) defines["BALLEST_UNLIT"] = 1
  if (spec.subsurface !== undefined) defines["BALLEST_SUBSURFACE"] = 1
  if (spec.subsurface?.frost !== undefined) defines["BALLEST_FROST"] = 1
  if (Object.keys(defines).length === 0) return undefined
  const outline = spec.outline
  const vt = spec.variation?.tilings ?? []
  const vo = spec.variation?.offsets ?? []
  const glsl = programs
    .map((p) => `${p.maps.map(([uniform]) => `uniform sampler2D ${uniform};`).join("\n")}\n${p.code}\n`)
    .join("")
  return {
    defines,
    glsl,
    uniforms: {
      ...Object.fromEntries(programs.flatMap((p) => p.maps).map(([uniform, map]) => [uniform, { value: map }])),
      uBallestTime: gameTime,
      uBallestBoundsMin: { value: new THREE.Vector3() },
      uBallestBoundsMax: { value: new THREE.Vector3(1, 1, 1) },
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
      uSubsurface: {
        value: new THREE.Vector4(...(spec.subsurface?.color ?? [0, 0, 0]), spec.subsurface?.opacity ?? 1)
      },
      uSubsurfaceBare: { value: new THREE.Vector3(...(spec.subsurface?.frost?.bare ?? [0, 0, 0])) },
      uFrostScale: { value: spec.subsurface?.frost?.scale ?? 0 },
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
// A batched mesh (editor/meshBatches.ts) stands where its instance matrix puts it.
#ifdef USE_INSTANCING
  mat4 ballestModel = modelMatrix * instanceMatrix;
  mat3 ballestNormalMatrix = transpose( inverse( mat3( viewMatrix * ballestModel ) ) );
#else
  mat4 ballestModel = modelMatrix;
  mat3 ballestNormalMatrix = normalMatrix;
#endif
vBallestScale = vec3( length( ballestModel[ 0 ].xyz ), length( ballestModel[ 1 ].xyz ), length( ballestModel[ 2 ].xyz ) );
// Normals take the inverse transpose: the model matrix itself would tilt them on a piece scaled unevenly, the meshes'
// quantised normals by as much as 30 times their error on a thin slab.
vec3 ballestWorldNormal = normalize( transpose( inverse( mat3( ballestModel ) ) ) * objectNormal ).xzy;
#ifdef BALLEST_WORLD
  vBallestPos = ( ballestModel * vec4( transformed, 1.0 ) ).xzy;
  vBallestNormal = ballestWorldNormal;
#else
  vBallestPos = transformed * vBallestScale;
  vBallestNormal = objectNormal;
#endif
vBallestUv = uv;
vBallestNormalMatrix = ballestNormalMatrix;
// The world normal in UE's frame (three's y is UE's z); the beams fade their end caps by its z.
vBallestWorldNormal = ballestWorldNormal;
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
uniform vec3 uBallestBoundsMin;
uniform vec3 uBallestBoundsMax;
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
uniform vec4 uSubsurface;
uniform vec3 uSubsurfaceBare;
uniform float uFrostScale;
uniform vec2 uNormal2Tiling;
uniform float uNormal2Strength;
uniform vec2 uOutlineInset;
uniform vec3 uOutlineColor;
#ifdef BALLEST_FROST
vec3 ballestGradient( vec3 c ) {
  vec3 h = fract( sin( vec3( dot( c, vec3( 127.1, 311.7, 74.7 ) ), dot( c, vec3( 269.5, 183.3, 246.1 ) ), dot( c, vec3( 113.5, 271.9, 124.6 ) ) ) ) * 43758.5453 );
  return h * 2.0 - 1.0;
}
// Gradient noise standing in for the engine's Perlin volume: the same kind of noise, not the game's own pattern.
float ballestNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p ), u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  return mix(
    mix(
      mix( dot( ballestGradient( i ), f ), dot( ballestGradient( i + vec3( 1, 0, 0 ) ), f - vec3( 1, 0, 0 ) ), u.x ),
      mix( dot( ballestGradient( i + vec3( 0, 1, 0 ) ), f - vec3( 0, 1, 0 ) ), dot( ballestGradient( i + vec3( 1, 1, 0 ) ), f - vec3( 1, 1, 0 ) ), u.x ),
      u.y
    ),
    mix(
      mix( dot( ballestGradient( i + vec3( 0, 0, 1 ) ), f - vec3( 0, 0, 1 ) ), dot( ballestGradient( i + vec3( 1, 0, 1 ) ), f - vec3( 1, 0, 1 ) ), u.x ),
      mix( dot( ballestGradient( i + vec3( 0, 1, 1 ) ), f - vec3( 0, 1, 1 ) ), dot( ballestGradient( i + vec3( 1, 1, 1 ) ), f - vec3( 1, 1, 1 ) ), u.x ),
      u.y
    ),
    u.z
  );
}
// M_IceCube's frost, 0 (bare) to 1: soft clouds at the material's own scale. Its mask also fades with the camera's
// distance, through terms that fold away in the cooked shader, so the mean and the spread are measured off the game's
// ice instead: a floor sits about three quarters of the way from bare to frosted, and moves about a third either way.
float ballestFrost( vec3 position ) {
  vec3 p = position * uFrostScale;
  float noise = ballestNoise( p ) + ballestNoise( p * 3.0 ) / 3.0;
  return saturate( 0.75 + 1.1 * noise );
}
#endif
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
  diffuseColor.a = clamp( diffuseColor.a + uAlphaShape.x * ( texture2D( uAlphaMap, ballestUv( uAlphaTiling ) ).BALLEST_ALPHA_CHANNEL - uAlphaShape.y ), 0.0, 1.0 );
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
// The game blends a translucent pass in HDR, so a little of a bright glow still saturates the pixel; here it is
// tone-mapped first and blended after, where the same alpha leaves a dull mix. An emissive above 1 moves its energy
// into the alpha, and the colour drops by as much, which keeps the product the game blends.
const GLOW_FRAGMENT = /* glsl */ `
totalEmissiveRadiance = ballestGlow( vBallestUv, vBallestWorldNormal, vBallestLocal, uBallestTime );
#ifdef BALLEST_PROGRAM_ALPHA
  float ballestPeak = max( max( totalEmissiveRadiance.r, totalEmissiveRadiance.g ), totalEmissiveRadiance.b );
  float ballestShown = min( 1.0, diffuseColor.a * max( ballestPeak, 1.0 ) );
  totalEmissiveRadiance *= diffuseColor.a / max( ballestShown, 1e-4 );
  diffuseColor.a = ballestShown;
#endif
`
// UE's subsurface shading (MSM_Subsurface): the colour joins the diffuse colour for indirect light, and the sun
// scatters through it (SubsurfaceBxDF): back scatter that barely depends on the normal, plus in-scatter when looking
// towards the light. A face turned from the sun gets none: the piece's own shadow stops the transmission.
const SUBSURFACE_LIGHT = /* glsl */ `
#ifdef BALLEST_SUBSURFACE
  #ifdef BALLEST_FROST
    vec3 ballestColor = mix( uSubsurfaceBare, uSubsurface.rgb, ballestFrost( vBallestPos ) );
  #else
    vec3 ballestColor = uSubsurface.rgb;
  #endif
  reflectedLight.indirectDiffuse += ballestColor * ( irradiance + iblIrradiance ) * RECIPROCAL_PI;
  #if NUM_DIR_LIGHTS > 0
  {
    vec3 ballestL = directionalLights[ 0 ].direction;
    vec3 ballestV = normalize( vViewPosition );
    float ballestOpacity = uSubsurface.a;
    float ballestNoH = saturate( dot( normal, normalize( ballestL + ballestV ) ) );
    float ballestBack = saturate( ballestNoH * ballestOpacity + 1.0 - ballestOpacity ) / ( 2.0 * PI );
    float ballestIn = pow( saturate( dot( ballestL, -ballestV ) ), 12.0 ) * mix( 3.0, 0.1, ballestOpacity );
    float ballestLit = smoothstep( -0.3, 0.0, dot( normal, ballestL ) );
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * ballestColor
      * mix( ballestBack, 1.0, ballestIn ) * ballestLit;
  }
  #endif
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
      "BALLEST_PROGRAM_GLOW" in patch.defines ? GLOW_FRAGMENT : "#include <emissivemap_fragment>"
    )
    .replace("#include <normalmap_pars_fragment>", `#include <normalmap_pars_fragment>\n${NORMAL_LAYERS}`)
    // An additive pass adds its unlit colour alone: the sky must not reflect in a glow. The game adds it to the HDR
    // scene before tone mapping; here the framebuffer is already display-encoded, where the same sum comes out far
    // too strong in the dim channels, so the colour goes through a curve and skips the tone mapping (`build`).
    .replace(
      "#include <opaque_fragment>",
      `#ifdef BALLEST_UNLIT
  outgoingLight = pow( max( totalEmissiveRadiance, 0.0 ), vec3( ${ADDITIVE_CURVE.toFixed(2)} ) );
#endif
#include <opaque_fragment>`
    )
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
    .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${SUBSURFACE_LIGHT}`)
}

const patches = new WeakMap<THREE.Material, Patch>()

/** The shader patch installed on a material by `materialFor`, if it needed one. */
export const shaderPatchOf = (material: THREE.Material): Patch | undefined => patches.get(material)

/** Installs the patch on `material`; see the module comment for what it adds. */
const patchShader = (material: THREE.MeshStandardMaterial, patch: Patch): void => {
  material.defines = { ...material.defines, ...patch.defines }
  // Materials with their own GLSL cannot share a compiled program.
  const key = Object.keys(patch.defines).sort().map((k) => `${k}=${patch.defines[k]}`).join(",") +
    (patch.glsl === "" ? "" : `|${material.name}`)
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
    // One pass with both faces, as the game draws a two-sided translucent mesh. three would otherwise draw the back
    // faces and then the front, flipping `side` and marking the material changed for each, so every frame it worked out
    // every vent's and checkpoint's program again: a fifth of a map's frame.
    material.forceSinglePass = true
    if (spec.additive) {
      material.blending = THREE.AdditiveBlending
      material.toneMapped = false
    }
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
    // UE normal maps use DirectX green (+Y = down the image); with the rows unflipped that is +v, three's
    // bitangent, so no sign flip (three's default flip would need (1, -1)).
    material.normalScale.setScalar(NORMAL_STRENGTH * spec.normalStrength)
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
  // The shader's own math where there is some: a translucent pass runs its alpha and its glow side by side.
  const programs = (["alpha", "glow", "base"] as const).flatMap((kind): ReadonlyArray<Program> => {
    const program = spec.programs[kind]
    if (program === undefined) return []
    return [{
      kind,
      code: program.code,
      maps: program.textures.map((t): [string, THREE.Texture] => [
        t.uniform,
        loadTexture(
          t.texture,
          colorSpaceOf(t.texture, THREE.SRGBColorSpace),
          dropDefine(`BALLEST_PROGRAM_${kind.toUpperCase()}`)
        )
      ])
    }]
  })
  const patch = patchOf(spec, variation, normal2, colorMaps, alphaMap, programs)
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

/**
 * The material for `mesh`. A program that reads its mesh's bounds (the rubber's cells, the checkpoints' glow) sizes its
 * pattern from them, so those materials are built once per mesh size; the rest are shared.
 */
const materialForMesh = (
  table: MaterialTable | null,
  path: string | undefined,
  mesh: THREE.Mesh
): THREE.MeshStandardMaterial => {
  const shared = materialFor(table, path)
  const patch = patches.get(shared)
  const spec = lookupMaterial(table, path)
  if (patch?.glsl.includes("uBallestBounds") !== true || spec === undefined) return shared
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  if (box === null) return shared
  const key = `${spec.path}|${box.min.toArray().join()}|${box.max.toArray().join()}`
  const cached = materials.get(key)
  if (cached !== undefined) return cached
  const material = build(spec, table)
  const own = patches.get(material)
  own?.uniforms.uBallestBoundsMin.value.copy(box.min)
  own?.uniforms.uBallestBoundsMax.value.copy(box.max)
  materials.set(key, material)
  return material
}

const flatShaded = new WeakMap<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>()

/**
 * `material` shaded by each triangle's own plane instead of the mesh's normals. There is one per material, so the
 * meshes that use it still share a material; a copy doesn't carry the shader patch, so it is installed again.
 */
const flatShadedOf = (material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
  const cached = flatShaded.get(material)
  if (cached !== undefined) return cached
  const flat = material.clone()
  flat.flatShading = true
  const patch = patches.get(material)
  if (patch !== undefined) patchShader(flat, patch)
  flatShaded.set(material, flat)
  return flat
}

/**
 * Assigns game materials to every primitive under `root` by UE slot index, flat-shaded for a mesh whose faces are
 * all planar (`isFlatFaced` in visuals.ts).
 */
export const applySlotMaterials = (
  root: THREE.Object3D,
  table: MaterialTable | null,
  slotMaterials: ReadonlyArray<string | undefined>,
  flat = false
): void =>
  root.traverse((object) => {
    if (!isMesh(object)) return
    const material = materialForMesh(table, slotMaterials[slotIndexOf(object)], object)
    object.material = flat ? flatShadedOf(material) : material
  })
