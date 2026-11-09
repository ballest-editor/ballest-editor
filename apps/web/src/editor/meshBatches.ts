/**
 * Draws the items' opaque meshes as instanced batches: one draw for every mesh that shares a geometry and a material,
 * where three would make one draw call per mesh. A map of thousands of pieces is mostly a few kinds of piece, and the
 * draw calls, not the triangles, were what held its frames up (about 20 µs of the page's time each, a frame per
 * thousand).
 *
 * Each item keeps its own meshes, so everything that reads them (clicks, the paint tool, outlines, snapping, bounds)
 * works as before: they are only hidden, and their batch draws them where they stand. `sync` runs once a frame,
 * after the scene's matrices are worked out, and copies every mesh's place into its batch; a mesh whose material
 * is translucent (sorted back to front, which a batch can't be) or several draws stays an ordinary mesh.
 *
 * A material is drawn by batches alone or never by one: three keeps one program per material, and a material drawn both
 * ways would switch programs at every draw. A mirrored mesh (a negative determinant) culls its faces the other way
 * round, which three sets per object, so mirrored meshes have batches of their own, under a mirroring matrix that
 * their places undo.
 *
 * A new batch's programs compile off the page's thread (`compileAsync`) before it shows: a map's shaders would
 * otherwise compile one after the other, on the page's thread, in its first frame.
 */
import * as THREE from "three"
import { isMesh } from "./threeGuards"

/** The meshes items are made of, as their components mount them. */
const itemMeshes = new Set<THREE.Mesh>()

/** Meshes their batch draws this frame, which are hidden for it. */
const batched = new WeakSet<THREE.Object3D>()

/** Hands every mesh under `object` to the batches; the returned function takes them back, shown as they were. */
export const batchMeshesOf = (object: THREE.Object3D): () => void => {
  const meshes: Array<THREE.Mesh> = []
  object.traverse((o) => {
    if (isMesh(o)) meshes.push(o)
  })
  for (const mesh of meshes) itemMeshes.add(mesh)
  return () => {
    for (const mesh of meshes) {
      itemMeshes.delete(mesh)
      batched.delete(mesh)
      mesh.visible = true
    }
  }
}

/** Whether `object` and everything above it is shown, a mesh its batch draws counting as shown. */
export const isShown = (object: THREE.Object3D): boolean => {
  for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
    if (!o.visible && !batched.has(o)) return false
  }
  return true
}

/** `callback` for `root` and everything under it that is shown, as `traverseVisible`, a batched mesh counting as shown. */
export const traverseShown = (root: THREE.Object3D, callback: (object: THREE.Object3D) => void): void => {
  if (!root.visible && !batched.has(root)) return
  callback(root)
  for (const child of root.children) traverseShown(child, callback)
}

const canBatch = (mesh: THREE.Mesh): mesh is THREE.Mesh<THREE.BufferGeometry, THREE.Material> =>
  !Array.isArray(mesh.material) && !mesh.material.transparent && mesh.geometry.morphAttributes["position"] === undefined

/** Turns a batch inside out (a negative determinant), for mirrored meshes; its own inverse. */
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1)

const FIRST_CAPACITY = 16

type Instanced = THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>

interface Batch {
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.Material
  readonly mirrored: boolean
  mesh: Instanced
  /** Instances written this frame. */
  count: number
  /** Whether what it draws changed this frame. */
  changed: boolean
  /** Until its programs have compiled. */
  compiling: boolean
}

const placed = new THREE.Matrix4()

/** What compiles a new batch's programs: the viewport's renderer. */
type Compiler = Pick<THREE.WebGLRenderer, "compileAsync">

export class MeshBatches {
  readonly root = new THREE.Group()
  /** geometry -> material -> [upright, mirrored] */
  private readonly batches = new Map<THREE.BufferGeometry, Map<THREE.Material, [Batch | null, Batch | null]>>()
  private compiling = 0
  /** A batch's programs came in since the last `sync`, so it shows now. */
  private compiled = false

  constructor() {
    this.root.name = "mesh batches"
    this.root.matrixAutoUpdate = false
  }

  /** Whether some batch is still waiting for its programs. */
  get pending(): boolean {
    return this.compiling > 0
  }

