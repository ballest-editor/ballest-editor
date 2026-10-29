/**
 * Materials for the level's water sheet (domain/level `WATER`). The game's water is
 * opaque; here it is translucent so pieces under it stay visible, with a different look
 * from each side.
 */
import * as THREE from "three"

const WATER_COLOR = "#2f7fb8"

/** From above: an even translucent sheet, so pieces below it show tinted. */
export const waterTopMaterial = new THREE.MeshBasicMaterial({
  color: WATER_COLOR,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.FrontSide
})

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
waterUnderMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = `varying vec3 vWaterWorld;\n${shader.vertexShader}`.replace(
    "#include <project_vertex>",
    "#include <project_vertex>\n  vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
  )
  shader.fragmentShader = `varying vec3 vWaterWorld;\n${shader.fragmentShader}`.replace(
    "#include <opaque_fragment>",
    `float facing = abs(normalize(cameraPosition - vWaterWorld).y); // 1 straight up, 0 at the horizon
  diffuseColor.a *= mix(1.0, ${UNDER_CLEAR}, sqrt(facing));
  #include <opaque_fragment>`
  )
}

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
