/**
 * The game's sky as a three.js material (see domain/sky for where each term comes from).
 * `dome` draws the visible sky, with the sun disc and stars, down to the horizon, and the sea below it past the end of the
 * water sheet; `capture` draws the same sky without the sun, and with the arena below `ARENA_RIM`, for the environment map
 * the scene is lit by (the game's sky light is a real-time capture of this sky).
 */
import * as THREE from "three"
import { type Tuple3, ueToThreeVector } from "../domain/coords"
import { WATER } from "../domain/level"
import { ARENA_RIM, type Sky, SKY_GAIN, SUN_RADIUS } from "../domain/sky"

/** The visible dome's radius (cm), which is also where the floor grid starts to fade out, with or without the sky. */
export const SKY_DOME_RADIUS = 60_000

/** Sines of the elevations the sky fades in between: about 0.4° below the horizon to 1.5° above it. */
const SKY_HAZE_BELOW = 0.007
const SKY_HAZE_ABOVE = 0.026

/**
 * GLSL: how far the sky has faded in (0 to 1) along direction `d`. Only the direction counts: the game's sky is
 * as far away as the horizon, so the camera's height doesn't move it. The water thins out by the same curve, so
 * the two cross over with nothing showing between.
 */
export const SKY_HAZE_GLSL = /* glsl */ `
float ballestSkyHaze( vec3 d ) {
  return smoothstep( ${(-SKY_HAZE_BELOW).toFixed(4)}, ${SKY_HAZE_ABOVE.toFixed(4)}, d.y );
}
`

/** Where the water sheet starts to give out (cm from its centre, on either axis) and its edge. */
const SEA_EDGE_END = WATER.size / 2
const SEA_EDGE_START = SEA_EDGE_END * 0.8

/** GLSL: how far the sheet has given out (0 to 1) at `fromCentre` on it. The dome's sea takes over as it does. */
export const SEA_EDGE_GLSL = /* glsl */ `
float ballestSeaEdge( vec2 fromCentre ) {
  float reach = max( abs( fromCentre.x ), abs( fromCentre.y ) );
  return smoothstep( ${SEA_EDGE_START.toFixed(1)}, ${SEA_EDGE_END.toFixed(1)}, reach );
}
`

/** The widths of the sea's ripples (cm), so some are always in view: finer ones only show from nearer. */
const SEA_RIPPLES = [400, 1_600, 6_400, 25_600]
/** How far one set of ripples, and a glint, lift the sea's encoded colour at most. They only lift: the water has no red to take away. */
const SEA_RIPPLE_LIFT = 0.09
const SEA_GLINT_LIFT = 0.6
/** A cell of the glints scattered on the sea (cm), how many hold one, and how wide one is. */
const SEA_GLINT_CELL = 1_000
const SEA_GLINT_SHARE = 0.25
const SEA_GLINT_RADIUS = 18

/**
 * GLSL: what the surface adds to the sea's encoded colour at `world` (x, z on it), which is what shows how high the sea
 * is: flat colour looks the same from any height. As in the game, ripples and glints stay put on the water and shrink
 * with distance. Both go before the screen can no longer draw them. The sheet and the dome's sea both add this, each in
 * its share, so they stay one surface.
 */
