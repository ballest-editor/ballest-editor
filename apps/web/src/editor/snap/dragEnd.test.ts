// @vitest-environment jsdom
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest"
import { act, createElement, Fragment } from "react"
import * as THREE from "three"
import { vi } from "vitest"
import { identityTransform } from "../../domain/factory"
import { defaultSnapConfig, type SnapConfig } from "../../domain/snapConfig"
import { reactRootPerTest } from "../../test/reactRoot"
import { catalogWithEnds, DOWN_PANE_SIZE, loadPieces, lookDown } from "../../test/snapFixtures"
import { GizmoController } from "../gizmo/GizmoController"
import { paneCameraAt } from "../paneCameras"
import { sceneRegistry } from "../sceneRegistry"
import { useEditor } from "../store"
import { landDrop } from "./pieceDrop"
import { SnapInput } from "./SnapInput"

/** The canvas the viewport would give both controllers, and what a frame runs. */
const scene = vi.hoisted(() => ({ canvas: document.createElement("canvas"), frame: () => {} }))

vi.mock("@react-three/fiber", async (importActual) => ({
  ...await importActual<object>(),
  useThree: (pick: (state: { readonly gl: { readonly domElement: HTMLCanvasElement } }) => unknown) =>
    pick({ gl: { domElement: scene.canvas } }),
  useFrame: (run: () => void) => {
    scene.frame = run
  }
}))

// jsdom has no matchMedia, and the gizmo's colours don't matter here
vi.mock("../theme", async (importActual) => ({ ...await importActual<object>(), useDarkTheme: () => true }))

// what's under the pointer is pickTarget's to work out; here there's always a point to acquire
vi.mock("./pickTarget", async (importActual) => ({
  ...await importActual<object>(),
  anchorUnder: () => ({ landing: { x: 100, y: 100, z: 0 }, label: "Corner of Track S" })
}))

const CENTRE = DOWN_PANE_SIZE / 2
const ACQUIRED = { at: { x: 900, y: 900, z: 0 }, label: "Corner of Kicker" }
const TRACKING = { ...defaultSnapConfig.targets.tracking, enabled: true, acquire: "auto" } as const
const REST_MS = TRACKING.hoverMs + 1

/** Puts an item in the scene for the pointer to press. */
const place = (key: string) => {
  const body = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200))
  body.userData["itemId"] = key
  const root = new THREE.Group()
  root.add(body)
  root.updateMatrixWorld(true)
  sceneRegistry.itemsRoot = root
  sceneRegistry.objects.set(key, body)
}

const pointer = (type: string, x: number, y: number, buttons: number) =>
  act(() => {
    scene.canvas.dispatchEvent(
      new PointerEvent(type, { button: 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true })
    )
  })

const escape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", cancelable: true }))
  })

const dom = reactRootPerTest()

/** The pixel of the first gizmo handle out from the centre. */
const handlePixel = (): { readonly x: number; readonly y: number } => {
  for (let by = 10; by < 300; by += 5) {
    for (const at of [{ x: CENTRE + by, y: CENTRE }, { x: CENTRE, y: CENTRE - by }]) {
      pointer("pointermove", at.x, at.y, 0)
      if (sceneRegistry.gizmoActive()) return at
    }
  }
  throw new Error("no handle under any pixel tried")
}

/** Each way of dragging the item at the origin, up to the point it could land. */
const dragging = {
  "by its body": () => {
    useEditor.getState().setTool("select")
    act(() => scene.frame())
    pointer("pointerdown", CENTRE, CENTRE, 1)
    pointer("pointermove", CENTRE + 40, CENTRE + 30, 1)
    pointer("pointermove", CENTRE + 90, CENTRE + 70, 1)
  },
  "by a gizmo handle": () => {
    act(() => scene.frame())
    const at = handlePixel()
    pointer("pointerdown", at.x, at.y, 1)
    pointer("pointermove", at.x + 40, at.y + 30, 1)
    pointer("pointermove", at.x + 90, at.y + 70, 1)
  }
}

/** What was acquired each time the document changed. */
let atCommit: Array<number> = []
let stopWatching = () => {}

/** A map of one piece of the catalog's `piece` at the origin, selected, with a point acquired, under both controllers. */
const setUp = (snap: Partial<SnapConfig> = {}, piece = 0) => {
  vi.useFakeTimers()
  vi.spyOn(scene.canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, DOWN_PANE_SIZE, DOWN_PANE_SIZE))
  // jsdom has no pointer capture
  scene.canvas.hasPointerCapture = () => false
  const [key = ""] = loadPieces([{ x: 0, y: 0, z: 0 }], piece)
  const s = useEditor.getState()
  s.setTabSnap({
    ...defaultSnapConfig,
    enabled: true,
    targets: { ...defaultSnapConfig.targets, tracking: TRACKING },
    ...snap
  })
  s.setTool("translate")
  s.select([key])
  s.acquireTracked(ACQUIRED)
  lookDown(paneCameraAt(0))
  place(key)
  atCommit = []
  stopWatching = useEditor.subscribe((now, before) => {
    if (now.doc !== before.doc) atCommit.push(now.tracked.length)
  })
  act(() => dom.root.render(createElement(Fragment, null, createElement(GizmoController), createElement(SnapInput))))
}

