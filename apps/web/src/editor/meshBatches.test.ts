import { afterEach, describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { batchMeshesOf, isShown, MeshBatches, traverseShown } from "./meshBatches"

const geometry = new THREE.BoxGeometry(1, 1, 1)
const opaque = new THREE.MeshStandardMaterial()
const glass = new THREE.MeshStandardMaterial({ transparent: true })
const camera = new THREE.PerspectiveCamera()

/** A compiler whose programs are ready when the test says so. */
const compiler = () => {
  const waiting: Array<() => void> = []
  return {
    compileAsync: (object: THREE.Object3D) =>
      new Promise<THREE.Object3D>((resolve) => {
        waiting.push(() => resolve(object))
      }),
    finish: async () => {
      for (const done of waiting.splice(0)) done()
      await Promise.resolve()
    }
  }
}

/** An item like ItemObject's: a group placed in the scene, a mesh under it. */
const item = (scene: THREE.Scene, x: number, material: THREE.Material = opaque, scale = 1) => {
  const group = new THREE.Group()
  group.position.set(x, 0, 0)
  group.scale.set(scale, 1, 1)
  const mesh = new THREE.Mesh(geometry, material)
  group.add(mesh)
  scene.add(group)
  scene.updateMatrixWorld(true)
  return { group, mesh, release: batchMeshesOf(group) }
}

const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh
const instancedUnder = (batches: MeshBatches) => batches.root.children.filter(isInstanced)

/** Where each instance of `batch` stands in the world: its own matrix, then the instance's. */
const placesOf = (batch: THREE.InstancedMesh) =>
  Array.from({ length: batch.count }, (_, i) => {
    const m = new THREE.Matrix4()
    batch.getMatrixAt(i, m)
    return new THREE.Vector3().setFromMatrixPosition(m.premultiply(batch.matrix)).x
  })

const releases: Array<() => void> = []
afterEach(() => {
  for (const release of releases.splice(0)) release()
})

const setUp = () => {
  const scene = new THREE.Scene()
  const batches = new MeshBatches()
  scene.add(batches.root)
  const gl = compiler()
  const add = (x: number, material?: THREE.Material, scale?: number) => {
    const made = item(scene, x, material, scale)
    releases.push(made.release)
    return made
  }
  const sync = () => batches.sync(gl, scene, camera)
  return { scene, batches, gl, add, sync }
}

describe("MeshBatches", () => {
  it("draws meshes that share a geometry and a material as one batch, where they stand", async () => {
    const { add, batches, gl, sync } = setUp()
    const a = add(100)
    const b = add(200)
    sync()
    const [batch, ...more] = instancedUnder(batches)
    expect(more).toHaveLength(0)
    if (batch === undefined) throw new Error("no batch")
    expect(placesOf(batch)).toEqual([100, 200])
    expect(a.mesh.visible).toBe(false)
    expect(b.mesh.visible).toBe(false)
    // shown once its programs have compiled, and not before
    expect(batch.visible).toBe(false)
    expect(batches.pending).toBe(true)
    await gl.finish()
    expect(batch.visible).toBe(true)
    expect(batches.pending).toBe(false)
  })

  it("leaves a translucent mesh to draw on its own", () => {
    const { add, batches, sync } = setUp()
    const { mesh } = add(0, glass)
    sync()
    expect(instancedUnder(batches)).toHaveLength(0)
    expect(mesh.visible).toBe(true)
  })

  it("puts mirrored meshes in a batch of their own that turns them inside out", () => {
    const { add, batches, sync } = setUp()
    add(100)
    add(300, opaque, -1)
    sync()
    const all = instancedUnder(batches)
    expect(all).toHaveLength(2)
    const mirrored = all.find((o) => o.matrix.determinant() < 0)
    expect(mirrored).toBeDefined()
    if (mirrored === undefined) return
    expect(placesOf(mirrored)).toEqual([300])
    // the batch's matrix and the instance's together make the mesh's own, scale and all
    const m = new THREE.Matrix4()
    mirrored.getMatrixAt(0, m)
    expect(m.premultiply(mirrored.matrix).determinant()).toBeLessThan(0)
  })

  it("follows what moves, and says when nothing did", async () => {
    const { add, batches, gl, scene, sync } = setUp()
    const { group } = add(100)
    expect(sync()).toBe(true)
    await gl.finish()
    // its programs came in: it shows now
    expect(sync()).toBe(true)
    expect(sync()).toBe(false)
    group.position.x = 150
    scene.updateMatrixWorld(true)
    expect(sync()).toBe(true)
    const [batch] = instancedUnder(batches)
    if (batch === undefined) throw new Error("no batch")
    expect(placesOf(batch)).toEqual([150])
  })

  it("leaves out an item that is hidden, and counts a batched mesh as shown", () => {
    const { add, batches, sync } = setUp()
    const shown = add(100)
    const hidden = add(200)
    hidden.group.visible = false
    sync()
    const [batch] = instancedUnder(batches)
    if (batch === undefined) throw new Error("no batch")
    expect(placesOf(batch)).toEqual([100])
    expect(isShown(shown.mesh)).toBe(true)
    expect(isShown(hidden.mesh)).toBe(false)
    const seen: Array<THREE.Object3D> = []
    traverseShown(shown.group, (o) => seen.push(o))
    expect(seen).toContain(shown.mesh)
  })

  it("gives a mesh back as it was, and takes down a batch with nothing left to draw", () => {
    const { add, batches, sync } = setUp()
    const { mesh, release } = add(100)
    sync()
    expect(mesh.visible).toBe(false)
    release()
    expect(mesh.visible).toBe(true)
    expect(sync()).toBe(true)
    expect(instancedUnder(batches)).toHaveLength(0)
  })

  it("makes room for as many meshes as come", () => {
    const { add, batches, sync } = setUp()
    for (let i = 0; i < 40; i++) add(i)
    sync()
    const [batch, ...more] = instancedUnder(batches)
    expect(more).toHaveLength(0)
    if (batch === undefined) throw new Error("no batch")
    expect(placesOf(batch)).toEqual(Array.from({ length: 40 }, (_, i) => i))
  })
})
