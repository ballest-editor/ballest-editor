/**
 * A laser's beam (catalog `beam`). The game builds it in native code from the terminal's muzzle:
 * a thin core inside a wider glow, `length` cm long (stretched by the item's X scale) or shorter
 * where something is in its way. Here that trace runs against the other items' meshes a few
 * times a second, so the beam follows the map as it is edited. The beam itself takes no clicks
 * and stops no other beam.
 */
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import type { Beam } from "../domain/Catalog"
import { UE_TO_THREE_MATRIX } from "../domain/coords"
import { sceneRegistry } from "./sceneRegistry"
import { isMesh } from "./threeGuards"

/** Seconds between traces: often enough to follow a drag, cheap on maps with thousands of items. */
const TRACE_INTERVAL = 0.25

/** How far the core goes from the beam's colour towards white: the game's beam burns white at its centre. */
const CORE_HEAT = 0.85
/** The glow's strength where the view meets it head-on, and how fast it falls off towards its silhouette. */
const GLOW_STRENGTH = 0.55
const GLOW_FALLOFF = 2.5

const ueToThree = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)

/** A unit cylinder from x = 0 to x = 1 (UE local), radius 1, open at the ends. */
const unitBeam = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).rotateZ(-Math.PI / 2).translate(0.5, 0, 0)

const noRaycast = () => {}

/** The halo around the core: bright along the middle of the tube and gone at its edge, with no hard outline. */
const glowMaterial = (color: THREE.Color): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color } },
    // The log depth chunks: the viewport's depth buffer is logarithmic, and a plain depth fails against it.
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 position4 = modelViewMatrix * vec4( position, 1.0 );
        vNormal = normalMatrix * normal;
        vView = -position4.xyz;
        gl_Position = projectionMatrix * position4;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs( dot( normalize( vNormal ), normalize( vView ) ) );
        gl_FragColor = vec4( uColor, ${GLOW_STRENGTH.toFixed(2)} * pow( facing, ${GLOW_FALLOFF.toFixed(2)} ) );
        #include <colorspace_fragment>
      }
    `,
    // Both walls of the tube: the UE frame the beam sits in turns the winding over.
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  })

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
    const hot = color.clone().lerp(new THREE.Color(1, 1, 1), CORE_HEAT)
    return [new THREE.MeshBasicMaterial({ color: hot, toneMapped: false }), glowMaterial(color)]
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
    span.current.scale.x = traceBeam(root, from, direction.normalize(), itemId, beam.length * perUnit) / perUnit
  })

  return (
    <group ref={frame} matrixAutoUpdate={false} matrix={ueToThree}>
      <group position={beam.muzzle} quaternion={orientation}>
        <group ref={span} scale={[beam.length, 1, 1]}>
          <mesh geometry={unitBeam} material={core} scale={[1, beam.coreRadius, beam.coreRadius]} raycast={noRaycast} />
          <mesh geometry={unitBeam} material={glow} scale={[1, beam.glowRadius, beam.glowRadius]} raycast={noRaycast} />
        </group>
      </group>
    </group>
  )
}