const tearDown = () => {
  stopWatching()
  sceneRegistry.itemsRoot = null
  sceneRegistry.objects.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
}

describe.each(Object.entries(dragging))("a drag %s", (_kind, drag) => {
  beforeEach(() => setUp())
  afterEach(tearDown)

  it("lets go of the acquired points once it has landed, not before", () => {
    drag()
    assert.lengthOf(useEditor.getState().tracked, 1)
    pointer("pointerup", CENTRE, CENTRE, 0)
    assert.deepStrictEqual(atCommit, [1])
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  it("lets go of them when Escape cancels it", () => {
    drag()
    escape()
    assert.deepStrictEqual(atCommit, [])
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  it.each(["pointercancel", "lostpointercapture"])("lets go of them, and lands nothing, when %s ends it", (type) => {
    drag()
    assert.isNotNull(useEditor.getState().preview)
    pointer(type, CENTRE, CENTRE, 0)
    assert.isNull(useEditor.getState().preview, "the preview goes")
    assert.lengthOf(useEditor.getState().tracked, 0)
    assert.isFalse(sceneRegistry.gizmoDragActive(), "the drag is over")
    pointer("pointerup", CENTRE, CENTRE, 0)
    assert.deepStrictEqual(atCommit, [], "nothing lands after")
  })

  it("lets go of them when the viewport goes with it still in hand", () => {
    drag()
    act(() => dom.root.render(null))
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  it("lets go of what it acquired along the way", () => {
    drag()
    vi.advanceTimersByTime(REST_MS)
    assert.lengthOf(useEditor.getState().tracked, 2)
    pointer("pointerup", CENTRE, CENTRE, 0)
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  it.each([
    ["landing", () => pointer("pointerup", CENTRE, CENTRE, 0)],
    ["Escape", escape]
  ])("acquires nothing after %s from a pause it began before", (_, finish) => {
    drag()
    finish()
    vi.advanceTimersByTime(REST_MS)
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  it("keeps them through a click that never became a drag", () => {
    act(() => scene.frame())
    const at = _kind === "by a gizmo handle" ? handlePixel() : { x: CENTRE, y: CENTRE }
    pointer("pointerdown", at.x, at.y, 1)
    pointer("pointerup", at.x, at.y, 0)
    assert.lengthOf(useEditor.getState().tracked, 1)
  })

  it("leaves the next idle hover to acquire as ever", () => {
    drag()
    pointer("pointerup", CENTRE, CENTRE, 0)
    vi.advanceTimersByTime(REST_MS)
    pointer("pointermove", CENTRE + 200, CENTRE + 200, 0)
    vi.advanceTimersByTime(REST_MS)
    assert.lengthOf(useEditor.getState().tracked, 1)
  })
})

describe("a press and drag on an item's body", () => {
  afterEach(tearDown)

  const bodyDrag = () => {
    useEditor.getState().setTool("select")
    pointer("pointerdown", CENTRE, CENTRE, 1)
    pointer("pointermove", CENTRE + 40, CENTRE + 30, 1)
    const moving = useEditor.getState().preview !== null
    pointer("pointerup", CENTRE + 40, CENTRE + 30, 0)
    return moving
  }

  it.each(
    [
      ["ends", "a piece with ends", 0, true],
      ["ends", "a piece with no ends", 1, false],
      ["always", "a piece with no ends", 1, true],
      ["never", "a piece with ends", 0, false]
    ] as const
  )("with %s, on %s, moves it: %s", (setting, _piece, piece, moves) => {
    setUp({ bodyDrag: setting }, piece)
    assert.strictEqual(bodyDrag(), moves)
    assert.lengthOf(atCommit, moves ? 1 : 0)
  })

  it("with ends, leaves it be while snapping is off", () => {
    setUp({ enabled: false })
    assert.isFalse(bodyDrag())
    assert.lengthOf(atCommit, 0)
  })
})

describe("a palette drop", () => {
  beforeEach(() => setUp())
  afterEach(tearDown)

  it.each([["snapping on", false], ["snapping inverted off", true]])(
    "lets go of the acquired points, %s",
    (_, invert) => {
      const piece = catalogWithEnds().pieces[0] ?? assert.fail("the bundled catalog is empty")
      const pane = lookDown(paneCameraAt(0))
      act(() =>
        landDrop(piece, pane, { x: CENTRE + 600, y: CENTRE }, { x: 0, y: 600, z: 0 }, invert, () => {
          useEditor.getState().placePiece(piece, identityTransform({ x: 0, y: 600, z: 0 }))
        })
      )
      assert.deepStrictEqual(atCommit, [1], "it landed with them still there")
      assert.lengthOf(useEditor.getState().tracked, 0)
    }
  )
})
