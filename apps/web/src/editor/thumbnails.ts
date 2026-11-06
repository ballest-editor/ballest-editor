/**
 * Every piece's thumbnail, and every prefab definition's. Each is rendered once, on demand, from the same glbs and
 * materials the viewport draws, three-quarter view from above-front like the game's own renders, on a transparent
 * background so it sits on whatever panel shows it. The game's renders have its dark backdrop baked in, unevenly enough
 * that it can't be keyed out cleanly, so they are only the fallback (components/PieceThumbnail.tsx). The lights here are
 * fixed, so a thumbnail looks the same in both themes and is cached once per piece and fill, as a PNG data URL. Renders
 * run one at a time off a queue so a long list never stalls the UI. A whole map's items go through the same stage, seen
 * from straight above (`mapThumbnailFor`, and through it the Project panel's rows in `mapThumbnails.ts`).
 *
 * `frameBox`, `frameTopDown`, `SerialQueue`, `texturesOf` and `whenTexturesReady` are unit-tested; the WebGL part is a
 * thin wrapper.
 */
import type { PrefabRef } from "@ballest/contracts"
import * as THREE from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { type CatalogIndex, type CatalogPiece, pieceIdOf } from "../domain/Catalog"
import {
  fromTuple3,
  toTuple3,
  type Tuple3,
  UE_TO_THREE_MATRIX,
  ueToScene,
  ueToThreeVector,
  type UeTransform
} from "../domain/coords"
import { DECAL_VISUAL_SCALE, editTransform, isDecal } from "../domain/editTransform"
import { itemFromPiece, placementTransform } from "../domain/factory"
import type { Item } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { mirrorScaleOf } from "../domain/mirror"
import { ORTHO_AXES } from "../domain/orthoView"
import type { Surfaces } from "../domain/surface"
import { applySlotMaterials, shaderPatchOf, textureLoaded } from "./materials"
import { isMesh, isTexture } from "./threeGuards"
import { glbUrl, visualsOf } from "./visuals"
import { fixSceneWinding } from "./winding"

/** Every slot a thumbnail shows in is square, at most 64 px: this is that at twice the pixel density. */
const THUMBNAIL_SIZE = 128
/** A map's picture shows at 240 px: this is that at twice the pixel density. */
const MAP_THUMBNAIL_SIZE = 480
/** How many items are built before the page gets a turn, so a large map doesn't hold up the dialog showing it. */
const BUILD_BATCH = 200
const FOV = 35
/** From the front-right and above (scene frame, y up), like the game's renders. */
const VIEW_DIRECTION: Tuple3 = [1, 0.8, 1]
/** Fraction of the frame the piece's bounding sphere may fill. */
const FILL = 0.92
/** How long to wait for a piece's textures before rendering it as is. */
const TEXTURE_WAIT_MS = 3000

/** A box's opposite corners. */
export type Bounds = readonly [min: Tuple3, max: Tuple3]

export interface Framing {
  readonly position: Tuple3
  readonly target: Tuple3
  readonly near: number
  readonly far: number
}

/**
 * Where a perspective camera (`FOV` vertical degrees, `aspect`) stands, looking down `VIEW_DIRECTION` at the box's
 * centre, so the box's bounding sphere fills `FILL` of the frame's tighter dimension, or `fill` of that for a piece drawn
 * smaller than the frame allows.
 */
export const frameBox = (min: Tuple3, max: Tuple3, aspect: number, fill = 1): Framing => {
  const center: Tuple3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
  const vertical = THREE.MathUtils.degToRad(FOV) / 2
  const horizontal = Math.atan(Math.tan(vertical) * aspect)
  const distance = radius / (Math.sin(Math.min(vertical, horizontal)) * FILL * fill)
  const dir = new THREE.Vector3(...VIEW_DIRECTION).normalize()
  const position = new THREE.Vector3(...center).addScaledVector(dir, distance)
  return {
    position: [position.x, position.y, position.z],
    target: center,
    near: Math.max(0.1, distance - radius * 2),
    far: distance + radius * 2
  }
}

interface TopDownFraming {
  readonly position: Tuple3
  /** Half the square an orthographic camera sees. */
  readonly halfSize: number
  readonly near: number
  readonly far: number
}

/** Room above the box for the camera to stand in, and below it for the far plane. */
const TOP_DOWN_CLEARANCE = 100

