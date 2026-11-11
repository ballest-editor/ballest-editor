import { assert, beforeEach, describe, it } from "@effect/vitest"
import { indexCatalog } from "../../domain/Catalog"
import { editTransform } from "../../domain/editTransform"
import { itemsBoxOf } from "../../domain/itemBounds"
import { MIRROR_X, MIRROR_Y, mirrorFlagsOf } from "../../domain/mirror"
import { defaultSettings } from "../../domain/Settings"
import { defaultSnapConfig, SNAP_PRESETS, withTargetMoved } from "../../domain/snapConfig"
import { defaultSnapPrefs } from "../../domain/snapPrefs"
import { annotationsOf, findGroup } from "../../domain/structure"
import { rotatorToQuat } from "../../domain/ueMath"
import { catalogWithEnds, endAlongX, grouped, loadPieces, lookDown } from "../../test/snapFixtures"
import { activePaneCamera } from "../paneCameras"
import { type PickedTarget, snapConfigOf, useEditor } from "../store"
import { flipSelection, setSelectionUnitField } from "./selection"
import {
  addWorldAxis,
  addWorldPlane,
  alignSelection,
  applyFlipOffer,
  arrangePlanOf,
  distributeSelection,
  gridOriginToSelection,
  gridYawToSelection,
  mirrorSelection,
  pickGridSize,
  preferSnap,
  resetSnapDefaults,
  resetSnapToDefaults,
  saveSnapDefaults,
  screenAlignOf,
  selectConnected,
  setArrangeSpacing,
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

/** Where the item `key` stands along `axis`. */
const standing = (key: string, axis: "x" | "y") => {
  const { doc } = useEditor.getState()
  const item = doc.map.items[doc.ids.indexOf(key)]
  return item === undefined ? NaN : editTransform(item).translation[axis]
}

const xOf = (key: string) => standing(key, "x")

const yOf = (key: string) => standing(key, "y")

/** Turns the item `key` to `yaw` degrees where it stands. */
const turn = (key: string, yaw: number) => {
  const { doc } = useEditor.getState()
  const item = doc.map.items[doc.ids.indexOf(key)]
  if (item === undefined) return assert.fail("no such item")
  const rotation = rotatorToQuat({ pitch: 0, yaw, roll: 0 })
  useEditor.getState().transformItems(new Map([[key, { ...editTransform(item), rotation }]]))
}

/** The test piece's length along X. */
const arrangeWidth = () => {
  const { catalogIndex, doc } = useEditor.getState()
  const box = itemsBoxOf(doc.map.items.slice(0, 1), catalogIndex)
  return box === undefined ? NaN : box.max.x - box.min.x
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
  it("aligns on the active item, the last selected", () => {
    const [a = "", b = ""] = load([0, 300])
    useEditor.getState().select([a, b])
    alignSelection("x", "centre", "active")
    assert.strictEqual(xOf(a), 300)
    assert.strictEqual(xOf(b), 300)
  })

  it("distributes with equal centre steps as one step", () => {
    const [a = "", b = "", c = ""] = load([0, 100, 1000])
    useEditor.getState().select([a, b, c])
    const before = useEditor.getState().past.length
    distributeSelection("x", "centres")
    assert.closeTo(xOf(b), 500, 1e-6)
    assert.strictEqual(useEditor.getState().past.length, before + 1)
  })

  it("aligns a whole group by its box, which keeps its spacing", () => {
    const [a = "", b = "", c = ""] = load([0, 1000, 5000])
    grouped([a, b])
    useEditor.getState().select([a, b, c])
    alignSelection("x", "min", "active")
    assert.closeTo(xOf(a), 5000, 1e-6)
    assert.closeTo(xOf(b), 6000, 1e-6)
    assert.strictEqual(xOf(c), 5000)
    useEditor.getState().undo()
    alignSelection("x", "max", "bounds")
    assert.closeTo(xOf(a), 4000, 1e-6, "the group's far side on the box's")
    assert.closeTo(xOf(b), 5000, 1e-6)
    assert.strictEqual(xOf(c), 5000)
  })

  it("aligns on the active item's whole unit whichever comes first in the tree", () => {
    const [a = "", b = "", c = ""] = load([0, 1000, 5000])
    grouped([a, b])
    useEditor.getState().select([c, a, b])
    alignSelection("x", "max", "active")
    assert.closeTo(xOf(c), 1000, 1e-6, "on the group's far side, not its last item's")
    assert.strictEqual(xOf(a), 0)
    assert.strictEqual(xOf(b), 1000)
  })

  it("spreads a whole group as one unit, by equal centre steps or equal gaps", () => {
    const [a = "", b = "", c = "", d = ""] = load([0, 400, 1000, 5000])
    grouped([a, b])
    useEditor.getState().select([a, b, c, d])
    distributeSelection("x", "centres")
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
    distributeSelection("x", "centres")
    assert.lengthOf(useEditor.getState().past, before)
  })

  it("takes a Point along with its whole group", () => {
    const [a = "", b = "", c = ""] = load([0, 1000, 5000])
    const id = grouped([a, b])
    useEditor.getState().setGroupPivot(id, { choice: "point", world: { x: 10, y: 20, z: 30 } })
    useEditor.getState().select([a, b, c])
    alignSelection("x", "min", "active")
    assert.deepStrictEqual(pointOf(id), { x: 5010, y: 20, z: 30 })
  })

  it("stacks the selection out from the active item with a fixed spacing of 0, two units as well as more", () => {
    const [a = "", b = ""] = load([0, 3000])
    useEditor.getState().select([b, a])
    setArrangeSpacing(0)
    distributeSelection("x", "gaps")
    setArrangeSpacing(null)
    assert.strictEqual(xOf(a), 0, "the active item stays")
    const width = arrangeWidth()
    assert.closeTo(xOf(b), width, 1e-6, "touching it")
  })

  it("works along the active item's own axes with the gizmo in Local", () => {
    const [a = "", b = ""] = loadPieces([{ x: 0, y: 0, z: 0 }, { x: 1000, y: 700, z: 0 }])
    turn(b, 90)
    useEditor.setState({ gizmoSpace: "local" })
    useEditor.getState().select([a, b])
    alignSelection("x", "centre", "active")
    useEditor.setState({ gizmoSpace: "world" })
    assert.closeTo(yOf(a), 700, 1e-6, "along the active item's X, which is the world's Y")
    assert.closeTo(xOf(a), 0, 1e-6)
  })

  it("previews nothing it wouldn't do, and what it would do in the world", () => {
    const [a = "", b = ""] = load([0, 300])
    useEditor.getState().select([a, b])
    const align = { kind: "align", axis: "x", side: "min", to: "active" } as const
    const plan = arrangePlanOf(useEditor.getState(), align)
    assert.strictEqual(plan?.moving, 1)
    assert.deepStrictEqual(plan?.marks.paths.map(({ from, to }) => to.x - from.x), [300])
    alignSelection("x", "min", "active")
    assert.strictEqual(arrangePlanOf(useEditor.getState(), align)?.moving, 0)
    useEditor.getState().select([a])
    assert.isUndefined(arrangePlanOf(useEditor.getState(), align), "one unit has nothing to line up on")
  })

  it("lines up by screen direction along the axis that runs most nearly that way", () => {
    const [a = "", b = ""] = load([0, 300])
    useEditor.getState().select([a, b])
    const pane = lookDown(activePaneCamera())
    const { right } = pane.screenAxes()
    const toRight = screenAlignOf(useEditor.getState(), "right")
    const toLeft = screenAlignOf(useEditor.getState(), "left")
    assert.notStrictEqual(toRight.axis, "z", "looking down, right is across the ground")
    assert.strictEqual(toLeft.axis, toRight.axis)
    assert.notStrictEqual(toLeft.kind === "align" && toLeft.side, toRight.kind === "align" && toRight.side)
    const along = { x: 0, y: 0, z: 0, [toRight.axis]: toRight.kind === "align" && toRight.side === "max" ? 1 : -1 }
    assert.isAbove(along.x * right.x + along.y * right.y + along.z * right.z, 0.5)
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

  it("flips a whole group by mirroring its layout about its pivot, along the group's own axis", () => {
    const [a = "", b = ""] = loadFlippable([300, 700])
    grouped([a, b])
    useEditor.getState().select([a, b])
    flipSelection("x")
    assert.closeTo(xOf(a), 700, 1e-6, "across the centre")
    assert.closeTo(xOf(b), 300, 1e-6)
    assert.isTrue(flipped(a) && flipped(b))
    flipSelection("x")
    // turned a quarter, the group's X is the world's Y: it mirrors along that, not the world's X
    setSelectionUnitField("rotation", { x: 0, y: 0, z: 90 })
    const [ya, yb] = [yOf(a), yOf(b)]
    flipSelection("x")
    assert.closeTo(yOf(a), yb, 1e-6, "a goes where b was")
    assert.closeTo(yOf(b), ya, 1e-6)
    assert.closeTo(xOf(a), xOf(b), 1e-6, "still in a line along the group's X")
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
