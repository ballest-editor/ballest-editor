import { assert, beforeEach, describe, it } from "@effect/vitest"
import { indexCatalog } from "../../domain/Catalog"
import { editTransform } from "../../domain/editTransform"
import { MIRROR_Y, mirrorFlagsOf } from "../../domain/mirror"
import { defaultSettings } from "../../domain/Settings"
import { annotationsOf } from "../../domain/structure"
import { catalogWithEnds, endAlongX, grouped, loadPieces } from "../../test/snapFixtures"
import { type PickedTarget, snapConfigOf, useEditor } from "../store"
import {
  addWorldAxis,
  addWorldPlane,
  alignSelection,
  applyFlipOffer,
  distributeSelection,
  gridOriginToSelection,
  gridYawToSelection,
  mirrorSelection,
  selectConnected,
  setFlushOptions,
  startAxisFromPoints,
  startFlush,
  startGridOriginPick,
  startMeasure,
  startPlaneFromPoints,
  updateSnap,
  updateSnapTarget
} from "./snapTools"

const load = (xs: ReadonlyArray<number>) => loadPieces(xs.map((x) => ({ x, y: 0, z: 0 })))

const xOf = (key: string) => {
  const { doc } = useEditor.getState()
  const item = doc.map.items[doc.ids.indexOf(key)]
  return item === undefined ? NaN : editTransform(item).translation.x
}

/** Answers the target picker's waiting request. */
const pickWith = (picked: Partial<PickedTarget> & Pick<PickedTarget, "point">) => {
  const { picker } = useEditor.getState()
  if (picker === null) return assert.fail("the picker isn't up")
  useEditor.getState().setPicker(null)
  picker.onPick({ label: "Target", ...picked })
}

describe("snap settings", () => {
  beforeEach(() => void load([0]))

  it("changes the tab's own, and leaves what a new map starts on", () => {
    updateSnap({ gridSize: 37 })
    updateSnapTarget("mesh", { offset: 5 })
    const s = useEditor.getState()
    assert.strictEqual(snapConfigOf(s).gridSize, 37)
    assert.strictEqual(snapConfigOf(s).targets.mesh.offset, 5)
    assert.strictEqual(s.settings.snapping.gridSize, defaultSettings.snapping.gridSize)
  })
})