  /**
   * Copies every item mesh's place into its batch, after the scene's matrices are up to date. `camera` and `scene` are
   * what a new batch's programs compile for. True when anything the batches draw changed.
   */
  sync(renderer: Compiler, scene: THREE.Scene, camera: THREE.Camera): boolean {
    const all: Array<Batch> = []
    for (const byMaterial of this.batches.values()) {
      for (const pair of byMaterial.values()) {
        for (const batch of pair) {
          if (batch === null) continue
          batch.count = 0
          batch.changed = false
          all.push(batch)
        }
      }
    }
    let changed = this.compiled
    this.compiled = false
    for (const mesh of itemMeshes) {
      if (!canBatch(mesh)) {
        if (batched.delete(mesh)) changed = true
        mesh.visible = true
        continue
      }
      if (!batched.has(mesh)) {
        batched.add(mesh)
        changed = true
      }
      mesh.visible = false
      if (mesh.parent === null || !isShown(mesh.parent)) continue
      const mirrored = mesh.matrixWorld.determinant() < 0
      const batch = this.batchFor(mesh.geometry, mesh.material, mirrored, renderer, scene, camera, all)
      const matrix = mirrored ? placed.multiplyMatrices(MIRROR, mesh.matrixWorld) : mesh.matrixWorld
      this.write(batch, matrix)
    }
    for (const batch of all) {
      if (batch.count !== batch.mesh.count) {
        batch.mesh.count = batch.count
        batch.changed = true
      }
      if (batch.count === 0) {
        this.drop(batch)
        changed = true
        continue
      }
      if (!batch.changed) continue
      batch.mesh.instanceMatrix.needsUpdate = true
      batch.mesh.boundingSphere = null
      batch.mesh.boundingBox = null
      if (!batch.compiling) changed = true
    }
    return changed
  }

  /** Every batch taken down, for when the scene goes. */
  dispose(): void {
    for (const byMaterial of this.batches.values()) {
      for (const pair of byMaterial.values()) for (const batch of pair) if (batch !== null) this.drop(batch)
    }
    this.batches.clear()
  }

  private write(batch: Batch, matrix: THREE.Matrix4): void {
    if (batch.count === batch.mesh.instanceMatrix.count) this.grow(batch)
    const array = batch.mesh.instanceMatrix.array
    const offset = batch.count * 16
    const elements = matrix.elements
    for (let i = 0; i < 16; i++) {
      const value = elements[i] ?? 0
      if (array[offset + i] !== value) {
        array[offset + i] = value
        batch.changed = true
      }
    }
    batch.count++
  }

  private batchFor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    mirrored: boolean,
    renderer: Compiler,
    scene: THREE.Scene,
    camera: THREE.Camera,
    all: Array<Batch>
  ): Batch {
    const byMaterial = this.batches.get(geometry) ?? new Map<THREE.Material, [Batch | null, Batch | null]>()
    this.batches.set(geometry, byMaterial)
    const pair = byMaterial.get(material) ?? [null, null]
    byMaterial.set(material, pair)
    const side = mirrored ? 1 : 0
    const existing = pair[side]
    if (existing !== null) return existing
    const batch: Batch = {
      geometry,
      material,
      mirrored,
      mesh: this.instanced(geometry, material, FIRST_CAPACITY, mirrored),
      count: 0,
      changed: true,
      compiling: true
    }
    pair[side] = batch
    all.push(batch)
    this.compiling++
    batch.mesh.visible = false
    void renderer.compileAsync(batch.mesh, camera, scene).then(() => {
      if (!batch.compiling) return // dropped meanwhile
      batch.compiling = false
      batch.mesh.visible = true
      this.compiling--
      this.compiled = true
    })
    return batch
  }

  private instanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    mirrored: boolean
  ): Instanced {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.count = 0
    mesh.matrixAutoUpdate = false
    if (mirrored) mesh.matrix.copy(MIRROR)
    mesh.matrixWorld.copy(mesh.matrix)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // clicks and the paint tool hit the items' own meshes
    mesh.raycast = () => {}
    this.root.add(mesh)
    return mesh
  }

  /** Twice the room, keeping what has been written. */
  private grow(batch: Batch): void {
    const old = batch.mesh
    const mesh = this.instanced(batch.geometry, batch.material, old.instanceMatrix.count * 2, batch.mirrored)
    mesh.instanceMatrix.array.set(old.instanceMatrix.array)
    mesh.visible = old.visible
    mesh.count = old.count
    old.removeFromParent()
    old.dispose()
    batch.mesh = mesh
    batch.changed = true
  }

  private drop(batch: Batch): void {
    batch.mesh.removeFromParent()
    batch.mesh.dispose()
    if (batch.compiling) {
      batch.compiling = false
      this.compiling--
    }
    const byMaterial = this.batches.get(batch.geometry)
    const pair = byMaterial?.get(batch.material)
    if (pair === undefined || byMaterial === undefined) return
    pair[batch.mirrored ? 1 : 0] = null
    if (pair[0] === null && pair[1] === null) byMaterial.delete(batch.material)
    if (byMaterial.size === 0) this.batches.delete(batch.geometry)
  }
}

/** The viewport's batches (there is one viewport). */
export const meshBatches = new MeshBatches()
