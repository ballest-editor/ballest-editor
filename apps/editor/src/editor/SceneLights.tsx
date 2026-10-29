import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { useShallow } from "zustand/react/shallow"
import { toTuple3, ueToThreeVector } from "../domain/coords"
import { type Sky, skyIrradiance, skyOf } from "../domain/sky"
import { sunOf } from "../domain/sunlight"
import { setSky, SKY_DOME_RADIUS, SkyMaterial } from "./sky"
import { shownLighting, useEditor } from "./store"
import { setWaterLight } from "./water"

/** The studio rig: fill lights and a fixed sun. */
const AMBIENT = 0.6
const HEMISPHERE = 0.8
const SKY_COLOR = "#dfe8ff"
const GROUND_COLOR = "#30302a"
const STUDIO_SUN: readonly [number, number, number] = [3000, 8000, 2000]
const STUDIO_SUN_INTENSITY = 1.6
/** Light the studio fills send onto an up-facing surface (the sky colour's luminance is about 0.8). */
const STUDIO_FILL = AMBIENT + HEMISPHERE * 0.8
/** three.js intensity per unit of the game's sun brightness: the map's sun at the default 12 matches the studio sun. */
const SUN_PER_BRIGHTNESS = STUDIO_SUN_INTENSITY / 12
/** How far out the sun sits (cm); a directional light only uses the direction. */
const SUN_DISTANCE = 10_000
/**
 * The capture's ground, as a fraction of the sky's light: the game's sky light treats the lower
 * hemisphere as black and lets its global illumination light undersides from the water and
 * stands; a dim ground stands in for that bounce.
 */
const GROUND_BOUNCE = 0.35

const UP = { x: 0, y: 0, z: 1 }

/** Light reaching an up-facing surface: the fill, plus the sun by how high it stands. */
const upwardLight = (fill: number, sunIntensity: number, sunHeight: number) =>
  fill + sunIntensity * Math.max(0, sunHeight)

const STUDIO_UPWARD_LIGHT = upwardLight(STUDIO_FILL, STUDIO_SUN_INTENSITY, STUDIO_SUN[1] / Math.hypot(...STUDIO_SUN))

/**
 * The viewport's sky and lights, each its own setting. The sky is the game's, drawn around
 * the camera with the sun disc in it, down to the grid's height (below it, and when the sky
 * is hidden, the theme's background shows). Map lighting
 * lights the scene the game's way: the sun as a directional light and the sky light as an
 * environment map captured from that sky (as the game's sky light is, whether or not the sky
 * is shown), so every material, the shader-patched game materials included, is lit and
 * reflects it through three's own light loop. Otherwise fixed studio lights. The unlit water
 * is dimmed to match.
 */
export function SceneLights() {
  const mapLighting = useEditor((s) => s.settings.lighting.mapLighting)
  const skyVisible = useEditor((s) => s.settings.lighting.skyVisible)
  return (
    <>
      {skyVisible && <MapSky />}
      {mapLighting ? <MapLights /> : <StudioLights />}
    </>
  )
}

/** The map's sun and the sky the game draws for it, following the lighting controls live. */
const useMapSun = () => {
  const lighting = useEditor(useShallow(shownLighting))
  const sun = useMemo(() => sunOf(lighting), [lighting])
  const sky = useMemo(() => skyOf(sun, lighting.timeOfDay), [sun, lighting.timeOfDay])
  return { sun, sky }
}

function MapSky() {
  const { sky } = useMapSun()
  const floorHeight = useEditor((s) => s.floorHeight)
  return <SkyDome sky={sky} clipBelow={floorHeight} />
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
  const { sun, sky } = useMapSun()
  const sunIntensity = sun.intensity * SUN_PER_BRIGHTNESS
  const { x, y, z } = sun.toSun
  const position = toTuple3(ueToThreeVector({ x: x * SUN_DISTANCE, y: y * SUN_DISTANCE, z: z * SUN_DISTANCE }))
  const color = useMemo(() => new THREE.Color().setRGB(...sun.color, THREE.LinearSRGBColorSpace), [sun])
  // The game's sky light (1-3 by the time of day), at the studio fill's strength at noon.
  const fill = (STUDIO_FILL * sun.skyIntensity) / 3
  useEffect(
    () => setWaterLight(Math.min(1, upwardLight(fill, sunIntensity, z) / STUDIO_UPWARD_LIGHT)),
    [fill, sunIntensity, z]
  )
  return (
    <>
      <SkyLight sky={sky} fill={fill} />
      <directionalLight position={position} color={color} intensity={sunIntensity} />
    </>
  )
}

/**
 * The visible sky: a sphere that travels with the camera, drawn before everything else, and
 * cut off below the grid's height so the theme's background shows under the grid. (The sky
 * light is captured separately, so the cut doesn't change how pieces are lit.)
 */
function SkyDome({ sky, clipBelow }: { readonly sky: Sky; readonly clipBelow: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useMemo(() => new SkyMaterial(false), [])
  const geometry = useMemo(() => new THREE.SphereGeometry(SKY_DOME_RADIUS, 64, 32), [])
  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])
  useEffect(() => setSky(material, sky, 0), [material, sky])
  useEffect(() => {
    material.sky.uClipY.value = clipBelow
  }, [material, clipBelow])
  useFrame(({ camera }) => void mesh.current?.position.copy(camera.position))
  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} />
}

/**
 * The sky light: the sky (without the sun, which is the directional light) captured into a
 * prefiltered environment map, at `fill` on an up-facing surface whatever the sky's own colours.
 */
function SkyLight({ sky, fill }: { readonly sky: Sky; readonly fill: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const capture = useMemo(() => {
    const material = new SkyMaterial(true)
    const geometry = new THREE.SphereGeometry(10, 32, 16)
    const captureScene = new THREE.Scene()
    captureScene.add(new THREE.Mesh(geometry, material))
    return { material, geometry, scene: captureScene, pmrem: new THREE.PMREMGenerator(gl) }
  }, [gl])
  useEffect(() => () => {
    capture.pmrem.dispose()
    capture.material.dispose()
    capture.geometry.dispose()
  }, [capture])
  // Captured inside the frame loop, at most once a frame however fast the lighting changes, and
  // again when the canvas is resized: a capture taken at the canvas's initial size (before the
  // viewport has measured itself) leaves the scene drawing wrongly once it is resized.
  const captured = useRef<
    { readonly sky: Sky; readonly fill: number; readonly width: number; readonly height: number } | null
  >(null)
  const target = useRef<THREE.WebGLRenderTarget | null>(null)
  useFrame(() => {
    const width = gl.domElement.width
    const height = gl.domElement.height
    const last = captured.current
    if (last?.sky === sky && last.fill === fill && last.width === width && last.height === height) return
    captured.current = { sky, fill, width, height }
    const ground = skyIrradiance(sky, UP, 0) * GROUND_BOUNCE
    const irradiance = skyIrradiance(sky, UP, ground)
    setSky(capture.material, sky, ground)
    target.current?.dispose()
    target.current = capture.pmrem.fromScene(capture.scene, 0, 0.1, 100)
    scene.environment = target.current.texture
    // three shades ambient and hemisphere light through BRDF_Lambert (albedo / pi) but an
    // environment of radiance L at L * albedo, hence the pi.
    scene.environmentIntensity = irradiance > 0 ? fill / Math.PI / irradiance : 0
  })
  useEffect(() => () => {
    scene.environment = null
    target.current?.dispose()
    target.current = null
  }, [scene])
  return null
}
