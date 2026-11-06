import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { ueToThreeVector, type Vec3 } from "../domain/coords"
import { type OrthoView, orthoViews, paneClose, paneCloseColumn } from "../domain/viewLayout"
import {
  changePanes,
  forgetClosedTabs,
  orthographicOnly,
  PaneCamera,
  paneCamerasOf,
  perspectiveOnly
} from "./paneCameras"
import { useEditor } from "./store"

const WIDTH = 800
const HEIGHT = 600
const FOV = 59

const paneOn = (view: OrthoView | "perspective") => {
  const pane = new PaneCamera()
  pane.resize(WIDTH, HEIGHT, FOV)
  pane.setProjection(view)
  return pane
}

/** A point in game space, where the pane puts it: pixels from the pane's top left. */
const onScreen = (pane: PaneCamera, point: Vec3) => {
  const { x, y, z } = ueToThreeVector(point)
  pane.camera.updateMatrixWorld()
  const ndc = new THREE.Vector3(x, y, z).project(pane.camera)
  return { x: ((ndc.x + 1) / 2) * pane.width, y: ((1 - ndc.y) / 2) * pane.height }
}

/** How far apart two points on screen are, in pixels. */
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

const boxOf = (min: Vec3, max: Vec3) => {
  const box = new THREE.Box3()
  for (const corner of [min, max]) {
    const { x, y, z } = ueToThreeVector(corner)
    box.expandByPoint(new THREE.Vector3(x, y, z))
  }
  return box
}

describe("orthographic panes", () => {
  it("shows the game's axes the way the view says", () => {
    const top = paneOn("top")
    top.cmPerPixel = 1
    top.resize(WIDTH + 1, HEIGHT, FOV) // lays the camera out at that zoom
    top.resize(WIDTH, HEIGHT, FOV)
    const centre = { x: WIDTH / 2, y: HEIGHT / 2 }
    assert.closeTo(apart(onScreen(top, { x: 0, y: 0, z: 0 }), centre), 0, 1e-3)
    // forward is up the screen, right is right, height doesn't show
    assert.closeTo(apart(onScreen(top, { x: 100, y: 0, z: 0 }), { x: centre.x, y: centre.y - 100 }), 0, 1e-3)
    assert.closeTo(apart(onScreen(top, { x: 0, y: 100, z: 0 }), { x: centre.x + 100, y: centre.y }), 0, 1e-3)
    assert.closeTo(apart(onScreen(top, { x: 0, y: 0, z: 5000 }), centre), 0, 1e-3)
  })

  it("isn't mirrored from any side", () => {
    for (const view of orthoViews) {
      const pane = paneOn(view)
      const det = pane.orthographic.matrixWorld.determinant()
      assert.closeTo(det, 1, 1e-9)
    }
  })

  it("keeps everything in a big map in front of the camera", () => {
    const pane = paneOn("top")
    const far = ueToThreeVector({ x: 0, y: 0, z: -400_000 })
    const depth = new THREE.Vector3(far.x, far.y, far.z).project(pane.camera).z
    assert.isBelow(Math.abs(depth), 1)
  })

  it("slides with a drag, the point under the pointer staying under it", () => {
    const pane = paneOn("top")
    const point = { x: 50, y: 80, z: 0 }
    const before = onScreen(pane, point)
    pane.slide(-30 * pane.cmPerPixel, -12 * pane.cmPerPixel)
    assert.closeTo(apart(onScreen(pane, point), { x: before.x + 30, y: before.y - 12 }), 0, 1e-3)
  })

  it("zooms about the pointer", () => {
    for (const view of orthoViews) {
      const pane = paneOn(view)
      const at = { x: 650, y: 120 }
      const under = (camera: THREE.Camera) =>
        new THREE.Vector3((at.x / WIDTH) * 2 - 1, -(at.y / HEIGHT) * 2 + 1, 0).unproject(camera)
      const before = under(pane.camera)
      const { cmPerPixel } = pane
      pane.zoomOrthographic(0.25, at)
      const after = under(pane.camera)
      assert.closeTo(before.distanceTo(after), 0, 1e-3)
      assert.closeTo(pane.cmPerPixel, cmPerPixel / 4, 1e-9)
    }
  })

  it("keeps its zoom through a resize, showing more or less", () => {
    const pane = paneOn("front")
    const { cmPerPixel } = pane
    pane.resize(400, 300, FOV)
    assert.strictEqual(pane.cmPerPixel, cmPerPixel)
    assert.closeTo(pane.orthographic.right - pane.orthographic.left, 400 * cmPerPixel, 1e-9)
  })

  it("frames a box whole, in any view", () => {
    const min = { x: -5000, y: -2000, z: 100 }
    const max = { x: 9000, y: 3000, z: 1500 }
    for (const view of orthoViews) {
      const pane = paneOn(view)
      pane.frame(boxOf(min, max), 300)
      for (const corner of [min, max]) {
        const { x, y } = onScreen(pane, corner)
        assert.isTrue(x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT, `${view}: ${x}, ${y}`)
      }
    }
  })

  it("measures the gizmo in its zoom, and sees everything from one direction", () => {
    const pane = paneOn("top")
    assert.strictEqual(pane.worldPerPixelAt(new THREE.Vector3(9000, 0, 9000)), pane.cmPerPixel)
    assert.closeTo(pane.toCameraFrom(new THREE.Vector3(9000, 0, 9000)).dot(new THREE.Vector3(0, 1, 0)), 1, 1e-12)
  })
})

