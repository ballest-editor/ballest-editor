import { useGLTF } from "@react-three/drei"
import type { ThreeElements } from "@react-three/fiber"
import {
  Component,
  memo,
  type ReactNode,
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef
} from "react"
import * as THREE from "three"
import { type Bounds, type CatalogIndex, DEFAULT_BOUNDS, type MeshInfo } from "../domain/Catalog"
import {
  fromTuple3,
  toTuple3,
  type Tuple3,
  UE_TO_THREE_MATRIX,
  ueBoundsToScene,
  ueToScene,
  ueToThreeVector
} from "../domain/coords"
import { DECAL_VISUAL_SCALE, editTransform, isDecal } from "../domain/editTransform"
import type { Item } from "../domain/MapFile"
import { mirrorScaleOf } from "../domain/mirror"
import { isShown } from "../domain/visibility"
import { LaserBeam } from "./LaserBeam"
import { applySlotMaterials } from "./materials"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"
import { glbUrl, type Visual, VISUAL_KEY, visualsOf } from "./visuals"
import { fixSceneWinding } from "./winding"

const ueToThree = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)

/**
 * Items sit still, and a map of thousands has tens of thousands of objects: left to three, each works out its matrix
 * again every frame, which costs a third of a large map's frame. So everything an item is made of works its matrix out
 * when it changes, and so does everything above it: one object updating its matrix updates all that's under it. The
 * gizmo moves an item ahead of React (`applyToObject`) and does the same.
 */
function FixedGroup(
  { ref, ...props }: Omit<ThreeElements["group"], "ref"> & { readonly ref?: RefObject<THREE.Group | null> }
) {
  const own = useRef<THREE.Group>(null)
  const group = ref ?? own
  useLayoutEffect(() => group.current?.updateMatrix())
  return <group ref={group} matrixAutoUpdate={false} {...props} />
}

/** Box dimensions for a bounds size: never flat, so the stand-in stays visible. */
const solid = (n: number) => Math.max(Math.abs(n), 1)
const boxSize = ([x, y, z]: Tuple3): [number, number, number] => [solid(x), solid(y), solid(z)]

/**
 * While a glb loads: a faint wireframe of its local bounds (nothing if bounds are unknown).
 * Never a solid box; that's reserved for failed loads and pieces with no mesh.
 */
function LoadingHint({ bounds }: { readonly bounds: Bounds | undefined }) {
  const edges = useMemo(() => {
    if (bounds === undefined) return null
    const { size } = ueBoundsToScene(bounds.min, bounds.max)
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(...boxSize(size)))
  }, [bounds])
  useEffect(() => () => edges?.dispose(), [edges])
  if (bounds === undefined || edges === null) return null
  const { center } = ueBoundsToScene(bounds.min, bounds.max)
  return (
    <lineSegments position={center} geometry={edges} raycast={() => {}}>
      <lineBasicMaterial color="#8b93a1" transparent opacity={0.25} depthWrite={false} />
    </lineSegments>
  )
}

/** Solid stand-in for a mesh that failed to load or that the catalog doesn't know. */
function BoundsBox(
  { bounds, warn, visualKey }: {
    readonly bounds: Bounds | undefined
    readonly warn: boolean
    readonly visualKey?: string
  }
) {
  const b = bounds ?? DEFAULT_BOUNDS
  const { size, center } = ueBoundsToScene(b.min, b.max)
  return (
    <mesh position={center} userData={visualKey === undefined ? {} : { [VISUAL_KEY]: visualKey }}>
      <boxGeometry args={boxSize(size)} />
      <meshStandardMaterial color={warn ? "#c9803a" : "#8b93a1"} roughness={0.8} />
    </mesh>
  )
}

/** A glb in UE local space, re-expressed in the scene frame by the UE -> three matrix. */
function GlbMesh(
  { url, slotMaterials, visualKey }: {
    readonly url: string
    readonly slotMaterials: ReadonlyArray<string | undefined>
    readonly visualKey: string
  }
) {
  const gltf = useGLTF(url)
  const table = useEditor((s) => s.materialTable)
  const object = useMemo(() => {
    const root = new THREE.Group()
    root.matrixAutoUpdate = false
    root.matrix.copy(ueToThree)
    root.matrixWorldNeedsUpdate = true
    fixSceneWinding(gltf.scene) // once per cached glb; clones share the geometry
    const scene = gltf.scene.clone(true)
    scene.traverse((node) => {
      node.updateMatrix()
      node.matrixAutoUpdate = false
    })
    root.add(scene)
    return root
  }, [gltf])
  useLayoutEffect(() => applySlotMaterials(object, table, slotMaterials), [object, table, slotMaterials])
  useLayoutEffect(() => {
    object.userData[VISUAL_KEY] = visualKey
  }, [object, visualKey])
  return <primitive object={object} />
}

