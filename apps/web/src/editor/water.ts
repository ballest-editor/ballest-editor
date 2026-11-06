/**
 * Materials for the level's water sheet (domain/level `WATER`). The game's water is
 * opaque; here it is translucent so pieces under it stay visible, with a different look
 * from each side. Both sides thin out with distance, so the far water meets whatever is
 * behind it (the sky's haze, or the clear colour with the sky off) instead of ending at the
 * sheet's edge.
 */
import * as THREE from "three"
import { SKY_DOME_RADIUS } from "./sky"

const WATER_COLOR = "#2f7fb8"

/** Where the water starts to thin out (cm from the camera, along the surface) and where it has gone, with the grid. */
const FADE_START = 8_000
const FADE_END = SKY_DOME_RADIUS

/** `shader`'s output thinned by distance; an orthographic pane has none. `extra` is GLSL run after, with `vWaterWorld`. */
export const addDistanceFade = <S extends { readonly vertexShader: string; readonly fragmentShader: string }>(
  shader: S,
  extra = ""
): S => ({
  ...shader,
  vertexShader: `varying vec3 vWaterWorld;\n${shader.vertexShader}`.replace(
    "#include <project_vertex>",
    "#include <project_vertex>\n  vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
  ),
  fragmentShader: `varying vec3 vWaterWorld;\n${shader.fragmentShader}`.replace(
    "#include <opaque_fragment>",
    `if (!isOrthographic) {
    float away = distance(cameraPosition.xz, vWaterWorld.xz);
    diffuseColor.a *= 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, away);
  }
  ${extra}
  #include <opaque_fragment>`
  )
})

const fadeWithDistance = (material: THREE.Material, extra?: string): void => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader, addDistanceFade(shader, extra))
  }
}

/** From above: an even translucent sheet, so pieces below it show tinted. */
export const waterTopMaterial = new THREE.MeshBasicMaterial({
  color: WATER_COLOR,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.FrontSide
})
fadeWithDistance(waterTopMaterial)

/** From below, looking straight up: the fraction of the full opacity left. */
const UNDER_CLEAR = 0.08

/**
 * From below: nearly clear looking straight up, more solid toward the horizon, the way a
 * water surface looks from under it. An even sheet here would fill the whole view and
 * wash everything out.
 */
export const waterUnderMaterial = new THREE.MeshBasicMaterial({
  color: WATER_COLOR,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  side: THREE.BackSide
})
fadeWithDistance(
  waterUnderMaterial,
  `float facing = abs(normalize(cameraPosition - vWaterWorld).y); // 1 straight up, 0 at the horizon
  diffuseColor.a *= mix(1.0, ${UNDER_CLEAR}, sqrt(facing));`
)

const waterColor = new THREE.Color(WATER_COLOR)

/**
 * The water is unlit, so the scene's lights don't reach it. `level` (0-1) dims it the way
 * the lights dim an up-facing surface: 1 under the studio lights, less at dusk or night.
 */
export const setWaterLight = (level: number): void => {
  for (const material of [waterTopMaterial, waterUnderMaterial]) {
    material.color.copy(waterColor).multiplyScalar(level)
  }
}
