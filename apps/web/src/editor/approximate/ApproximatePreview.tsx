/**
 * The approximation dialog's 3D view: the model, the pieces chosen for it and the voxels the method saw, as the view
 * asks. All three are in the game's frame, under the one group that turns it into the scene's.
 */
import { OrbitControls } from "@react-three/drei"
import { Canvas, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import type { VoxelGrid } from "../../domain/approximate/grid/voxelize"
import { pieceOfShape } from "../../domain/approximate/items"
import { type Placement, type ShapeKind, SHAPES } from "../../domain/approximate/shapes"
import type { CatalogIndex } from "../../domain/Catalog"
import { UE_TO_THREE_MATRIX } from "../../domain/coords"
import { useEditor } from "../store"
import { glbUrl } from "../visuals"
import { modelGeometryOf, PreviewModel } from "./PreviewModel"
import { type PieceMesh, PreviewPieces } from "./PreviewPieces"
import { PreviewVoxels } from "./PreviewVoxels"

export type PreviewView = "overlay" | "pieces" | "side" | "model" | "voxels"

/** What each view draws. */
const SHOWS: Readonly<Record<PreviewView, ReadonlyArray<"model" | "pieces" | "voxels">>> = {
  overlay: ["model", "pieces"],
  pieces: ["pieces"],
  side: ["model", "pieces"],
  model: ["model"],
  voxels: ["voxels"]
}

/** The colour of each shape with Colour by shape on, and of its dot in the dialog's lists. */
export const SHAPE_COLORS: Readonly<Record<ShapeKind, string>> = {
  box: "#5b8def",
  sphere: "#e5534b",
  cylinder: "#3fb27f",
  cone: "#f0a03c",
  pyramid: "#a371f7",
  hemisphere: "#e86fb4",
  capsule: "#3fb8c9"
}

/** Smooth White, the prefab's paint, as the preview shows it. */
const PAINT_COLOR = "#e4e6ea"

const GAME_TO_SCENE = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)

/** In side by side, how far the model and the pieces each stand from the middle, in model widths. */
const SIDE_STEP = 0.6

const pieceMeshesOf = (catalog: CatalogIndex | null): Readonly<Record<ShapeKind, PieceMesh>> => {
  const meshOf = (kind: ShapeKind): PieceMesh => {
    const piece = catalog === null ? undefined : pieceOfShape(catalog, kind)
    return { url: glbUrl(piece?.glb), bounds: piece?.bounds ?? SHAPES[kind].bounds }
  }
  return {
    box: meshOf("box"),
    sphere: meshOf("sphere"),
    cylinder: meshOf("cylinder"),
    cone: meshOf("cone"),
    pyramid: meshOf("pyramid"),
    hemisphere: meshOf("hemisphere"),
    capsule: meshOf("capsule")
  }
}

/** What is shown, in the scene: `width` across and `depth` deep about the origin, standing `height` tall on it. */
interface Extent {
  readonly width: number
  readonly height: number
  readonly depth: number
}

/** Puts the camera where all of `extent` shows, whenever it changes. */
function Framing({ extent }: { readonly extent: Extent }) {
  const camera = useThree((three) => three.camera)
  useEffect(() => {
    const reach = Math.max(extent.width, extent.height, extent.depth, 1)
    camera.position.set(reach * 1.3, extent.height / 2 + reach * 0.9, reach * 1.6)
    camera.near = reach / 1000
    camera.far = reach * 100
    camera.updateProjectionMatrix()
  }, [camera, extent])
  return null
}

export function ApproximatePreview({ colorByShape, grid, modelKey, placements, triangles, uniformPaint, view }: {
  /** The model, in the game's frame, standing on the origin (`placeModel`). */
  readonly triangles: Float32Array
  /** Names the model: the camera turns back to where it started when this changes. */
  readonly modelKey: string
  readonly placements: ReadonlyArray<Placement>
  /** The voxels the method saw, once its run is done. */
  readonly grid: VoxelGrid | null
  readonly view: PreviewView
  readonly colorByShape: boolean
  /** Without Colour by shape, whether every piece has the paint's one shade rather than a shade of its own. */
  readonly uniformPaint: boolean
}) {
  const catalog = useEditor((s) => s.catalogIndex)
  const meshes = useMemo(() => pieceMeshesOf(catalog), [catalog])
  const geometry = useMemo(() => modelGeometryOf(triangles), [triangles])
  const size = useMemo(() => geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(), [geometry])
  const side = view === "side"
  const step = side ? size.x * SIDE_STEP : 0
  // The game's Z is the scene's Y.
  const extent = useMemo(() => ({ width: size.x + 2 * step, height: size.z, depth: size.y }), [size, step])
  const shows = SHOWS[view]
  return (
    <Canvas camera={{ fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#14171c"]} />
      <hemisphereLight args={["#dfe8ff", "#30281f", 1.2]} />
      <directionalLight position={[1, 2, 1.5]} intensity={1.6} />
      <directionalLight position={[-1.5, 0.5, -1]} intensity={0.5} />
      {/* A hair under the floor, so it doesn't flicker against the model's underside. */}
      <gridHelper
        args={[Math.max(size.x, size.y) * 3, 30, "#3a4250", "#262c36"]}
        position={[0, -extent.height * 0.002, 0]}
      />
      {/* A matrix set by hand is only read when the flag says it changed. */}
      <group matrix={GAME_TO_SCENE} matrixAutoUpdate={false} matrixWorldNeedsUpdate>
        {shows.includes("model") && <PreviewModel geometry={geometry} ghost={view === "overlay"} x={-step} />}
        {shows.includes("pieces") && (
          <PreviewPieces
            placements={placements}
            meshes={meshes}
            colors={colorByShape ? SHAPE_COLORS : undefined}
            paint={PAINT_COLOR}
            uniform={uniformPaint}
            x={step}
          />
        )}
        {shows.includes("voxels") && grid !== null && <PreviewVoxels grid={grid} />}
      </group>
      <OrbitControls key={`${modelKey} ${side}`} makeDefault enableDamping={false} target={[0, extent.height / 2, 0]} />
      <Framing extent={extent} />
    </Canvas>
  )
}
