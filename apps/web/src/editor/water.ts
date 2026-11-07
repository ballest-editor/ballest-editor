/**
 * Materials for the level's water sheet (domain/level `WATER`). The game's water is
 * opaque; here it is translucent so pieces under it stay visible, with a different look
 * from each side. From above it thins out exactly as the sky comes in at the horizon, and
 * is gone before the sheet's edge, where the dome carries the sea on to the horizon (sky.ts).
 * From below it thins out with distance.
 */
import * as THREE from "three"
import { SCENE_COLORS } from "../domain/sceneGround"
import { SEA_EDGE_GLSL, SEA_RELIEF, SEA_SHADE_GLSL, SEA_SHOWN, SKY_DOME_RADIUS, SKY_HAZE_GLSL } from "./sky"

/**
 * Per theme, because the water has to sit with the chrome as well as the map. These are what reaches the screen (the
 * water skips tone mapping, which would clip the red to 0 and leave it fully saturated). Dark is deep and muted, so the
 * pieces pop against it; light goes on thicker, so a pale piece's side faces stand off it. `relief` is how strongly the
 * surface shows (sky.ts), lower in light for the same reason.
 */
export const WATER_LOOKS = {
  dark: { color: "#0e4a64", opacity: 0.35, relief: 0.56 },
  light: { color: "#006aac", opacity: 0.42, relief: 0.33 }
} as const

/** From below: where the water starts to thin out (cm from the camera, along the surface) and where it has gone. */
const FADE_START = 8_000
const FADE_END = SKY_DOME_RADIUS

export const THIN_INTO_SKY = `vec3 toWater = normalize(vWaterWorld - cameraPosition);
    diffuseColor.a *= 1.0 - ballestSkyHaze(toWater);
    diffuseColor.a *= 1.0 - ballestSeaEdge(vWaterLocal);`

/**
 * The sea's surface, added once the colour is encoded, because that's what the canvas blends. The dome's sea is the same
 * sum, and dividing by the opacity undoes the blend, so the two add up to one surface where the sheet gives out.
 */
export const SEA_SURFACE = `if (!isOrthographic) {
    gl_FragColor.rgb += ballestSeaShade(vWaterWorld.xz) / opacity;
  }`

export const THIN_WITH_DISTANCE = `float away = distance(cameraPosition.xz, vWaterWorld.xz);
    diffuseColor.a *= 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, away);`

/**
 * `shader`'s output thinned by the GLSL `fade`; an orthographic pane has none. `extra` is GLSL run after, in any pane, and
 * `encoded` GLSL run on the finished colour.
 */
export const addFade = <S extends { readonly vertexShader: string; readonly fragmentShader: string }>(
  shader: S,
  fade: string,
  extra = "",
  encoded = ""
): S => ({
  ...shader,
  vertexShader: `varying vec3 vWaterWorld;\nvarying vec2 vWaterLocal;\n${shader.vertexShader}`.replace(
    "#include <project_vertex>",
    `#include <project_vertex>
  vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWaterLocal = transformed.xy;`
  ),
  fragmentShader:
    `varying vec3 vWaterWorld;\nvarying vec2 vWaterLocal;\n${SKY_HAZE_GLSL}\n${SEA_EDGE_GLSL}\n${SEA_SHADE_GLSL}\n${shader.fragmentShader}`
      .replace(
        "#include <opaque_fragment>",
        `if (!isOrthographic) {
    ${fade}
  }
  ${extra}
  #include <opaque_fragment>`
      )
      .replace("#include <colorspace_fragment>", `#include <colorspace_fragment>\n  ${encoded}`)
})

const thinOut = (material: THREE.Material, fade: string, extra?: string, encoded?: string): void => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader, addFade(shader, fade, extra, encoded))
    Object.assign(shader.uniforms, { uSeaRelief: SEA_RELIEF })
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
thinOut(waterTopMaterial, THIN_INTO_SKY, undefined, SEA_SURFACE)

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

const encoded = (color: THREE.Color): THREE.Color => color.clone().convertLinearToSRGB()

/** What decides how the water looks. */
const water = { theme: "dark" as keyof typeof WATER_LOOKS, light: 1, shown: true }

const updateWater = (change: Partial<typeof water>): void => {
  Object.assign(water, change)
  const { color, opacity, relief } = WATER_LOOKS[water.theme]
  const lit = new THREE.Color(color).multiplyScalar(water.light)
  for (const material of [waterTopMaterial, waterUnderMaterial]) material.color.copy(lit)
  waterTopMaterial.opacity = opacity
  // The canvas blends what is already encoded, so this is the sheet over the clear colour as it reaches the screen.
  const sea = encoded(new THREE.Color(SCENE_COLORS[water.theme])).lerp(encoded(lit), opacity).convertSRGBToLinear()
  SEA_SHOWN.value.set(sea.r, sea.g, sea.b, water.shown ? opacity : 0)
  SEA_RELIEF.value = relief * water.light
}

/** Gives the water `theme`'s look, keeping the light it is under. */
export const setWaterTheme = (theme: keyof typeof WATER_LOOKS): void => updateWater({ theme })

/** Whether the dome carries the sea on past the sheet: only while the sheet is showing. */
export const setWaterShown = (shown: boolean): void => updateWater({ shown })

/**
 * The water is unlit, so the scene's lights don't reach it. `light` (0-1) dims it the way
 * the lights dim an up-facing surface: 1 under the studio lights, less at dusk or night.
 */
export const setWaterLight = (light: number): void => updateWater({ light })
