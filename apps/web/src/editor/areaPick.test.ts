import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { AreaRegion, type AreaShape } from "../domain/areaSelect"
import { AreaPicker, type PickView } from "./areaPick"
import { batchMeshesOf, MeshBatches } from "./meshBatches"

/** A 200 x 200 px pane looking straight down, one world unit to a pixel, the world's origin at its centre. */
const topView = (): PickView => {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1000)
  camera.position.set(0, 500, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return { camera, width: 200, height: 200 }
}

/** A piece: a box mesh `size` across, centred at (x, z) on the ground, turned `turn` radians about up. */
const piece = (x: number, z: number, size = 10, turn = 0): THREE.Object3D => {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.rotation.y = turn
  group.add(new THREE.Mesh(new THREE.BoxGeometry(size, size, size)))
  group.updateMatrixWorld(true)
  return group
}

const region = (shape: AreaShape) => {
  const made = AreaRegion.of(shape)
  if (made === undefined) throw new Error("no region")
  return made
}
const box = (x0: number, y0: number, x1: number, y1: number) =>
  region({ kind: "box", from: { x: x0, y: y0 }, to: { x: x1, y: y1 } })

describe("AreaPicker", () => {
  const view = topView()
  // screen x = world x + 100, screen y = world z + 100
  const scene = new Map<string, THREE.Object3D>([
    ["a", piece(-50, -50)],
    ["b", piece(0, 0)],
    ["far", piece(80, 80)],
    ["long", piece(0, 50, 60)]
  ])
  const picker = new AreaPicker((key) => scene.get(key))
  const caught = (shape: AreaRegion, mode: "inside" | "touching") =>
    [...scene.keys()].filter((key) => picker.caught(key, view, shape, mode))

  it("projects a piece where the pane shows it", () => {
    const at = picker.screenOrigin("a", view)
    if (at === undefined) throw new Error("a is off the camera")
    assert.approximately(at.x, 50, 1e-6)
    assert.approximately(at.y, 50, 1e-6)
  })

  it("inside takes what is wholly in the box, touching what it reaches", () => {
    // from (40, 40) to (110, 110): a and b wholly, the long one's top edge (y 40 to 100 on screen 120..180) not at all
    assert.deepStrictEqual(caught(box(40, 40, 110, 110), "inside"), ["a", "b"])
    // a box that clips the long piece's corner
    assert.deepStrictEqual(caught(box(60, 110, 75, 125), "touching"), ["long"])
    assert.deepStrictEqual(caught(box(60, 110, 75, 125), "inside"), [])
  })

  it("a lasso goes by its shape, not its bounds", () => {
    // a triangle whose bounds cover a and b, but which passes b by
    const lasso = region({ kind: "lasso", points: [{ x: 30, y: 30 }, { x: 90, y: 30 }, { x: 30, y: 90 }] })
    assert.deepStrictEqual(caught(lasso, "touching"), ["a"])
  })

  it("a turned piece is read by its triangles where its box would overreach", () => {
    // a 40 x 40 box turned 45°: a diamond at screen (100, 100), its corners 28 px out along the axes
    const turned = new Map([["diamond", piece(0, 0, 40, Math.PI / 4)]])
    const pick = new AreaPicker((key) => turned.get(key))
    // the diamond's screen box reaches (72, 72), but the diamond itself doesn't reach that corner
    assert.isFalse(pick.caught("diamond", view, box(70, 70, 78, 78), "touching"))
    assert.isTrue(pick.caught("diamond", view, box(70, 96, 78, 104), "touching"))
  })

  it("reads a piece's meshes where its batch draws them, though they are hidden for it", () => {
    const world = new THREE.Scene()
    const diamond = piece(0, 0, 40, Math.PI / 4)
    world.add(diamond)
    const release = batchMeshesOf(diamond)
    const batches = new MeshBatches()
    batches.sync({ compileAsync: () => new Promise<THREE.Object3D>(() => {}) }, world, view.camera)
    const pick = new AreaPicker((key) => key === "diamond" ? diamond : undefined)
    // a box clear of its origin, over its corner: only its triangles can say it's touched
    assert.isTrue(pick.caught("diamond", view, box(70, 96, 78, 104), "touching"))
    release()
    batches.dispose()
  })

  it("a perspective pane leaves out what is behind the camera", () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 1, 10000)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)
    camera.updateMatrixWorld()
    const persp: PickView = { camera, width: 200, height: 200 }
    const ahead = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)))
    ahead.position.set(0, 0, -100)
    ahead.updateMatrixWorld(true)
    const behind = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)))
    behind.position.set(0, 0, 100)
    behind.updateMatrixWorld(true)
    const both = new Map([["ahead", ahead], ["behind", behind]])
    const pick = new AreaPicker((key) => both.get(key))
    const all = box(0, 0, 200, 200)
    assert.isTrue(pick.caught("ahead", persp, all, "inside"))
    assert.isFalse(pick.caught("behind", persp, all, "touching"))
  })
})