describe("flush and tangent", () => {
  it("moves B so the faces are coplanar, with one undo step", () => {
    const [a = "", b = ""] = load([0, 1000])
    const before = useEditor.getState().past.length
    setFlushOptions({ mode: "flush", offset: 0 })
    startFlush()
    pickWith({ point: { x: 100, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, item: a })
    pickWith({ point: { x: 950, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, item: b })
    assert.closeTo(xOf(b), 150, 1e-6)
    assert.strictEqual(useEditor.getState().past.length, before + 1)
    assert.strictEqual(xOf(a), 0)
  })

  it("joins two ends when both picks are ends", () => {
    const [a = "", b = ""] = load([0, 1000])
    startFlush()
    pickWith({ point: { x: 100, y: 0, z: 0 }, item: a, end: endAlongX(a, 0, 100, 1) })
    pickWith({ point: { x: 900, y: 0, z: 0 }, item: b, end: endAlongX(b, 0, 900, -1) })
    assert.closeTo(xOf(b), 200, 1e-6)
  })
})

describe("flush inside an entered chain", () => {
  it("carries the links after the one it moves, as a drag does", () => {
    const [root = "", link = "", last = "", other = ""] = load([0, 1000, 2000, 5000])
    useEditor.getState().enterGroup(grouped([root, link, last], true))
    useEditor.getState().select([link])
    startFlush()
    pickWith({ point: { x: 4800, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, item: other })
    pickWith({ point: { x: 1000, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, item: link })
    assert.closeTo(xOf(link), 4800, 1e-6)
    assert.closeTo(xOf(last), 5800, 1e-6, "carried by the same move")
    assert.strictEqual(xOf(root), 0)
  })
})

describe("the grid's origin on a whole group", () => {
  it("goes where the gizmo sits, the group's pivot and not an item's", () => {
    const world = { x: 123, y: 45, z: 6 }
    useEditor.getState().setGroupPivot(grouped(load([0, 1000])), { choice: "point", world })
    gridOriginToSelection()
    assert.deepStrictEqual(snapConfigOf(useEditor.getState()).targets.grid.origin, world)
  })
})

describe("align and distribute", () => {
  it("aligns on the first selected", () => {
    const [a = "", b = ""] = load([0, 300])
    useEditor.getState().select([a, b])
    alignSelection("x", "centre", "first")
    assert.strictEqual(xOf(b), 0)
  })

  it("distributes with equal spacing as one step", () => {
    const [a = "", b = "", c = ""] = load([0, 100, 1000])
    useEditor.getState().select([a, b, c])
    const before = useEditor.getState().past.length
    distributeSelection("x", "spacing")
    assert.closeTo(xOf(b), 500, 1e-6)
    assert.strictEqual(useEditor.getState().past.length, before + 1)
  })
})

describe("measure", () => {
  it("keeps two clicks as a measurement and says the distance", () => {
    load([0])
    startMeasure()
    pickWith({ point: { x: 0, y: 0, z: 0 } })
    pickWith({ point: { x: 300, y: 400, z: 0 } })
    const s = useEditor.getState()
    assert.lengthOf(annotationsOf(s.doc.structure).measurements, 1)
    assert.strictEqual(s.toasts[0]?.title, "500 cm")
  })

  it("gives the angle for two faces", () => {
    load([0])
    startMeasure()
    pickWith({ point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } })
    pickWith({ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
    assert.closeTo(annotationsOf(useEditor.getState().doc.structure).measurements.at(-1)?.angle ?? 0, 90, 1e-9)
  })
})

describe("mirror", () => {
  it("reflects the selection in the plane, as one step", () => {
    const [a = ""] = load([300])
    useEditor.getState().select([a])
    const before = useEditor.getState().past.length
    mirrorSelection({ origin: { x: 100, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } })
    assert.closeTo(xOf(a), -100, 1e-6)
    assert.strictEqual(useEditor.getState().past.length, before + 1)
  })
})

describe("grid origin", () => {
  it("takes a picked point", () => {
    load([0])
    startGridOriginPick()
    pickWith({ point: { x: 137, y: 5, z: 0 } })
    assert.deepStrictEqual(snapConfigOf(useEditor.getState()).targets.grid.origin, { x: 137, y: 5, z: 0 })
  })

  it("goes to the selection's pivot, and takes its yaw", () => {
    const [a = ""] = load([250])
    useEditor.getState().select([a])
    gridOriginToSelection()
    gridYawToSelection()
    const { grid } = snapConfigOf(useEditor.getState()).targets
    assert.strictEqual(grid.origin.x, 250)
    assert.closeTo(grid.yaw, 0, 1e-9)
  })
})

describe("flip to fit", () => {
  const ends = [
    { position: [500, 200, 0], forward: [1, 0, 0], up: [0, 0, 1], profile: "Bevel_C", hand: "left" },
    { position: [-500, 200, 0], forward: [-1, 0, 0], up: [0, 0, 1], profile: "Bevel_C", hand: "right" }
  ]

  it("takes the mirrored twin and keeps its end on the one it joined, in one step", () => {
    const catalog = catalogWithEnds(ends)
    const [piece] = catalog.pieces
    if (piece === undefined) return assert.fail("no piece")
    const [a = "", b = ""] = load([0, 1000])
    const { doc } = useEditor.getState()
    const flippable = doc.map.items.map((item) => ({
      ...item,
      meshComponents: [],
      boolProperties: [{ propertyName: MIRROR_Y, propertyType: "Bool", currentValue: false }]
    }))
    useEditor.setState({ catalogIndex: indexCatalog(catalog), doc: { ...doc, map: { ...doc.map, items: flippable } } })
    const before = useEditor.getState().past.length
    useEditor.getState().setFlipOffer({
      keys: [b],
      axis: "y",
      own: { item: b, end: 1 },
      other: { item: a, end: 0 }
    })
    applyFlipOffer()
    const s = useEditor.getState()
    assert.strictEqual(s.past.length, before + 1)
    assert.isNull(s.flipOffer)
    const item = s.doc.map.items[s.doc.ids.indexOf(b)]
    if (item === undefined) return assert.fail("no item")
    assert.isTrue(mirrorFlagsOf(item).y)
    assert.closeTo(editTransform(item).translation.y, 400, 1e-6)
    assert.lengthOf(annotationsOf(s.doc.structure).joints, 1)
  })
})

describe("select connected", () => {
  it("walks the joints", () => {
    const [a = "", b = "", c = ""] = load([0, 500, 2000])
    const s = useEditor.getState()
    useEditor.setState({
      doc: {
        ...s.doc,
        structure: {
          ...s.doc.structure,
          annotations: {
            joints: [{ a: { item: a, end: 0 }, b: { item: b, end: 0 } }],
            construction: [],
            measurements: []
          }
        }
      }
    })
    useEditor.getState().select([a])
    selectConnected()
    assert.deepStrictEqual([...useEditor.getState().selectedIds].sort(), [a, b].sort())
    assert.notInclude(useEditor.getState().selectedIds, c)
  })
})

describe("construction", () => {
  it("adds world planes and axes through the grid's origin", () => {
    load([0])
    addWorldPlane("xy")
    addWorldAxis("z")
    const { construction } = annotationsOf(useEditor.getState().doc.structure)
    assert.deepStrictEqual(construction.map(({ name }) => name), ["Plane 1", "Axis 1"])
  })

  it("makes a plane from three picks and an axis from two", () => {
    load([0])
    startPlaneFromPoints()
    pickWith({ point: { x: 0, y: 0, z: 0 } })
    pickWith({ point: { x: 100, y: 0, z: 0 } })
    pickWith({ point: { x: 0, y: 100, z: 0 } })
    startAxisFromPoints()
    pickWith({ point: { x: 0, y: 0, z: 0 } })
    pickWith({ point: { x: 0, y: 0, z: 100 } })
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).construction, 2)
  })

  it("says so when the picks make nothing", () => {
    load([0])
    startAxisFromPoints()
    pickWith({ point: { x: 0, y: 0, z: 0 } })
    pickWith({ point: { x: 0, y: 0, z: 0 } })
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).construction, 0)
  })
})