export const SEA_SHADE_GLSL = /* glsl */ `
uniform float uSeaRelief;

float ballestHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

float ballestNoise( vec2 p ) {
  vec2 cell = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( ballestHash( cell ), ballestHash( cell + vec2( 1.0, 0.0 ) ), f.x ),
    mix( ballestHash( cell + vec2( 0.0, 1.0 ) ), ballestHash( cell + vec2( 1.0, 1.0 ) ), f.x ),
    f.y
  );
}

float ballestSeaShade( vec2 world ) {
  float pixel = length( fwidth( world ) );
  // Turned off the grid's axes, which the noise's cells would otherwise line up with.
  vec2 turned = vec2( world.x * 0.8 + world.y * 0.6, world.y * 0.8 - world.x * 0.6 );
  float ripples = 0.0;
  ${
  SEA_RIPPLES.map((width) =>
    `ripples += pow( ballestNoise( turned / vec2( ${width.toFixed(1)}, ${(width / 3).toFixed(1)} ) ), 2.0 )
    * ( 1.0 - smoothstep( 0.1, 0.4, pixel / ${width.toFixed(1)} ) );`
  ).join("\n  ")
}
  vec2 cell = floor( world / ${SEA_GLINT_CELL.toFixed(1)} );
  vec2 glintAt = ( cell + 0.15 + 0.7 * vec2( ballestHash( cell + 3.0 ), ballestHash( cell + 5.0 ) ) ) * ${
  SEA_GLINT_CELL.toFixed(1)
};
  // A glint under a pixel stays a pixel wide and dims to match, so it doesn't flicker as the view moves.
  float radius = max( ${SEA_GLINT_RADIUS.toFixed(1)}, pixel );
  float glint = step( ballestHash( cell ), ${SEA_GLINT_SHARE.toFixed(2)} )
    * ( 1.0 - smoothstep( 0.0, radius, distance( world, glintAt ) ) )
    * ${SEA_GLINT_RADIUS.toFixed(1)} / radius
    * ( 1.0 - smoothstep( 0.1, 0.3, pixel / ${SEA_GLINT_CELL.toFixed(1)} ) );
  return ( ripples * ${SEA_RIPPLE_LIFT.toFixed(2)} + glint * ${SEA_GLINT_LIFT.toFixed(2)} ) * uSeaRelief;
}
`

/** The sea past the sheet: what the sheet looks like over the clear colour, and in `w` its opacity, 0 with no sea. water.ts keeps it. */
export const SEA_SHOWN = { value: new THREE.Vector4() }

/** How strongly the surface shows, in the theme and the light the water is under. water.ts keeps it. */
export const SEA_RELIEF = { value: 0 }

const SEA_POSITION = ueToThreeVector({ ...WATER.center, z: WATER.height })
const SEA_CENTRE_GLSL = `vec2( ${SEA_POSITION.x.toFixed(5)}, ${SEA_POSITION.z.toFixed(5)} )`