describe("changing a pane's projection", () => {
  it("keeps the point it looks at and its size, there and back", () => {
    const pane = paneOn("perspective")
    pane.perspective.position.set(1000, 2000, 3000)
    pane.perspective.lookAt(0, 0, 0)
    pane.perspective.updateMatrixWorld()
    pane.target.set(0, 0, 0)
    const shown = pane.worldPerPixelAt(pane.target)
    pane.setProjection("top")
    assert.closeTo(pane.cmPerPixel, shown, 1e-6)
    assert.deepStrictEqual(pane.target.toArray(), [0, 0, 0])
    pane.setProjection("perspective")
    pane.perspective.updateMatrixWorld()
    assert.closeTo(pane.worldPerPixelAt(pane.target), shown, 1e-6)
    assert.closeTo(apart(onScreen(pane, { x: 0, y: 0, z: 0 }), { x: WIDTH / 2, y: HEIGHT / 2 }), 0, 1e-3)
  })

  it("looks ahead when its pivot is behind it", () => {
    const pane = paneOn("perspective")
    pane.perspective.position.set(0, 0, 0)
    pane.perspective.lookAt(1, 0, 0)
    pane.perspective.updateMatrixWorld()
    pane.target.set(-500, 0, 0)
    pane.setProjection("front")
    assert.isAbove(pane.target.x, 0)
  })

  it("keeps its centre and zoom between orthographic views", () => {
    const pane = paneOn("top")
    pane.target.set(10, 20, 30)
    const { cmPerPixel } = pane
    pane.setProjection("right")
    assert.deepStrictEqual(pane.target.toArray(), [10, 20, 30])
    assert.strictEqual(pane.cmPerPixel, cmPerPixel)
  })

  it("finds the nearest view from where it looks", () => {
    const pane = paneOn("perspective")
    pane.perspective.position.set(0, 1000, 10)
    pane.perspective.lookAt(0, 0, 0)
    pane.perspective.updateMatrixWorld()
    assert.strictEqual(pane.nearestView(), "top")
  })
})

describe("what each camera sees", () => {
  it("keeps the sky and floor grid out of orthographic panes, and the world grid out of perspective ones", () => {
    const { perspective, orthographic } = new PaneCamera()
    assert.isTrue(perspective.layers.test(perspectiveOnly))
    assert.isFalse(perspective.layers.test(orthographicOnly))
    assert.isTrue(orthographic.layers.test(orthographicOnly))
    assert.isFalse(orthographic.layers.test(perspectiveOnly))
    // lights and items are on layer 0: both see them
    assert.isTrue(perspective.layers.test(new THREE.Layers()) && orthographic.layers.test(new THREE.Layers()))
  })
})

describe("a tab's panes", () => {
  it("gives each tab its own cameras, and keeps them until the tab closes", () => {
    const first = paneCamerasOf("tab-a")
    assert.strictEqual(paneCamerasOf("tab-a"), first)
    assert.notStrictEqual(paneCamerasOf("tab-b")[0], first[0])
    forgetClosedTabs(["tab-b"])
    assert.notStrictEqual(paneCamerasOf("tab-a"), first)
  })

  it("keeps a pane's camera and its being active when the pane beside it closes", () => {
    const { tabId, setViewLayoutKind, setActivePane } = useEditor.getState()
    setViewLayoutKind("columns")
    setActivePane(1)
    const right = paneCamerasOf(tabId)[1]
    changePanes(paneClose(0))
    assert.strictEqual(paneCamerasOf(tabId)[0], right)
    assert.strictEqual(useEditor.getState().viewLayout.kind, "single")
    assert.strictEqual(useEditor.getState().activePane, 0)
  })

  it("makes the first pane left active when the active one closes", () => {
    const { setViewLayoutKind, setActivePane } = useEditor.getState()
    setViewLayoutKind("quad")
    setActivePane(3)
    changePanes(paneCloseColumn(3))
    assert.strictEqual(useEditor.getState().viewLayout.kind, "rows")
    assert.strictEqual(useEditor.getState().activePane, 0)
  })
})
