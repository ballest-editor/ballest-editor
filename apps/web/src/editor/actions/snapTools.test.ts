import { assert, beforeEach, describe, it } from "@effect/vitest"
import { indexCatalog } from "../../domain/Catalog"
import { editTransform } from "../../domain/editTransform"
import { MIRROR_X, MIRROR_Y, mirrorFlagsOf } from "../../domain/mirror"
import { defaultSettings } from "../../domain/Settings"
import { defaultSnapConfig, SNAP_PRESETS, withTargetMoved } from "../../domain/snapConfig"
import { defaultSnapPrefs } from "../../domain/snapPrefs"
import { annotationsOf, findGroup } from "../../domain/structure"
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
  pickGridSize,
  preferSnap,
  resetSnapDefaults,
  resetSnapToDefaults,
  saveSnapDefaults,
  selectConnected,
  setFlushOptions,
  setSnapTargets,
  snapDefaultsAreFactory,
  snapIsDefault,
  snapPreferenceOf,
  startAxisFromPoints,
  startFlush,
  startGridOriginPick,
  startMeasure,
  startPlaneFromPoints,
  toggleSnapping,
  updateSnap,
  updateSnapTarget
} from "./snapTools"
import { saveSettings } from "./startup"

const load = (xs: ReadonlyArray<number>) => loadPieces(xs.map((x) => ({ x, y: 0, z: 0 })))

const xOf = (key: string) => {
  const { doc } = useEditor.getState()
  const item = doc.map.items[doc.ids.indexOf(key)]
  return item === undefined ? NaN : editTransform(item).translation.x
}

