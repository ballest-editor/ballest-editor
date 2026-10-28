import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { useShallow } from "zustand/react/shallow"
import { toTuple3, ueToThreeVector } from "../domain/coords"
import { sunOf } from "../domain/sunlight"
import { shownLighting, useEditor } from "./store"
import { setWaterLight } from "./water"

/** Fill lights at full sky light (the game's 3, at noon); the studio rig uses these too. */
const AMBIENT = 0.6
const HEMISPHERE = 0.8
const SKY_COLOR = "#dfe8ff"
const GROUND_COLOR = "#30302a"
/** The studio rig's sun, and its intensity: the map's sun at the default brightness 12 matches it. */
const STUDIO_SUN: readonly [number, number, number] = [3000, 8000, 2000]
const STUDIO_SUN_INTENSITY = 1.6
/** three.js intensity per unit of the game's sun brightness. */
const SUN_PER_BRIGHTNESS = STUDIO_SUN_INTENSITY / 12
/** How far out the sun sits (cm); a directional light only uses the direction. */
const SUN_DISTANCE = 10_000

/** Light reaching an up-facing surface: the fills, plus the sun by how high it stands. */
const upwardLight = (fill: number, sunIntensity: number, sunHeight: number) =>
  (AMBIENT + HEMISPHERE) * fill + sunIntensity * Math.max(0, sunHeight)

const STUDIO_UPWARD_LIGHT = upwardLight(
  1,
  STUDIO_SUN_INTENSITY,
  STUDIO_SUN[1] / Math.hypot(...STUDIO_SUN)
)

/**
 * The viewport's lights. With the map-lighting setting, the map's sun and sky light (see
 * domain/sunlight), following the lighting controls live; otherwise fixed studio lights.
 * Both light the game's materials through three's own light loop (the material patch only
 * changes what the surface is). The unlit water is dimmed to match.
 */
export function SceneLights() {
  const mapLighting = useEditor((s) => s.settings.appearance.mapLighting)
  return mapLighting ? <MapLights /> : <StudioLights />
}

function StudioLights() {
  useEffect(() => setWaterLight(1), [])
  return (
    <>
      <ambientLight intensity={AMBIENT} />
      <hemisphereLight color={SKY_COLOR} groundColor={GROUND_COLOR} intensity={HEMISPHERE} />
      <directionalLight position={STUDIO_SUN} intensity={STUDIO_SUN_INTENSITY} />
    </>
  )
}

function MapLights() {
  const lighting = useEditor(useShallow(shownLighting))
  const sun = useMemo(() => sunOf(lighting), [lighting])
  const fill = sun.skyIntensity / 3
  const sunIntensity = sun.intensity * SUN_PER_BRIGHTNESS
  const { x, y, z } = sun.toSun
  const position = toTuple3(ueToThreeVector({ x: x * SUN_DISTANCE, y: y * SUN_DISTANCE, z: z * SUN_DISTANCE }))
  const color = useMemo(() => new THREE.Color().setRGB(...sun.color, THREE.LinearSRGBColorSpace), [sun])
  useEffect(
    () => setWaterLight(Math.min(1, upwardLight(fill, sunIntensity, z) / STUDIO_UPWARD_LIGHT)),
    [fill, sunIntensity, z]
  )
  return (
    <>
      <ambientLight intensity={AMBIENT * fill} />
      <hemisphereLight color={SKY_COLOR} groundColor={GROUND_COLOR} intensity={HEMISPHERE * fill} />
      <directionalLight position={position} color={color} intensity={sunIntensity} />
    </>
  )
}
