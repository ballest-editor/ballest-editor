/**
 * A laser's beam (catalog `beam`). The game builds it in native code along a trace from the
 * terminal's muzzle: a thin core inside a wider glow, ending at the first thing in its way.
 * Here the same trace runs against the other items' meshes a few times a second, so the beam
 * follows the map as it is edited. The beam itself takes no clicks and stops no other beam.
 */
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import type { Beam } from "../domain/Catalog"
import { UE_TO_THREE_MATRIX } from "../domain/coords"
import { sceneRegistry } from "./sceneRegistry"
import { isMesh } from "./threeGuards"

/** How far a beam with nothing in its way reaches (cm). The game's sweep limit is native; this is a stand-in. */
export const BEAM_REACH = 10_000

/** Seconds between traces: often enough to follow a drag, cheap on maps with thousands of items. */
const TRACE_INTERVAL = 0.25

const GLOW_OPACITY = 0.25

const ueToThree = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)

/** A unit cylinder from x = 0 to x = 1 (UE local), radius 1, open at the ends. */
const unitBeam = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).rotateZ(-Math.PI / 2).translate(0.5, 0, 0)

const noRaycast = () => {}

/** The item id an object belongs to (its nearest ancestor that carries one). */
const itemIdOf = (object: THREE.Object3D): unknown => {
  let o: THREE.Object3D | null = object
  while (o !== null && o.userData["itemId"] === undefined) o = o.parent
  return o?.userData["itemId"]
}

const raycaster = new THREE.Raycaster()
const from = new THREE.Vector3()
const ahead = new THREE.Vector3()
const direction = new THREE.Vector3()

/**
 * The distance (scene units, cm) from `origin` along `dir` to the first mesh of another item,
 * or `reach` when there is none.
 */
export const traceBeam = (
  root: THREE.Object3D,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  ownId: string,
  reach: number
): number => {
  raycaster.set(origin, dir)
  raycaster.far = reach
  for (const hit of raycaster.intersectObject(root, true)) {
    if (isMesh(hit.object) && itemIdOf(hit.object) !== ownId) return hit.distance
  }
  return reach
}

export function LaserBeam({ beam, itemId }: { readonly beam: Beam; readonly itemId: string }) {
  const frame = useRef<THREE.Group>(null)
  const span = useRef<THREE.Group>(null)
  const elapsed = useRef(TRACE_INTERVAL)
  const [core, glow] = useMemo(() => {
    const color = new THREE.Color().setRGB(...beam.color, THREE.LinearSRGBColorSpace)
    return [
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: GLOW_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    ]
  }, [beam.color])
  useEffect(() => () => {
    core.dispose()
    glow.dispose()
  }, [core, glow])
  const orientation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...beam.axis)),
    [beam.axis]
  )

  useFrame((_, delta) => {
    elapsed.current += delta
    const root = sceneRegistry.itemsRoot
    if (elapsed.current < TRACE_INTERVAL || frame.current === null || span.current === null || root === null) return
    elapsed.current = 0
    // The muzzle and one unit along the beam, in the scene: the item's scale stretches the second.
    from.set(...beam.muzzle)
    frame.current.localToWorld(from)
    ahead.set(...beam.axis).add(direction.set(...beam.muzzle))
    frame.current.localToWorld(ahead)
    direction.subVectors(ahead, from)
    const perUnit = direction.length()
    if (perUnit === 0) return
    const length = traceBeam(root, from, direction.normalize(), itemId, BEAM_REACH) / perUnit
    span.current.scale.x = length
  })

  return (
    <group ref={frame} matrixAutoUpdate={false} matrix={ueToThree}>
      <group position={beam.muzzle} quaternion={orientation}>
        <group ref={span} scale={[0, 1, 1]}>
          <mesh geometry={unitBeam} material={core} scale={[1, beam.coreRadius, beam.coreRadius]} raycast={noRaycast} />
          <mesh geometry={unitBeam} material={glow} scale={[1, beam.glowRadius, beam.glowRadius]} raycast={noRaycast} />
        </group>
      </group>
    </group>
  )
}
