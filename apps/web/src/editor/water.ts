/**
 * Materials for the level's water sheet (domain/level `WATER`). The game's water is
 * opaque; here it is translucent so pieces under it stay visible, with a different look
 * from each side. From above it thins out exactly as the sky's haze comes in, so the far
 * water runs straight into the horizon with no clear colour between them, and it is gone
 * before the sheet's edge. From below it thins out with distance.
 */
import * as THREE from "three"
import { WATER } from "../domain/level"
import { SKY_DOME_RADIUS, SKY_HAZE_BELOW, SKY_HAZE_GLSL } from "./sky"

/**
 * Per theme, because the water has to sit with the chrome as well as the map. These are what reaches the screen (the
 * water skips tone mapping, which would clip the red to 0 and leave it fully saturated). Dark is deep and muted, so the
 * pieces pop against it; light goes on thicker, so a pale piece's side faces stand off it.
 */
export const WATER_LOOKS = {
  dark: { color: "#0e4a64", opacity: 0.35 },
  light: { color: "#006aac", opacity: 0.42 }
} as const

/** From below: where the water starts to thin out (cm from the camera, along the surface) and where it has gone. */
const FADE_START = 8_000
const FADE_END = SKY_DOME_RADIUS

/** From above: where the sheet starts to give out (cm from its centre, on either axis) and its edge. */
const EDGE_END = WATER.size / 2
const EDGE_START = EDGE_END * 0.8

/** A camera under the floor has no haze below the horizon, so it measures from its own height: the water still thins out. */
export const THIN_INTO_SKY = `vec3 toWater = normalize(vWaterWorld - cameraPosition);
    diffuseColor.a *= 1.0 - ballestSkyHaze(toWater, min(uClipY, cameraPosition.y), uHazeBelow);
    float fromCentre = max(abs(vWaterLocal.x), abs(vWaterLocal.y));
    diffuseColor.a *= 1.0 - smoothstep(${EDGE_START.toFixed(1)}, ${EDGE_END.toFixed(1)}, fromCentre);`

export const THIN_WITH_DISTANCE = `float away = distance(cameraPosition.xz, vWaterWorld.xz);
    diffuseColor.a *= 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, away);`

/** `shader`'s output thinned by the GLSL `fade`; an orthographic pane has none. `extra` is GLSL run after, in any pane. */
export const addFade = <S extends { readonly vertexShader: string; readonly fragmentShader: string }>(
  shader: S,
  fade: string,
  extra = ""
): S => ({
  ...shader,
  vertexShader: `varying vec3 vWaterWorld;\nvarying vec2 vWaterLocal;\n${shader.vertexShader}`.replace(
    "#include <project_vertex>",
    `#include <project_vertex>
  vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWaterLocal = transformed.xy;`
  ),
  fragmentShader:
    `varying vec3 vWaterWorld;\nvarying vec2 vWaterLocal;\nuniform float uClipY;\nuniform float uHazeBelow;\n${SKY_HAZE_GLSL}\n${shader.fragmentShader}`
      .replace(
        "#include <opaque_fragment>",
        `if (!isOrthographic) {
    ${fade}
  }
  ${extra}
  #include <opaque_fragment>`
      )
})

/** What the sky's haze is measured from: the floor's height and how far below it the haze reaches. */
export const waterHaze = { uClipY: { value: 0 }, uHazeBelow: { value: SKY_HAZE_BELOW.dark } }

const thinOut = (material: THREE.Material, fade: string, extra?: string): void => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader, addFade(shader, fade, extra))
    Object.assign(shader.uniforms, waterHaze)
  }
}

/** From above: an even translucent sheet, so pieces below it show tinted. */
export const waterTopMaterial = new THREE.MeshBasicMaterial({
  color: WATER_LOOKS.dark.color,
  transparent: true,
  opacity: WATER_LOOKS.dark.opacity,
  depthWrite: false,
  side: THREE.FrontSide,
  toneMapped: false
})
thinOut(waterTopMaterial, THIN_INTO_SKY)

/** From below, looking straight up: the fraction of the full opacity left. */
const UNDER_CLEAR = 0.08

/**
 * From below: nearly clear looking straight up, more solid toward the horizon, the way a
 * water surface looks from under it. An even sheet here would fill the whole view and
 * wash everything out.
 */
export const waterUnderMaterial = new THREE.MeshBasicMaterial({
  color: WATER_LOOKS.dark.color,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  side: THREE.BackSide,
  toneMapped: false
})
thinOut(
  waterUnderMaterial,
  THIN_WITH_DISTANCE,
  `float facing = abs(normalize(cameraPosition - vWaterWorld).y); // 1 straight up, 0 at the horizon
  diffuseColor.a *= mix(1.0, ${UNDER_CLEAR}, sqrt(facing));`
)

const waterColor = new THREE.Color(WATER_LOOKS.dark.color)
let waterLight = 1

const applyWaterColor = (): void => {
  for (const material of [waterTopMaterial, waterUnderMaterial]) {
    material.color.copy(waterColor).multiplyScalar(waterLight)
  }
}

/** Gives the water `theme`'s look, keeping the light it is under. */
export const setWaterTheme = (theme: keyof typeof WATER_LOOKS): void => {
  const { color, opacity } = WATER_LOOKS[theme]
  waterColor.set(color)
  waterTopMaterial.opacity = opacity
  waterHaze.uHazeBelow.value = SKY_HAZE_BELOW[theme]
  applyWaterColor()
}

/** The floor the sky's haze is measured from, so the water thins out with it. */
export const setWaterFloor = (height: number): void => {
  waterHaze.uClipY.value = height
}

/**
 * The water is unlit, so the scene's lights don't reach it. `level` (0-1) dims it the way
 * the lights dim an up-facing surface: 1 under the studio lights, less at dusk or night.
 */
export const setWaterLight = (level: number): void => {
  waterLight = level
  applyWaterColor()
}