const pointOf = (id: string) => {
  const pivot = findGroup(useEditor.getState().doc.structure.tree, id)?.pivot
  return pivot?.choice === "point" ? pivot.world : undefined
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

  it("turns snapping as a whole over without touching the grid's own toggle", () => {
    const config = () => snapConfigOf(useEditor.getState())
    const before = config().enabled
    toggleSnapping()
    assert.strictEqual(config().enabled, !before)
    assert.isTrue(config().targets.grid.enabled)
    updateSnapTarget("grid", { enabled: false })
    toggleSnapping()
    assert.strictEqual(config().enabled, before)
    assert.isFalse(config().targets.grid.enabled)
  })

  it("turns the grid on with the step it picks, and leaves snapping as a whole alone", () => {
    const config = () => snapConfigOf(useEditor.getState())
    const before = config().enabled
    updateSnapTarget("grid", { enabled: false })
    pickGridSize(50)
    assert.strictEqual(config().gridSize, 50)
    assert.isTrue(config().targets.grid.enabled)
    assert.strictEqual(config().enabled, before)
  })

  it("turns several targets on or off together and leaves the rest", () => {
    const config = () => snapConfigOf(useEditor.getState())
    setSnapTargets(["alignment", "tracking"], false)
    assert.isFalse(config().targets.alignment.enabled)
    assert.isFalse(config().targets.tracking.enabled)
    assert.isTrue(config().targets.mesh.enabled)
    setSnapTargets(["alignment", "tracking"], true)
    assert.isTrue(config().targets.alignment.enabled && config().targets.tracking.enabled)
  })

  it("prefers the grid or pieces with the order and an even pull, and calls anything else custom", () => {
    const config = () => snapConfigOf(useEditor.getState())
    assert.strictEqual(snapPreferenceOf(config()), "grid")
    updateSnapTarget("connectors", { weight: 4 })
    assert.isNull(snapPreferenceOf(config()), "a strong pull isn't either")
    preferSnap("pieces")
    assert.deepStrictEqual(config().order, SNAP_PRESETS.piecesFirst)
    assert.strictEqual(config().targets.connectors.weight, 1)
    assert.strictEqual(snapPreferenceOf(config()), "pieces")
    updateSnap({ order: withTargetMoved(config(), "grid", 2).order })
    assert.isNull(snapPreferenceOf(config()), "an order of the user's own")
    preferSnap("grid")
    assert.deepStrictEqual(config().order, SNAP_PRESETS.gridFirst)
  })

  it("saves the tab's settings as what new maps start on, and resets the tab to them", () => {
    const s = () => useEditor.getState()
    assert.isTrue(snapIsDefault(s()))
    updateSnap({ gridSize: 37, threshold: 20 })
    assert.isFalse(snapIsDefault(s()))
    void saveSnapDefaults()
    assert.strictEqual(s().settings.snapping.gridSize, 37)
    assert.isTrue(snapIsDefault(s()))
    updateSnapTarget("mesh", { offset: 5 })
    resetSnapToDefaults()
    assert.strictEqual(snapConfigOf(s()).targets.mesh.offset, defaultSettings.snapping.targets.mesh.offset)
    assert.strictEqual(snapConfigOf(s()).gridSize, 37, "back to the saved defaults")
    assert.isTrue(snapIsDefault(s()))
    void saveSettings(defaultSettings)
  })

  it("puts what new maps start on back to the factory's, and leaves your snapping as it is", () => {
    const s = () => useEditor.getState()
    void saveSettings({
      ...defaultSettings,
      snapping: { ...defaultSnapConfig, gridSize: 37 },
      snapPrefs: { ...defaultSnapPrefs, bodyDrag: "never" }
    })
    assert.isFalse(snapDefaultsAreFactory(s()))
    void resetSnapDefaults()
    assert.deepStrictEqual(s().settings.snapping, defaultSnapConfig)
    assert.isTrue(snapDefaultsAreFactory(s()))
    assert.strictEqual(s().settings.snapPrefs.bodyDrag, "never")
    void saveSettings(defaultSettings)
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

  it("aligns a whole group by its box, which keeps its spacing", () => {
    const [a = "", b = "", c = ""] = load([0, 1000, 5000])
    grouped([a, b])
    useEditor.getState().select([c, a, b])
    alignSelection("x", "min", "first")
    assert.closeTo(xOf(a), 5000, 1e-6)
    assert.closeTo(xOf(b), 6000, 1e-6)
    assert.strictEqual(xOf(c), 5000)
    useEditor.getState().undo()
    alignSelection("x", "max", "bounds")
    assert.closeTo(xOf(a), 4000, 1e-6, "the group's far side on the box's")
    assert.closeTo(xOf(b), 5000, 1e-6)
    assert.strictEqual(xOf(c), 5000)
  })

  it("aligns on the first selected unit whichever comes first in the tree", () => {
    const [a = "", b = "", c = ""] = load([0, 1000, 5000])
    grouped([a, b])
    useEditor.getState().select([a, b, c])
    alignSelection("x", "max", "first")
    assert.closeTo(xOf(c), 1000, 1e-6, "on the group's far side, not its first item's")
    assert.strictEqual(xOf(a), 0)
    assert.strictEqual(xOf(b), 1000)
  })

  it("spreads a whole group as one unit, by equal spacing or equal gaps", () => {
    const [a = "", b = "", c = "", d = ""] = load([0, 400, 1000, 5000])
    grouped([a, b])
    useEditor.getState().select([a, b, c, d])
    distributeSelection("x", "spacing")
    assert.closeTo(xOf(c), 2600, 1e-6, "halfway from the group's centre to the last")
    assert.strictEqual(xOf(a), 0)
    assert.strictEqual(xOf(b), 400)
    assert.strictEqual(xOf(d), 5000)
    const [e = "", f = "", g = "", h = ""] = load([1000, 1400, 0, 5000])
    grouped([e, f])
    useEditor.getState().select([e, f, g, h])
    distributeSelection("x", "gaps")
    assert.closeTo(xOf(e), 2300, 1e-6, "the middle unit between the outer two, whatever a piece's size")
    assert.closeTo(xOf(f), 2700, 1e-6)
  })

  it("leaves one whole group alone, which has nothing to line up on", () => {
    const [a = "", b = "", c = ""] = load([0, 400, 1000])
    grouped([a, b, c])
    useEditor.getState().select([a, b, c])
    const before = useEditor.getState().past.length
    alignSelection("x", "min", "bounds")
    distributeSelection("x", "spacing")
    assert.lengthOf(useEditor.getState().past, before)
  })

  it("takes a Point along with its whole group", () => {
    const [a = "", b = "", c = ""] = load([0, 1000, 5000])
    const id = grouped([a, b])
    useEditor.getState().setGroupPivot(id, { choice: "point", world: { x: 10, y: 20, z: 30 } })
    useEditor.getState().select([c, a, b])
    alignSelection("x", "min", "first")
    assert.deepStrictEqual(pointOf(id), { x: 5010, y: 20, z: 30 })
  })

  it("carries the links after a selected link inside an entered chain, up to the next selected one", () => {
    const [root = "", one = "", two = "", three = ""] = load([0, 1000, 2000, 3000])
    useEditor.getState().enterGroup(grouped([root, one, two, three], true))
    useEditor.getState().select([three, one])
    alignSelection("x", "min", "first")
    assert.strictEqual(xOf(root), 0)
    assert.closeTo(xOf(one), 3000, 1e-6)
    assert.closeTo(xOf(two), 4000, 1e-6, "carried by the link before it")
    assert.strictEqual(xOf(three), 3000, "a selected link takes its own offset, here none")
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

  const acrossX = (x: number) => ({ origin: { x, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } })
  /** Items that can flip: a stored flag is what says so for a class the catalog lists none on. */
  const loadFlippable = (xs: ReadonlyArray<number>) => {
    const keys = load(xs)
    const { doc } = useEditor.getState()
    const items = doc.map.items.map((item) => ({
      ...item,
      meshComponents: [],
      boolProperties: [{ propertyName: MIRROR_X, propertyType: "Bool", currentValue: false }]
    }))
    useEditor.setState({ doc: { ...doc, map: { ...doc.map, items } } })
    return keys
  }
  const flipped = (key: string) => {
    const { doc } = useEditor.getState()
    const item = doc.map.items[doc.ids.indexOf(key)]
    return item !== undefined && mirrorFlagsOf(item).x
  }

  const world = { x: 500, y: 40, z: 0 }
  /** Two items that can flip, grouped on a Point at `world`. */
  const pointGroup = () => {
    const [a = "", b = ""] = loadFlippable([300, 700])
    const id = grouped([a, b])
    useEditor.getState().setGroupPivot(id, { choice: "point", world })
    return { a, b, id }
  }

  it("reflects a whole group item by item, and its Point with it, as one step", () => {
    const { a, b, id } = pointGroup()
    useEditor.getState().select([a, b])
    const before = useEditor.getState().past.length
    mirrorSelection(acrossX(100))
    assert.closeTo(xOf(a), -100, 1e-6)
    assert.closeTo(xOf(b), -500, 1e-6, "its spacing, the other way")
    assert.isTrue(flipped(a) && flipped(b))
    assert.deepStrictEqual(pointOf(id), { x: -300, y: 40, z: 0 })
    assert.lengthOf(useEditor.getState().past, before + 1)
    useEditor.getState().undo()
    assert.deepStrictEqual(pointOf(id), world)
  })

  it("leaves the Point of a group it only took part of", () => {
    const { a, id } = pointGroup()
    useEditor.getState().enterGroup(id)
    useEditor.getState().select([a])
    mirrorSelection(acrossX(100))
    assert.deepStrictEqual(pointOf(id), world)
  })

  it("reflects the links a selected link carries inside an entered chain, even one sitting on the plane", () => {
    const [root = "", one = "", two = ""] = loadFlippable([0, 1000, 1500])
    useEditor.getState().enterGroup(grouped([root, one, two], true))
    useEditor.getState().select([one])
    mirrorSelection(acrossX(1000))
    assert.strictEqual(xOf(root), 0)
    assert.isFalse(flipped(root))
    assert.closeTo(xOf(one), 1000, 1e-6)
    assert.closeTo(xOf(two), 500, 1e-6)
    assert.isTrue(flipped(one) && flipped(two), "carried, and mirrored like the link that carries it")
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
    const [a = "", b = "", companion = ""] = load([0, 1000, 1500])
    const { doc } = useEditor.getState()
    const flippable = doc.map.items.map((item) => ({
      ...item,
      meshComponents: [],
      boolProperties: [{ propertyName: MIRROR_Y, propertyType: "Bool", currentValue: false }]
    }))
    useEditor.setState({ catalogIndex: indexCatalog(catalog), doc: { ...doc, map: { ...doc.map, items: flippable } } })
    const before = useEditor.getState().past.length
    useEditor.getState().setFlipOffer({
      keys: [b, companion],
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
    assert.isFalse(mirrorFlagsOf(s.doc.map.items[s.doc.ids.indexOf(companion)]!).y)
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