/** Where an orthographic camera stands, straight above the box (scene frame, y up), so its plan fills `FILL` of a square. */
export const frameTopDown = (min: Tuple3, max: Tuple3): TopDownFraming => ({
  position: [(min[0] + max[0]) / 2, max[1] + TOP_DOWN_CLEARANCE, (min[2] + max[2]) / 2],
  halfSize: Math.max(1, (max[0] - min[0]) / 2, (max[2] - min[2]) / 2) / FILL,
  near: 1,
  far: max[1] - min[1] + 2 * TOP_DOWN_CLEARANCE
})

/** Runs async tasks strictly one after another, in the order they were queued. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  run<A>(task: () => Promise<A>): Promise<A> {
    const next = this.tail.then(task, task)
    this.tail = next.catch(() => undefined)
    return next
  }
}

// ---------------------------------------------------------------------------
// glb loading (separate from drei's React cache: this runs outside React)

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const glbs = new Map<string, Promise<THREE.Group>>()

const loadGlb = (url: string): Promise<THREE.Group> => {
  const cached = glbs.get(url)
  if (cached !== undefined) return cached
  const promise = loader.loadAsync(url).then((gltf) => {
    fixSceneWinding(gltf.scene)
    return gltf.scene
  })
  promise.catch(() => glbs.delete(url))
  glbs.set(url, promise)
  return promise
}

const ueToThree = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)

/** The scale `ItemObject` draws an item's meshes at inside its transform: a mirror's, and a decal's unit mesh. */
const bodyScaleOf = (item: Item, index: CatalogIndex): Tuple3 => {
  const mirror = mirrorScaleOf(item, index)
  const [x, y, z] = mirror === undefined ? [1, 1, 1] : toTuple3(ueToThreeVector(fromTuple3(mirror)))
  const unit = isDecal(item) ? DECAL_VISUAL_SCALE : 1
  return [x * unit, y * unit, z * unit]
}

/** The item as the viewport draws it at `at`; undefined if it has no mesh. */
const buildItem = async (
  item: Item,
  at: UeTransform,
  index: CatalogIndex,
  table: MaterialTable | null,
  surfaces?: Surfaces
): Promise<THREE.Group | undefined> => {
  const root = new THREE.Group()
  const transform = ueToScene(at)
  root.position.set(...transform.position)
  root.quaternion.set(...transform.quaternion)
  root.scale.set(...transform.scale)
  const body = new THREE.Group()
  body.scale.set(...bodyScaleOf(item, index))
  root.add(body)
  const visuals = visualsOf(item, index, surfaces)
  // A failed glb just leaves that part out, like the viewport's warning box would.
  const scenes = await Promise.all(visuals.map((visual) => {
    const url = glbUrl(visual.mesh?.glb)
    return url === undefined ? Promise.resolve(undefined) : loadGlb(url).catch(() => undefined)
  }))
  visuals.forEach((visual, i) => {
    const scene = scenes[i]
    if (scene === undefined) return
    const holder = new THREE.Group()
    holder.matrixAutoUpdate = false
    holder.matrix.copy(ueToThree)
    holder.add(scene.clone(true))
    applySlotMaterials(holder, table, visual.slotMaterials)
    if (visual.relative === undefined) {
      body.add(holder)
    } else {
      const placed = new THREE.Group()
      placed.position.set(...visual.relative.position)
      placed.quaternion.set(...visual.relative.quaternion)
      placed.scale.set(...visual.relative.scale)
      placed.add(holder)
      body.add(placed)
    }
  })
  return body.children.length === 0 ? undefined : root
}

/** The piece as the viewport would draw it when freshly placed at the origin; undefined if it has no mesh. */
const buildPiece = (piece: CatalogPiece, index: CatalogIndex, table: MaterialTable) => {
  const item = itemFromPiece(piece, placementTransform(piece, { x: 0, y: 0, z: 0 }))
  return buildItem(item, item.itemTransform, index, table)
}

/**
 * Everything `items` draw, each where it stands, giving the page a turn after every `BUILD_BATCH`; undefined if none of
 * them has a mesh.
 */
