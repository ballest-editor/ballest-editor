import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { ueToThreeVector, type Vec3 } from "../domain/coords"
import { DEFAULT_PLAYER_START } from "../domain/level"
import { distanceForScale } from "../domain/orthoView"
import { gizmoEnds, gizmoTurnOf } from "../domain/viewGizmo"
import { type OrthoView, orthoViews, paneClose, paneCloseColumn, paneSwap } from "../domain/viewLayout"
import {
  changePanes,
  floorGridOnly,
  forgetClosedTabs,
  mapBox,
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

describe("a pane's placement view", () => {
  const closeTo = (actual: Vec3, expected: Vec3) => {
    for (const axis of ["x", "y", "z"] as const) assert.closeTo(actual[axis], expected[axis], 1e-9, axis)
  }

  it("has the screen's right and up in game axes, looking along +X", () => {
    const pane = paneOn("perspective")
    const eye = { x: 0, y: 0, z: 500 }
    const { x, y, z } = ueToThreeVector(eye)
    pane.perspective.position.set(x, y, z)
    const ahead = ueToThreeVector({ x: 1000, y: 0, z: 500 })
    pane.perspective.lookAt(ahead.x, ahead.y, ahead.z)
    const view = pane.placementView()
    assert.deepStrictEqual(view.position, eye)
    closeTo(view.right, { x: 0, y: 1, z: 0 })
    closeTo(view.up, { x: 0, y: 0, z: 1 })
  })

  it("matches where a step right lands on screen", () => {
    const pane = paneOn("perspective")
    pane.perspective.position.set(1000, 2000, 3000)
    pane.perspective.lookAt(0, 0, 0)
    const { right } = pane.placementView()
    const scale = 100
    const middle = onScreen(pane, { x: 0, y: 0, z: 0 })
    const stepped = onScreen(pane, { x: right.x * scale, y: right.y * scale, z: right.z * scale })
    assert.isAbove(stepped.x, middle.x)
  })

  it("is the orthographic camera's in an orthographic pane", () => {
    const { right, up } = paneOn("top").placementView()
    assert.closeTo(Math.hypot(right.x, right.y), 1, 1e-9)
    assert.closeTo(Math.hypot(up.x, up.y), 1, 1e-9)
    assert.closeTo(right.z, 0, 1e-9)
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

  it("frames a document with no items on the default start, where a definition's frame is", () => {
    const { doc, floorHeight } = useEditor.getState()
    useEditor.setState({ doc: { ...doc, map: { ...doc.map, items: [] } } })
    const centre = mapBox().getCenter(new THREE.Vector3())
    useEditor.setState({ doc })
    const { x, y, z } = ueToThreeVector({ ...DEFAULT_PLAYER_START, z: floorHeight })
    assert.deepStrictEqual(centre.toArray(), [x, y, z])
  })

  describe("following the store", () => {
    const framedOn = (view: OrthoView) => {
      const pane = paneOn(view)
      pane.frameMap(mapBox())
      return pane
    }

    it("frames the map on arriving from perspective, as a pane first shown there does", () => {
      const pane = paneOn("perspective")
      pane.needsFraming = false
      pane.perspective.position.set(40, 30, 40)
      pane.perspective.lookAt(0, 0, 0)
      pane.perspective.updateMatrixWorld()
      pane.followProjection("right")
      const first = framedOn("right")
      assert.closeTo(pane.cmPerPixel, first.cmPerPixel, 1e-9)
      assert.deepStrictEqual(pane.target.toArray(), first.target.toArray())
    })

    it("keeps the zoom between orthographic views", () => {
      const pane = framedOn("top")
      pane.zoomOrthographic(0.5, { x: WIDTH / 2, y: HEIGHT / 2 })
      const { cmPerPixel } = pane
      pane.followProjection("right")
      assert.strictEqual(pane.cmPerPixel, cmPerPixel)
    })

    it("does nothing while the view stays", () => {
      const pane = framedOn("top")
      pane.zoomOrthographic(0.5, { x: WIDTH / 2, y: HEIGHT / 2 })
      const { cmPerPixel } = pane
      pane.followProjection("top")
      assert.strictEqual(pane.cmPerPixel, cmPerPixel)
    })
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

describe("easing to a new view", () => {
  const MS = 150

  /** A framed perspective pane, three-quarters on to the origin. */
  const shownPane = () => {
    const pane = paneOn("perspective")
    pane.needsFraming = false
    pane.perspective.position.set(1500, 1200, 1500)
    pane.perspective.lookAt(0, 0, 0)
    pane.perspective.updateMatrixWorld()
    return pane
  }

  it("starts from the picture the pane was showing", () => {
    const pane = shownPane()
    const { position, quaternion } = pane.perspective.clone()
    pane.setProjection("right")
    pane.stepTween(1000, MS)
    assert.closeTo(pane.drawCamera.position.distanceTo(position), 0, 1e-6)
    assert.closeTo(pane.drawCamera.quaternion.angleTo(quaternion), 0, 1e-6)
  })

  it("draws with the view's own camera after 150 ms", () => {
    const pane = shownPane()
    pane.setProjection("right")
    pane.stepTween(1000, MS)
    pane.stepTween(1149, MS)
    assert.notStrictEqual(pane.drawCamera, pane.orthographic)
    pane.stepTween(1150, MS)
    assert.strictEqual(pane.drawCamera, pane.orthographic)
  })

  it("has the cameras there at once, for what picks and measures", () => {
    const pane = shownPane()
    pane.setProjection("top")
    assert.strictEqual(pane.view, "top")
    assert.strictEqual(pane.camera, pane.orthographic)
  })

  it("turns on the way, and most of the way early: it eases out", () => {
    const pane = shownPane()
    const start = pane.perspective.quaternion.clone()
    pane.setProjection("top")
    const end = pane.orthographic.quaternion
    pane.stepTween(1000, MS)
    pane.stepTween(1000 + MS / 2, MS)
    const turned = pane.drawCamera.quaternion.angleTo(start) / end.angleTo(start)
    assert.closeTo(turned, 0.875, 1e-6)
  })

  it("keeps the point it looks at the same size on the way", () => {
    const pane = shownPane()
    pane.setProjection("back")
    pane.stepTween(1000, MS)
    pane.stepTween(1060, MS)
    const camera = pane.drawCamera
    assert.instanceOf(camera, THREE.PerspectiveCamera)
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const shown = (2 * camera.position.distanceTo(pane.target) * Math.tan((camera.fov * Math.PI) / 360)) / HEIGHT
    assert.closeTo(shown, pane.cmPerPixel, pane.cmPerPixel * 1e-6)
  })

  it("goes back to perspective the same way", () => {
    const pane = shownPane()
    pane.setProjection("top")
    pane.stepTween(1000, MS)
    pane.stepTween(2000, MS)
    pane.setProjection("perspective")
    pane.stepTween(3000, MS)
    assert.notStrictEqual(pane.drawCamera, pane.perspective)
    pane.stepTween(3200, MS)
    assert.strictEqual(pane.drawCamera, pane.perspective)
  })

  it("picks up from where the picture is when the view changes again", () => {
    const pane = shownPane()
    pane.setProjection("top")
    pane.stepTween(1000, MS)
    pane.stepTween(1050, MS)
    const shown = pane.drawCamera.quaternion.clone()
    pane.setProjection("back")
    pane.stepTween(1060, MS)
    assert.closeTo(pane.drawCamera.quaternion.angleTo(shown), 0, 1e-6)
  })

  it("doesn't ease with animation off", () => {
    const pane = shownPane()
    pane.setProjection("right")
    pane.stepTween(1000, 0)
    assert.strictEqual(pane.drawCamera, pane.orthographic)
  })

  it("doesn't ease a pane that hasn't been shown yet", () => {
    const pane = paneOn("top")
    assert.strictEqual(pane.drawCamera, pane.orthographic)
  })

  it("sees the grid of the view it's heading for, and no sky", () => {
    const pane = shownPane()
    pane.setProjection("right")
    pane.stepTween(1000, MS)
    assert.isTrue(pane.drawCamera.layers.test(orthographicOnly))
    assert.isFalse(pane.drawCamera.layers.test(floorGridOnly))
    assert.isFalse(pane.drawCamera.layers.test(perspectiveOnly))
    pane.setProjection("perspective")
    pane.stepTween(1010, MS)
    assert.isTrue(pane.drawCamera.layers.test(floorGridOnly))
    assert.isFalse(pane.drawCamera.layers.test(orthographicOnly))
    assert.isFalse(pane.drawCamera.layers.test(perspectiveOnly))
  })
})

describe("orbiting a pane", () => {
  /** A pane on screen, looking at the origin from a three-quarter view. */
  const shownPerspective = () => {
    const pane = paneOn("perspective")
    pane.needsFraming = false
    pane.perspective.position.set(1000, 800, 1000)
    pane.perspective.lookAt(0, 0, 0)
    return pane
  }

  const shownOrtho = (view: OrthoView) => {
    const pane = paneOn(view)
    pane.needsFraming = false
    return pane
  }

  const drag = (pane: PaneCamera, dx: number, dy: number) => {
    const { yaw, pitch } = gizmoTurnOf(dx, dy)
    pane.orbit(yaw, pitch)
  }

  const pointingAtPivot = (pane: PaneCamera) => {
    const { perspective, target } = pane
    const forward = perspective.getWorldDirection(new THREE.Vector3())
    return forward.angleTo(target.clone().sub(perspective.position))
  }

  it("tilts an orthographic view into perspective at once, with nothing to ease", () => {
    for (const view of orthoViews) {
      const pane = shownOrtho(view)
      drag(pane, 12, 40)
      assert.strictEqual(pane.projection, "perspective")
      assert.isFalse(pane.easing)
      assert.strictEqual(pane.drawCamera, pane.perspective)
    }
  })

  it("stays on the pivot, at the size the orthographic view showed it", () => {
    for (const view of orthoViews) {
      const pane = shownOrtho(view)
      pane.target.set(300, 40, -200)
      drag(pane, 30, -30)
      const distance = distanceForScale(pane.cmPerPixel, HEIGHT, FOV)
      assert.closeTo(pane.perspective.position.distanceTo(pane.target), distance, 1e-6)
      assert.closeTo(pointingAtPivot(pane), 0, 1e-6)
    }
  })

  it("leaves the orbit to the store's view: following perspective afterwards changes nothing", () => {
    const pane = shownOrtho("right")
    drag(pane, 25, 10)
    const position = pane.perspective.position.clone()
    pane.followProjection("perspective")
    assert.isFalse(pane.easing)
    assert.deepStrictEqual(pane.perspective.position.toArray(), position.toArray())
  })

  it("carries the side of the gizmo facing the eye along with the pointer", () => {
    const facing = (pane: PaneCamera) => {
      const end = gizmoEnds(pane.screenAxes()).filter((e) => e.depth > 0).sort((a, b) => b.depth - a.depth)[0]
      if (end === undefined) throw new Error("No end faces the eye")
      return end
    }
    const across = shownPerspective()
    const { view, x } = facing(across)
    drag(across, 10, 0)
    const moved = gizmoEnds(across.screenAxes()).find((e) => e.view === view)
    assert.isAbove(moved?.x ?? -Infinity, x)

    const down = shownPerspective()
    const before = facing(down)
    drag(down, 0, 10)
    const lowered = gizmoEnds(down.screenAxes()).find((e) => e.view === before.view)
    assert.isBelow(lowered?.y ?? Infinity, before.y)
  })

  it("keeps the horizon level, however far it's dragged", () => {
    const pane = shownOrtho("front")
    drag(pane, 70, 40)
    drag(pane, -200, 90)
    drag(pane, 15, -300)
    const { right } = pane.screenAxes()
    assert.closeTo(right.z, 0, 1e-9)
  })

  it("stops short of looking straight down, and turns back from there", () => {
    const pane = shownPerspective()
    drag(pane, 0, 2000)
    const { toward } = pane.screenAxes()
    assert.isBelow(toward.z, 1)
    assert.isAbove(toward.z, 0.999)
    drag(pane, 0, -225)
    assert.closeTo(pane.screenAxes().toward.z, 0, 0.01)
  })

  it("turns a Top view around the world's up without dropping out of it", () => {
    const pane = shownOrtho("top")
    drag(pane, 225, 0)
    const { toward, right } = pane.screenAxes()
    assert.isAbove(toward.z, 0.999)
    assert.closeTo(Math.abs(right.x), 1, 0.01)
  })

  it("keeps a pivot that's off centre where it is in the picture", () => {
    const pane = shownPerspective()
    pane.target.set(200, 0, -150)
    const distance = pane.perspective.position.distanceTo(pane.target)
    const off = pointingAtPivot(pane)
    drag(pane, 40, 25)
    assert.closeTo(pane.perspective.position.distanceTo(pane.target), distance, 1e-6)
    assert.closeTo(pointingAtPivot(pane), off, 1e-6)
  })

  it("lets a snap already on its way finish, heading for where the drag has got to", () => {
    const pane = shownPerspective()
    pane.setProjection("top")
    pane.stepTween(1000, 150)
    assert.isTrue(pane.easing)
    drag(pane, 10, 10)
    assert.isTrue(pane.easing)
    pane.stepTween(1200, 150)
    assert.isFalse(pane.easing)
    assert.strictEqual(pane.drawCamera, pane.perspective)
  })
})

describe("a pane's screen axes", () => {
  it("say which way the game's axes run in an orthographic view", () => {
    const { right, up, toward } = paneOn("top").screenAxes()
    assert.closeTo(right.y, 1, 1e-9)
    assert.closeTo(up.x, 1, 1e-9)
    assert.closeTo(toward.z, 1, 1e-9)
  })

  it("match what the pane shows from any side", () => {
    for (const view of orthoViews) {
      const pane = paneOn(view)
      const { right, up } = pane.screenAxes()
      const centre = { x: WIDTH / 2, y: HEIGHT / 2 }
      const step = (axis: Vec3) => ({ x: axis.x * 100, y: axis.y * 100, z: axis.z * 100 })
      const scale = 100 / pane.cmPerPixel
      assert.closeTo(apart(onScreen(pane, step(right)), { x: centre.x + scale, y: centre.y }), 0, 1e-3)
      assert.closeTo(apart(onScreen(pane, step(up)), { x: centre.x, y: centre.y - scale }), 0, 1e-3)
    }
  })
})

describe("a rolled pane", () => {
  /** Front, rolled `roll` quarter turns clockwise, at 1 cm a pixel. */
  const rolledFront = (roll: 0 | 1 | 2 | 3) => {
    const pane = paneOn("front")
    pane.cmPerPixel = 1
    pane.followProjection("front", roll)
    pane.resize(WIDTH + 1, HEIGHT, FOV) // lays the camera out at that zoom
    pane.resize(WIDTH, HEIGHT, FOV)
    return pane
  }
  const centre = { x: WIDTH / 2, y: HEIGHT / 2 }

  it("turns the picture clockwise: what was up the screen runs to the right", () => {
    const pane = rolledFront(1)
    // upright, Front has Z up and +Y to the left
    assert.closeTo(apart(onScreen(pane, { x: 0, y: 0, z: 100 }), { x: centre.x + 100, y: centre.y }), 0, 1e-3)
    assert.closeTo(apart(onScreen(pane, { x: 0, y: 100, z: 0 }), { x: centre.x, y: centre.y - 100 }), 0, 1e-3)
    assert.closeTo(pane.orthographic.matrixWorld.determinant(), 1, 1e-9)
  })

  it("turns it back counter-clockwise", () => {
    const pane = rolledFront(3)
    assert.closeTo(apart(onScreen(pane, { x: 0, y: 0, z: 100 }), { x: centre.x - 100, y: centre.y }), 0, 1e-3)
  })

  it("slides along the screen as it's rolled", () => {
    const pane = rolledFront(1)
    const point = { x: 0, y: 40, z: 70 }
    const before = onScreen(pane, point)
    pane.slide(-30, -12)
    assert.closeTo(apart(onScreen(pane, point), { x: before.x + 30, y: before.y - 12 }), 0, 1e-3)
  })

  it("frames a box along its rolled sides", () => {
    // 4 m along Z, 1 m along Y: rolled, Z runs across the 800 px
    const box = boxOf({ x: 0, y: 0, z: 0 }, { x: 0, y: 100, z: 400 })
    const pane = rolledFront(1)
    pane.frame(box, 0)
    assert.closeTo(pane.cmPerPixel, (1.15 * 400) / WIDTH, 1e-9)
  })

  it("shows the gizmo's axes turned with it", () => {
    const { right, up } = rolledFront(1).screenAxes()
    assert.closeTo(right.z, 1, 1e-9)
    assert.closeTo(up.y, 1, 1e-9)
  })

  it("eases into the roll, keeping its centre and zoom", () => {
    const pane = rolledFront(0)
    pane.needsFraming = false
    const target = pane.target.clone()
    pane.followProjection("front", 1)
    assert.isTrue(pane.easing)
    assert.strictEqual(pane.cmPerPixel, 1)
    assert.closeTo(pane.target.distanceTo(target), 0, 1e-9)
  })

  it("opens into perspective upright", () => {
    const pane = rolledFront(1)
    pane.setProjection("perspective")
    assert.strictEqual(pane.roll, 0)
    const { up, right } = pane.screenAxes()
    assert.closeTo(up.z, 1, 1e-9)
    assert.closeTo(right.y, -1, 1e-9)
  })

  it("keeps a rolled Top view's heading in perspective", () => {
    const pane = paneOn("top")
    pane.followProjection("top", 1)
    pane.setProjection("perspective")
    // rolled clockwise, +X runs to the right of the screen; it still does looking down in perspective
    assert.closeTo(pane.screenAxes().right.x, 1, 1e-6)
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

  it("swaps two panes' cameras with their views, and the active pane moves with its camera", () => {
    const { tabId, setViewLayoutKind, setPaneProjection, setActivePane } = useEditor.getState()
    setViewLayoutKind("quad")
    setPaneProjection(0, "perspective")
    setPaneProjection(3, "right")
    setActivePane(3)
    const [first, , , last] = paneCamerasOf(tabId)
    changePanes(paneSwap("quad", 0, 3))
    assert.strictEqual(paneCamerasOf(tabId)[0], last)
    assert.strictEqual(paneCamerasOf(tabId)[3], first)
    assert.strictEqual(useEditor.getState().viewLayout.projections[0], "right")
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
