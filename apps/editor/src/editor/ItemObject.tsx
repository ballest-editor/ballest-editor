import { useGLTF } from "@react-three/drei"
import { Component, memo, type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { type Bounds, type CatalogIndex, DEFAULT_BOUNDS, type MeshInfo } from "../domain/Catalog"
import { UE_TO_THREE_MATRIX, ueBoundsToScene, ueToScene } from "../domain/coords"
import type { Item } from "../domain/MapFile"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"
import { applySlotMaterials } from "./materials"
import { glbUrl, visualsOf } from "./visuals"
import { fixSceneWinding } from "./winding"

const ueToThree = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)

/**
 * While a glb loads: a faint wireframe of its local bounds (nothing if bounds are unknown).
 * Never a solid box; that's reserved for failed loads and pieces with no mesh.
 */
function LoadingHint({ bounds }: { readonly bounds: Bounds | undefined }) {
  const edges = useMemo(() => {
    if (bounds === undefined) return null
    const { size } = ueBoundsToScene(bounds.min, bounds.max)
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(...size.map((n) => Math.max(Math.abs(n), 1)) as [number, number, number]))
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
function BoundsBox({ bounds, warn }: { readonly bounds: Bounds | undefined; readonly warn: boolean }) {
  const b = bounds ?? DEFAULT_BOUNDS
  const { size, center } = ueBoundsToScene(b.min, b.max)
  return (
    <mesh position={center}>
      <boxGeometry args={size.map((n) => Math.max(Math.abs(n), 1)) as [number, number, number]} />
      <meshStandardMaterial color={warn ? "#c9803a" : "#8b93a1"} roughness={0.8} />
    </mesh>
  )
}

/** A glb in UE local space, re-expressed in the scene frame by the UE -> three matrix. */
function GlbMesh({ url, slotMaterials }: { readonly url: string; readonly slotMaterials: ReadonlyArray<string | undefined> }) {
  const gltf = useGLTF(url)
  const table = useEditor((s) => s.materialTable)
  const object = useMemo(() => {
    const root = new THREE.Group()
    root.matrixAutoUpdate = false
    root.matrix.copy(ueToThree)
    fixSceneWinding(gltf.scene) // once per cached glb; clones share the geometry
    root.add(gltf.scene.clone(true))
    return root
  }, [gltf])
  useLayoutEffect(() => applySlotMaterials(object, table, slotMaterials), [object, table, slotMaterials])
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

function MeshVisual({ mesh, slotMaterials }: { readonly mesh: MeshInfo | undefined; readonly slotMaterials: ReadonlyArray<string | undefined> }) {
  const url = glbUrl(mesh?.glb)
  if (url === undefined) return <BoundsBox bounds={mesh?.bounds} warn />
  return (
    <GlbBoundary url={url} fallback={<BoundsBox bounds={mesh?.bounds} warn />}>
      <Suspense fallback={<LoadingHint bounds={mesh?.bounds} />}>
        <GlbMesh url={url} slotMaterials={slotMaterials} />
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

  const transform = useMemo(() => ueToScene(item.itemTransform), [item.itemTransform])
  const visuals = useMemo(() => visualsOf(item, index), [item, index])

  return (
    <group
      ref={ref}
      userData={{ itemId: id }}
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
    >
      {visuals.length === 0 && <BoundsBox bounds={undefined} warn />}
      {visuals.map((v) =>
        v.relative === undefined
          ? <MeshVisual key={v.key} mesh={v.mesh} slotMaterials={v.slotMaterials} />
          : (
            <group
              key={v.key}
              position={v.relative.position}
              quaternion={v.relative.quaternion}
              scale={v.relative.scale}
            >
              <MeshVisual mesh={v.mesh} slotMaterials={v.slotMaterials} />
            </group>
          )
      )}
    </group>
  )
})