const buildItems = async (
  items: ReadonlyArray<Item>,
  index: CatalogIndex,
  table: MaterialTable | null,
  surfaces?: Surfaces
): Promise<THREE.Group | undefined> => {
  const root = new THREE.Group()
  const buildFrom = async (start: number): Promise<void> => {
    if (start >= items.length) return
    const parts = await Promise.all(
      items.slice(start, start + BUILD_BATCH).map((item) =>
        buildItem(item, editTransform(item), index, table, surfaces)
      )
    )
    for (const part of parts) if (part !== undefined) root.add(part)
    await new Promise((resolve) => setTimeout(resolve))
    return buildFrom(start + BUILD_BATCH)
  }
  await buildFrom(0)
  return root.children.length === 0 ? undefined : root
}

/**
 * Every texture the object's materials sample, loaded or not: three's own slots and every sampler the
 * shader patch adds (the second normal layer, the colour and alpha layers, the mottle, a program's reads).
 */
export const texturesOf = (object: THREE.Object3D): ReadonlyArray<THREE.Texture> => {
  const out = new Set<THREE.Texture>()
  object.traverse((o) => {
    if (!isMesh(o)) return
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      const slots = [
        material.map,
        material.normalMap,
        material.alphaMap,
        material.emissiveMap,
        material.roughnessMap,
        material.metalnessMap,
        material.aoMap
      ]
      for (const t of slots) if (t) out.add(t)
      for (const uniform of Object.values(shaderPatchOf(material)?.uniforms ?? {})) {
        const value: unknown = uniform.value
        if (isTexture(value)) out.add(value)
      }
    }
  })
  return [...out]
}

/** Resolves once every texture has loaded or failed (`loaded` settles for each), or after `timeoutMs`. */
export const whenTexturesReady = (
  textures: ReadonlyArray<THREE.Texture>,
  timeoutMs: number,
  loaded: (texture: THREE.Texture) => Promise<void> = textureLoaded
): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    void Promise.all(textures.map(loaded)).then(() => {
      clearTimeout(timer)
      resolve()
    })
  })

// ---------------------------------------------------------------------------
// the shared offscreen renderer

interface Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
}

let stage: Stage | undefined
const newStage = (): Stage => {
  const canvas = document.createElement("canvas")
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  // The viewport's lights, so a thumbnail matches what gets placed.
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  scene.add(new THREE.HemisphereLight("#dfe8ff", "#30302a", 0.8))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(3000, 8000, 2000)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(FOV, 1)
  return { renderer, scene, camera }
}

/** The stage, its canvas `size` px square. Renders take turns on `stageQueue`, so nothing else is using it. */
const stageOf = (size: number): Stage => {
  stage ??= newStage()
  if (stage.renderer.domElement.width !== size) stage.renderer.setSize(size, size, false)
  return stage
}

/**
 * `object` at `size` px through the camera `aim` sets up for it, as a PNG data URL; undefined when there is nothing to
 * draw. Its shaders compile first, off the page's thread: left to the render, a map's many materials would hold the page
 * up for as long as they take.
 */
const shoot = async (
  object: THREE.Group | undefined,
  size: number,
  aim: (object: THREE.Group, stage: Stage) => THREE.Camera
): Promise<string | undefined> => {
  if (object === undefined) return undefined
  await whenTexturesReady(texturesOf(object), TEXTURE_WAIT_MS)
  object.updateMatrixWorld(true)
  const shown = stageOf(size)
  const { renderer, scene } = shown
  const camera = aim(object, shown)
  scene.add(object)
  try {
    await renderer.compileAsync(scene, camera)
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL("image/png")
  } finally {
    scene.remove(object)
  }
}

const boundsOf = (box: THREE.Box3): Bounds => [box.min.toArray(), box.max.toArray()]

/**
 * `object` framed whole from the three-quarter view, drawn at `fill` of the size that frame allows, as a PNG data URL;
 * undefined when there is nothing to draw.
 */
const photograph = (object: THREE.Group | undefined, fill = 1) =>
  shoot(object, THUMBNAIL_SIZE, (framed, { camera }) => {
    const [min, max] = boundsOf(new THREE.Box3().setFromObject(framed))
    const framing = frameBox(min, max, camera.aspect, fill)
    camera.position.set(...framing.position)
    camera.near = framing.near
    camera.far = framing.far
    camera.lookAt(...framing.target)
    camera.updateProjectionMatrix()
    return camera
  })

