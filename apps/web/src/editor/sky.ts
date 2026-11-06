/**
 * The game's sky as a three.js material (see domain/sky for where each term comes from).
 * `dome` draws the visible sky, with the sun disc and stars, hazing out over the far floor
 * (`uClipY`) so the clear colour shows nearer in, and in dark towards the pane's top edge; `capture` draws the same sky without
 * the sun, and with the arena below `ARENA_RIM`, for the environment map the scene is lit by
 * (the game's sky light is a real-time capture of this sky).
 */
import * as THREE from "three"
import { type Tuple3, ueToThreeVector } from "../domain/coords"
import { ARENA_RIM, type Sky, SKY_GAIN, SUN_RADIUS } from "../domain/sky"

/** The visible dome's radius (cm), which is also where the floor grid finishes fading out, with or without the sky. */
export const SKY_DOME_RADIUS = 60_000

/**
 * Where the sky fades in, on the dome, from below the grid's height to above it (cm): the far floor hazes into the
 * horizon instead of ending in a flat band of the clear colour. 3° above, seen from the floor, and about 20° below in
 * light; 7° in dark, where a bright sky over a near-black floor would otherwise light up a third of the pane.
 */
export const SKY_HAZE_BELOW = { dark: SKY_DOME_RADIUS * 0.12, light: SKY_DOME_RADIUS * 0.34 } as const
const SKY_HAZE_ABOVE = SKY_DOME_RADIUS * 0.05

/**
 * How much the sky fades out towards the top of a pane, where the pane meets the chrome: all of it in dark, so a bright
 * horizon can't sit against the near-black strip above it. It goes by the pane and not the sky, so it holds wherever the
 * camera points. The sky has gone by `SKY_PANE_TOP_END`, in the pane's height from -1 to 1 (the top 25 px of 1,000).
 */
export const SKY_PANE_TOP_FADE = { dark: 1, light: 0 } as const
const SKY_PANE_TOP_START = 0.45
const SKY_PANE_TOP_END = 0.95

/**
 * GLSL: how far the sky has faded in (0 to 1) along direction `d`, over a floor at `clipY`. It measures how far above the
 * floor `d` meets the dome. The water thins out by the same curve, so the two cross over with nothing showing between.
 */
export const SKY_HAZE_GLSL = /* glsl */ `
float ballestSkyHaze( vec3 d, float clipY, float below ) {
  float above = cameraPosition.y + d.y * ${SKY_DOME_RADIUS.toFixed(1)} - clipY;
  return smoothstep( -below, ${SKY_HAZE_ABOVE.toFixed(1)}, above );
}
`

/** Exposure on the visible sky; the game's auto exposure has no counterpart here. */
const SKY_EXPOSURE = 1.6

const vertexShader = /* glsl */ `
varying vec3 vDir;
varying vec2 vPaneY;
void main() {
  vDir = position; // the dome is centred on the camera
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  vPaneY = gl_Position.yw;
}
`

// Directions are three's (y up). The sky depends on elevation (d.y) and the angle to the sun.
const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uFalloff;
uniform vec3 uToSun;
uniform vec3 uSun;
uniform float uStars;
uniform float uGain;
uniform vec3 uGround;
uniform float uClipY;
uniform float uHazeBelow;
uniform float uPaneTopFade;
varying vec3 vDir;
varying vec2 vPaneY;
${SKY_HAZE_GLSL}
float ballestHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

// Sparse points on a latitude/longitude grid, in place of the game's star texture.
float ballestStars( vec3 d ) {
  vec2 cell = vec2( atan( d.z, d.x ) * 300.0, asin( clamp( d.y, -1.0, 1.0 ) ) * 300.0 );
  vec2 id = floor( cell );
  float h = ballestHash( id );
  float r = length( fract( cell ) - 0.5 );
  return step( 0.985, h ) * smoothstep( 0.35, 0.0, r ) * ballestHash( id + 7.0 );
}

