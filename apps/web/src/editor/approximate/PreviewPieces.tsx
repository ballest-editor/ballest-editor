/**
 * The pieces of an approximation in its preview: each shape's catalog mesh, drawn once per placement where the
 * prefab's item would stand. Everything here is in the game's frame.
 */
import { useGLTF } from "@react-three/drei"
import { Component, type ReactNode, Suspense, useCallback, useMemo } from "react"
import * as THREE from "three"
import { type Placement, type ShapeKind, shapeKinds, SHAPES } from "../../domain/approximate/shapes"
import { type Bounds, glbGeometry, placementMatrix, shadeOf, standInGeometry } from "./pieceGeometry"
import { PreviewInstances } from "./PreviewInstances"

/** What the preview needs of a shape's catalog piece. */
export interface PieceMesh {
  /** Where its glb is served; undefined when the catalog has none. */
  readonly url: string | undefined
  readonly bounds: Bounds
}

interface BatchProps {
  readonly bounds: Bounds
  readonly placements: ReadonlyArray<Placement>
  readonly color: string
  /** Whether each piece gets a shade of its own. */
  readonly shaded: boolean
}

/** Every placement of one shape, drawn with `geometry`. */
function Batch({ bounds, color, geometry, placements, shaded }: BatchProps & {
  readonly geometry: THREE.BufferGeometry
}) {
  const write = useCallback((mesh: THREE.InstancedMesh) => {
    const base = new THREE.Color(color), shade = new THREE.Color(), matrix = new THREE.Matrix4()
    placements.forEach((placement, n) => {
      mesh.setMatrixAt(n, placementMatrix(bounds, placement, matrix))
      mesh.setColorAt(n, shaded ? shadeOf(base, n, shade) : base)
    })
  }, [bounds, color, placements, shaded])
  return (
    <PreviewInstances count={placements.length} geometry={geometry} write={write}>
      {/* Flat-shaded: a plate is a pyramid scaled almost flat, and a mesh's own normals would shade it as folds. */}
      <meshStandardMaterial roughness={0.6} metalness={0.05} flatShading />
    </PreviewInstances>
  )
}

function GlbBatch({ url, ...batch }: BatchProps & { readonly url: string }) {
  const { scene } = useGLTF(url)
  const geometry = useMemo(() => glbGeometry(scene), [scene])
  return <Batch geometry={geometry} {...batch} />
}

/** Shows `fallback` in place of children that threw: a glb that can't be read. */
class OnError extends Component<{ readonly fallback: ReactNode; readonly children: ReactNode }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function ShapeBatch({ kind, mesh, ...rest }: Omit<BatchProps, "bounds"> & {
  readonly kind: ShapeKind
  readonly mesh: PieceMesh
}) {
  const batch = { ...rest, bounds: mesh.bounds }
  const standIn = useMemo(() => standInGeometry(kind, SHAPES[kind].bounds), [kind])
  const fallback = <Batch geometry={standIn} {...batch} />
  if (mesh.url === undefined) return fallback
  return (
    <OnError fallback={fallback}>
      <Suspense fallback={fallback}>
        <GlbBatch url={mesh.url} {...batch} />
      </Suspense>
    </OnError>
  )
}

/**
 * `placements`, a batch per shape. `colors` gives each shape a colour of its own; without it every piece is
 * `paint`, in one shade when `uniform` and a shade each otherwise.
 */
export function PreviewPieces({ colors, meshes, paint, placements, uniform, x }: {
  readonly placements: ReadonlyArray<Placement>
  readonly meshes: Readonly<Record<ShapeKind, PieceMesh>>
  readonly colors: Readonly<Record<ShapeKind, string>> | undefined
  readonly paint: string
  readonly uniform: boolean
  /** Where they stand along X, in cm. */
  readonly x: number
}) {
  const byKind = useMemo(() => {
    const groups = new Map<ShapeKind, Array<Placement>>()
    for (const placement of placements) {
      const group = groups.get(placement.kind) ?? []
      groups.set(placement.kind, group)
      group.push(placement)
    }
    return groups
  }, [placements])
  return (
    <group position={[x, 0, 0]}>
      {shapeKinds.map((kind) => {
        const mine = byKind.get(kind)
        return mine === undefined ? null : (
          <ShapeBatch
            key={kind}
            kind={kind}
            mesh={meshes[kind]}
            placements={mine}
            color={colors?.[kind] ?? paint}
            shaded={colors !== undefined || !uniform}
          />
        )
      })}
    </group>
  )
}
