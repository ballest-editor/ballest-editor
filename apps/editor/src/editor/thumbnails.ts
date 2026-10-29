/**
 * Palette thumbnails for pieces the game ships none for (the hidden section). Each is rendered
 * once, on demand, from the same glbs and materials the viewport draws, in the style of the
 * game's own renders (dark grey backdrop, three-quarter view from above-front), then cached
 * per piece as a PNG data URL. Renders run one at a time off a queue so an expanded section
 * with a hundred pieces never stalls the UI.
 *
 * `frameBox`, `SerialQueue`, `texturesOf` and `whenTexturesReady` are unit-tested; the WebGL part is a thin wrapper.
 */
import * as THREE from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { type CatalogIndex, type CatalogPiece, pieceIdOf } from "../domain/Catalog"
import { type Tuple3, UE_TO_THREE_MATRIX, ueToScene } from "../domain/coords"
import { itemFromPiece, placementTransform } from "../domain/factory"
import type { MaterialTable } from "../domain/Materials"
import { applySlotMaterials, shaderPatchOf, textureLoaded } from "./materials"
import { isMesh, isTexture } from "./threeGuards"
import { glbUrl, visualsOf } from "./visuals"
import { fixSceneWinding } from "./winding"

/** The game's palette renders are 256 px wide and about 16:9; ours match so the palette treats both alike. */
export const THUMBNAIL_WIDTH = 256
export const THUMBNAIL_HEIGHT = 144
/** The game's backdrop (sampled from its renders: RGB 47, 47, 47). */
export const THUMBNAIL_BACKGROUND = "#2f2f2f"
const FOV = 35
/** From the front-right and above (scene frame, y up), like the game's renders. */
const VIEW_DIRECTION: Tuple3 = [1, 0.8, 1]
/** Fraction of the frame the piece's bounding sphere may fill. */
const FILL = 0.92
/** How long to wait for a piece's textures before rendering it as is. */
const TEXTURE_WAIT_MS = 3000

export interface Framing {
  readonly position: Tuple3
  readonly target: Tuple3
  readonly near: number
  readonly far: number
}

/**
 * Where a perspective camera (`fov` vertical degrees, `aspect`) stands, looking down
 * `direction` at the box's centre, so the box's bounding sphere fills `FILL` of the frame's
 * tighter dimension.
 */
export const frameBox = (min: Tuple3, max: Tuple3, aspect: number, direction: Tuple3 = VIEW_DIRECTION): Framing => {
  const center: Tuple3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
  const vertical = THREE.MathUtils.degToRad(FOV) / 2
  const horizontal = Math.atan(Math.tan(vertical) * aspect)
  const distance = radius / (Math.sin(Math.min(vertical, horizontal)) * FILL)
  const dir = new THREE.Vector3(...direction).normalize()
  const position = new THREE.Vector3(...center).addScaledVector(dir, distance)
  return {
    position: [position.x, position.y, position.z],
    target: center,
    near: Math.max(0.1, distance - radius * 2),
    far: distance + radius * 2
  }
}

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

/** The piece as the viewport would draw it when freshly placed at the origin; undefined if it has no mesh. */
const buildPiece = async (
  piece: CatalogPiece,
  index: CatalogIndex,
  table: MaterialTable
): Promise<THREE.Group | undefined> => {
  const item = itemFromPiece(piece, placementTransform(piece, { x: 0, y: 0, z: 0 }))
  const root = new THREE.Group()
  const transform = ueToScene(item.itemTransform)
  root.position.set(...transform.position)
  root.quaternion.set(...transform.quaternion)
  root.scale.set(...transform.scale)
  const visuals = visualsOf(item, index)
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
      root.add(holder)
    } else {
      const placed = new THREE.Group()
      placed.position.set(...visual.relative.position)
      placed.quaternion.set(...visual.relative.quaternion)
      placed.scale.set(...visual.relative.scale)
      placed.add(holder)
      root.add(placed)
    }
  })
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
const stageOf = (): Stage => {
  if (stage !== undefined) return stage
  const canvas = document.createElement("canvas")
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, false)
  renderer.setClearColor(THUMBNAIL_BACKGROUND)
  const scene = new THREE.Scene()
  // The viewport's lights, so a thumbnail matches what gets placed.
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  scene.add(new THREE.HemisphereLight("#dfe8ff", "#30302a", 0.8))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(3000, 8000, 2000)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(FOV, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT)
  stage = { renderer, scene, camera }
  return stage
}

const render = async (piece: CatalogPiece, index: CatalogIndex, table: MaterialTable): Promise<string | undefined> => {
  const object = await buildPiece(piece, index, table)
  if (object === undefined) return undefined
  await whenTexturesReady(texturesOf(object), TEXTURE_WAIT_MS)
  const { camera, renderer, scene } = stageOf()
  scene.add(object)
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const framing = frameBox(box.min.toArray(), box.max.toArray(), camera.aspect)
  camera.position.set(...framing.position)
  camera.near = framing.near
  camera.far = framing.far
  camera.lookAt(...framing.target)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL("image/png")
  scene.remove(object)
  return url
}

const queue = new SerialQueue()
const cache = new Map<string, Promise<string | undefined>>()

/**
 * A rendered thumbnail (PNG data URL) for `piece`, or undefined when it has nothing to draw
 * or rendering failed. Rendered once per piece, in request order, one at a time.
 */
export const thumbnailFor = (
  piece: CatalogPiece,
  index: CatalogIndex,
  table: MaterialTable
): Promise<string | undefined> => {
  const id = pieceIdOf(piece)
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const promise = queue.run(() => render(piece, index, table)).catch((error: unknown) => {
    console.warn(`Couldn't render a thumbnail for ${piece.className}.`, error)
    return undefined
  })
  cache.set(id, promise)
  return promise
}