void main() {
  vec3 d = normalize( vDir );
  float up = clamp( d.y, 0.0, 1.0 );
  float f = 1.0 - up <= 1e-7 ? 0.0 : clamp( pow( 1.0 - up, uFalloff ), 0.0, 1.0 );
  vec3 color = mix( uZenith + uStars * 0.5 * ballestStars( d ), uHorizon, f );
  float alpha = 1.0;
  #ifdef BALLEST_CAPTURE
    // The stands' top edge isn't a line in the distance: a soft step, and the normal maps don't break it into specks.
    color = mix( uGround, color, smoothstep( ${(ARENA_RIM * 0.8).toFixed(4)}, ${(ARENA_RIM * 1.2).toFixed(4)}, d.y ) );
  #else
    // From the exact direction, not the faceted mesh.
    alpha = ballestSkyHaze( d, uClipY, uHazeBelow );
    alpha *= 1.0 - uPaneTopFade * smoothstep( ${SKY_PANE_TOP_START.toFixed(2)}, ${
  SKY_PANE_TOP_END.toFixed(2)
}, vPaneY.x / vPaneY.y );
    if ( alpha <= 0.0 ) discard;
    color += uSun * clamp( 1.0 - abs( dot( d, uToSun ) - 1.0 ) / ${SUN_RADIUS.toFixed(6)}, 0.0, 1.0 );
  #endif
  gl_FragColor = vec4( color * uGain, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifndef BALLEST_CAPTURE
    // Triangular dither of about one 8-bit step on the colour and the fade, so the long, slow
    // gradients (the fade onto the background, the horizon) don't band.
    vec2 p = gl_FragCoord.xy;
    float dither = ballestHash( p ) + ballestHash( p + 17.31 ) - 1.0;
    gl_FragColor.rgb += dither / 255.0;
    gl_FragColor.a = clamp( gl_FragColor.a + dither / 255.0, 0.0, 1.0 );
  #endif
}
`

type SkyKind = "dome" | "capture"

const skyGain: Readonly<Record<SkyKind, number>> = { dome: SKY_GAIN * SKY_EXPOSURE, capture: SKY_GAIN }

const skyUniforms = (kind: SkyKind) => ({
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uFalloff: { value: 3 },
  uToSun: { value: new THREE.Vector3(0, 1, 0) },
  uSun: { value: new THREE.Color() },
  uStars: { value: 0 },
  uGain: { value: skyGain[kind] },
  uGround: { value: new THREE.Color() },
  /** World height (scene units) of the grid, which the visible dome's fade is measured from. */
  uClipY: { value: -Infinity },
  uHazeBelow: { value: SKY_HAZE_BELOW.light },
  uPaneTopFade: { value: SKY_PANE_TOP_FADE.light as number }
})

/**
 * The sky from inside a sphere: drawn first and behind everything (no depth). The visible
 * dome blends its fade onto the clear colour with custom blending, which three applies in the
 * opaque pass (a transparent material would be drawn after the pieces), and leaves the
 * canvas's alpha as it is.
 */
export class SkyMaterial extends THREE.ShaderMaterial {
  readonly sky: ReturnType<typeof skyUniforms>

  constructor(kind: SkyKind) {
    const sky = skyUniforms(kind)
    const capture = kind === "capture"
    super({
      uniforms: sky,
      vertexShader,
      fragmentShader,
      defines: capture ? { BALLEST_CAPTURE: "" } : {},
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false
    })
    this.sky = sky
    if (!capture) {
      this.blending = THREE.CustomBlending
      this.blendSrc = THREE.SrcAlphaFactor
      this.blendDst = THREE.OneMinusSrcAlphaFactor
      this.blendSrcAlpha = THREE.ZeroFactor
      this.blendDstAlpha = THREE.OneFactor
    }
    // three tone-maps the visible sky; the capture stays linear for lighting.
    this.toneMapped = !capture
  }
}

/** Puts `sky` into a sky material; `ground` is the capture's arena (linear RGB) below `ARENA_RIM`. */
export const setSky = (material: SkyMaterial, sky: Sky, ground: Tuple3): void => {
  const u = material.sky
  u.uZenith.value.setRGB(...sky.zenith, THREE.LinearSRGBColorSpace)
  u.uHorizon.value.setRGB(...sky.horizon, THREE.LinearSRGBColorSpace)
  u.uFalloff.value = sky.horizonFalloff
  const toSun = ueToThreeVector(sky.toSun)
  u.uToSun.value.set(toSun.x, toSun.y, toSun.z).normalize()
  u.uSun.value.setRGB(sky.sunBrightness, sky.sunBrightness, sky.sunBrightness, THREE.LinearSRGBColorSpace)
  u.uStars.value = sky.stars
  u.uGround.value.setRGB(...ground, THREE.LinearSRGBColorSpace)
}