/** How a map is pictured: `size` px square, framed to all of it unless `frame` picks what counts from each item's bounds. */
export interface MapShot {
  readonly size: number
  readonly frame?: (items: ReadonlyArray<Bounds>) => Bounds
}

/** What a map's picture is framed to: `frame`'s pick of its items, or else the whole of them. */
const mapBounds = (map: THREE.Group, frame: MapShot["frame"]): Bounds => {
  if (frame === undefined) return boundsOf(new THREE.Box3().setFromObject(map))
  const boxes = map.children.map((item) => new THREE.Box3().setFromObject(item))
  return frame(boxes.filter((box) => !box.isEmpty()).map(boundsOf))
}

/** A map's items from straight above, with X up the picture and Y to the right, like the Top pane. */
const renderMap = async (
  items: ReadonlyArray<Item>,
  index: CatalogIndex,
  table: MaterialTable | null,
  surfaces: Surfaces,
  { frame, size }: MapShot
): Promise<string | undefined> => {
  // A light's meshes are stand-ins, with no body worth a picture.
  const drawn = items.filter((item) => index.pieceByClass.get(item.actorToSpawn)?.category !== "Lights")
  return shoot(await buildItems(drawn, index, table, surfaces), size, (map) => {
    const [min, max] = mapBounds(map, frame)
    const { far, halfSize, near, position } = frameTopDown(min, max)
    const camera = new THREE.OrthographicCamera(-halfSize, halfSize, halfSize, -halfSize, near, far)
    const up = ueToThreeVector(ORTHO_AXES.top.up)
    camera.up.set(up.x, up.y, up.z)
    camera.position.set(...position)
    camera.lookAt(position[0], min[1], position[2])
    return camera
  })
}

/** One render at a time on the stage. */
const stageQueue = new SerialQueue()
const cache = new Map<string, Promise<string | undefined>>()

/** What `draw` makes, from the stage's queue, once per `key`; undefined if it fails, which is logged as being about `subject`. */
const renderedOnce = (
  key: string,
  subject: string,
  draw: () => Promise<string | undefined>
): Promise<string | undefined> => {
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const promise = stageQueue.run(draw).catch((error: unknown) => {
    console.warn(`Couldn't render a thumbnail for ${subject}.`, error)
    return undefined
  })
  cache.set(key, promise)
  return promise
}

/**
 * A rendered thumbnail (PNG data URL) for `piece`, filling `fill` of the frame (`sizeScalesOf`), or undefined when it has
 * nothing to draw or rendering failed. Rendered once per piece and fill, in request order, one at a time.
 */
export const thumbnailFor = (
  piece: CatalogPiece,
  index: CatalogIndex,
  table: MaterialTable,
  fill = 1
): Promise<string | undefined> =>
  renderedOnce(
    `${pieceIdOf(piece)}|${fill}`,
    piece.className,
    async () => photograph(await buildPiece(piece, index, table), fill)
  )

/** One version of a definition's file, which is what its picture is of. */
const definitionCacheKey = ({ hash, name, tier }: PrefabRef & { readonly hash: string }) =>
  `prefab:${tier}:${name}:${hash}`

/**
 * A rendered thumbnail of a definition: everything in it, framed whole.
 * Rendered once per version of its file, so `readItems` runs only then.
 */
export const definitionThumbnailFor = (
  definition: PrefabRef & { readonly hash: string },
  readItems: () => Promise<ReadonlyArray<Item>>,
  index: CatalogIndex,
  table: MaterialTable
): Promise<string | undefined> =>
  renderedOnce(
    definitionCacheKey(definition),
    `the prefab ${definition.name}`,
    async () => photograph(await buildItems(await readItems(), index, table))
  )

/**
 * A map's items as a top-down picture (PNG data URL) on a transparent background, or undefined when none of them has
 * anything to draw or rendering failed. `id` names those items and this shot of them, neither of which ever changes
 * under it (a backup's hash): each is rendered once.
 */
export const mapThumbnailFor = (
  id: string,
  items: ReadonlyArray<Item>,
  index: CatalogIndex,
  table: MaterialTable | null,
  surfaces: Surfaces,
  shot: MapShot = { size: MAP_THUMBNAIL_SIZE }
): Promise<string | undefined> =>
  renderedOnce(`map:${id}`, "a map", () => renderMap(items, index, table, surfaces, shot))