class GlbBoundary extends Component<
  { readonly url: string; readonly fallback: ReactNode; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: unknown) {
    console.warn(`Couldn't load ${this.props.url}; drawing its catalog bounds instead.`, error)
    useEditor.getState().reportMissingGlb(this.props.url)
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** One of an item's visuals, tagged with its key (`VISUAL_KEY`) for the paint tool's hits. */
function MeshVisual(
  { mesh, slotMaterials, visualKey }: {
    readonly mesh: MeshInfo | undefined
    readonly slotMaterials: ReadonlyArray<string | undefined>
    readonly visualKey: string
  }
) {
  const url = glbUrl(mesh?.glb)
  const box = <BoundsBox bounds={mesh?.bounds} warn visualKey={visualKey} />
  if (url === undefined) return box
  return (
    <GlbBoundary url={url} fallback={box}>
      <Suspense fallback={<LoadingHint bounds={mesh?.bounds} />}>
        <GlbMesh url={url} slotMaterials={slotMaterials} visualKey={visualKey} />
      </Suspense>
    </GlbBoundary>
  )
}

export const ItemObject = memo(function ItemObjectView(props: {
  readonly id: string
  readonly item: Item
  readonly index: CatalogIndex | null
}) {
  const { id, item, index } = props
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const object = ref.current
    if (object === null) return
    sceneRegistry.objects.set(id, object)
    return () => {
      if (sceneRegistry.objects.get(id) === object) sceneRegistry.objects.delete(id)
    }
  }, [id])

  // A continuous interaction (gizmo drag, inspector scrub) shows here before it commits.
  const live = useEditor((s) => s.preview?.get(id))
  // hidden, or left out by an isolation: still in the scene, so it keeps its place for the gizmo and its group's box
  const shown = useEditor((s) => isShown(s.doc.structure, s.isolation, id))
  const itemTransform = live ?? editTransform(item)
  const transform = useMemo(() => ueToScene(itemTransform), [itemTransform])
  const surfaces = useEditor((s) => s.surfaces)
  const visuals = useMemo(() => visualsOf(item, index, surfaces), [item, index, surfaces])
  // Mirror X / Y: the source mesh scaled by -1 along the item's local axes (UE scale in the scene frame).
  const mirror = useMemo(() => {
    const scale = mirrorScaleOf(item, index)
    return scale === undefined ? undefined : toTuple3(ueToThreeVector(fromTuple3(scale)))
  }, [item, index])
  // A decal's scale is its size in cm, so its mesh is drawn as a unit.
  const visualScale = useMemo(() => {
    if (!isDecal(item)) return mirror
    const [x, y, z] = mirror ?? [1, 1, 1]
    return [x * DECAL_VISUAL_SCALE, y * DECAL_VISUAL_SCALE, z * DECAL_VISUAL_SCALE] as const
  }, [item, mirror])
  const beam = index?.pieceByClass.get(item.actorToSpawn)?.beam

  return (
    <FixedGroup
      ref={ref}
      userData={{ itemId: id }}
      visible={shown}
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
    >
      <FixedGroup {...(visualScale === undefined ? {} : { scale: visualScale })}>
        <ItemVisuals visuals={visuals} />
        {beam !== undefined && <LaserBeam beam={beam} itemId={id} />}
      </FixedGroup>
    </FixedGroup>
  )
})

function ItemVisuals({ visuals }: { readonly visuals: ReadonlyArray<Visual> }) {
  return (
    <>
      {visuals.length === 0 && <BoundsBox bounds={undefined} warn />}
      {visuals.map((v) =>
        v.relative === undefined
          ? <MeshVisual key={v.key} mesh={v.mesh} slotMaterials={v.slotMaterials} visualKey={v.key} />
          : (
            <FixedGroup
              key={v.key}
              position={v.relative.position}
              quaternion={v.relative.quaternion}
              scale={v.relative.scale}
            >
              <MeshVisual mesh={v.mesh} slotMaterials={v.slotMaterials} visualKey={v.key} />
            </FixedGroup>
          )
      )}
    </>
  )
}