/** Exposure on the visible sky above the horizon's colour; the game's auto exposure has no counterpart here. */
const SKY_EXPOSURE = 1.6

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // the dome is centred on the camera
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`

// Directions are three's (y up). The sky depends on elevation (d.y) and the angle to the sun.
const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uShownHorizon;
uniform float uFalloff;
uniform vec3 uToSun;
uniform vec3 uSun;
uniform float uStars;
uniform float uGain;
uniform vec3 uGround;
uniform vec4 uSea;
varying vec3 vDir;
${SKY_HAZE_GLSL}
${SEA_EDGE_GLSL}
${SEA_SHADE_GLSL}
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
  float seaShade = 0.0;
  float up = clamp( d.y, 0.0, 1.0 );
  float f = 1.0 - up <= 1e-7 ? 0.0 : clamp( pow( 1.0 - up, uFalloff ), 0.0, 1.0 );
  vec3 zenith = uZenith + uStars * 0.5 * ballestStars( d );
  #ifdef BALLEST_CAPTURE
    // The stands' top edge isn't a line in the distance: a soft step, and the normal maps don't break it into specks.
    float overStands = smoothstep( ${(ARENA_RIM * 0.8).toFixed(4)}, ${(ARENA_RIM * 1.2).toFixed(4)}, d.y );
    vec3 color = mix( uGround, mix( zenith, uHorizon, f ), overStands );
    gl_FragColor = vec4( color * uGain, 1.0 );
    #include <tonemapping_fragment>
  #else
    gl_FragColor = vec4( zenith * uGain, 1.0 );
    #include <tonemapping_fragment>
    // The shown horizon is already past tone mapping. From the exact direction, not the faceted mesh.
    vec3 sky = mix( gl_FragColor.rgb, uShownHorizon, f );
    sky += uSun * clamp( 1.0 - abs( dot( d, uToSun ) - 1.0 ) / ${SUN_RADIUS.toFixed(6)}, 0.0, 1.0 );
    float skyAlpha = ballestSkyHaze( d );
    // The sea from where the ray meets its surface, once that's past the sheet; a ray at or above the horizon meets it
    // far beyond, so the sea runs on behind the sky's fade. Under the surface, no sea.
    float aboveSea = cameraPosition.y - ${SEA_POSITION.y.toFixed(5)};
    vec2 onSea = ( cameraPosition + d * ( aboveSea / max( -d.y, 1e-6 ) ) ).xz - ${SEA_CENTRE_GLSL};
    // Where the sheet is fading it still tints what's under it, so the sea comes in by what makes the two add up to the sea.
    float edge = ballestSeaEdge( onSea );
    float seaAlpha = aboveSea > 0.0 && uSea.a > 0.0 ? edge / ( 1.0 - uSea.a * ( 1.0 - edge ) ) : 0.0;
    // The sky over the sea.
    float alpha = skyAlpha + seaAlpha * ( 1.0 - skyAlpha );
    if ( alpha <= 0.0 ) discard;
    float seaShare = seaAlpha * ( 1.0 - skyAlpha );
    gl_FragColor = vec4( ( sky * skyAlpha + uSea.rgb * seaShare ) / alpha, alpha );
    seaShade = ballestSeaShade( onSea + ${SEA_CENTRE_GLSL} ) * seaShare / alpha;
  #endif
  #include <colorspace_fragment>
  #ifndef BALLEST_CAPTURE
    gl_FragColor.rgb += seaShade;
    // Triangular dither of about one 8-bit step on the colour and the fade, so the long, slow
    // gradients (the fade onto the background, the horizon) don't band.
    vec2 p = gl_FragCoord.xy;
    float dither = ballestHash( p ) + ballestHash( p + 17.31 ) - 1.0;
    gl_FragColor.rgb += dither / 255.0;
    gl_FragColor.a = clamp( gl_FragColor.a + dither / 255.0, 0.0, 1.0 );
  #endif
}
`

export type SkyKind = "dome" | "capture"

const shownGain = SKY_GAIN * SKY_EXPOSURE
const skyGain: Readonly<Record<SkyKind, number>> = { dome: shownGain, capture: SKY_GAIN }

const SKY_DEFINES: Readonly<Record<SkyKind, Record<string, string>>> = {
  dome: {},
  capture: { BALLEST_CAPTURE: "" }
}

const skyUniforms = (kind: SkyKind) => ({
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uShownHorizon: { value: new THREE.Color() },
  uFalloff: { value: 3 },
  uToSun: { value: new THREE.Vector3(0, 1, 0) },
  uSun: { value: new THREE.Color() },
  uStars: { value: 0 },
  uGain: { value: skyGain[kind] },
  uGround: { value: new THREE.Color() },
  uSea: SEA_SHOWN,
  uSeaRelief: SEA_RELIEF
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
      defines: SKY_DEFINES[kind],
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
  u.uShownHorizon.value.setRGB(...sky.shownHorizon, THREE.LinearSRGBColorSpace)
  u.uFalloff.value = sky.horizonFalloff
  const toSun = ueToThreeVector(sky.toSun)
  u.uToSun.value.set(toSun.x, toSun.y, toSun.z).normalize()
  u.uSun.value.setRGB(sky.sunBrightness, sky.sunBrightness, sky.sunBrightness, THREE.LinearSRGBColorSpace)
  u.uStars.value = sky.stars
  u.uGround.value.setRGB(...ground, THREE.LinearSRGBColorSpace)
}
