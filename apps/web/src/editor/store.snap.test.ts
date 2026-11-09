import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { identityTransform } from "../domain/factory"
import type { RigidDelta } from "../domain/groupTransform"
import type { GroupPivot } from "../domain/MapSidecar"
import { PrefabFile } from "../domain/PrefabFile"
import { defaultSettings } from "../domain/Settings"
import { defaultSnapConfig } from "../domain/snapConfig"
import { annotationsOf, findGroup } from "../domain/structure"
import { ORIGIN, rotatorToQuat } from "../domain/ueMath"
import { PREFAB_TEXT } from "../test/prefabs"
import { grouped, loadPieces } from "../test/snapFixtures"
import { assertVec } from "../test/vec"
import { previewMove } from "./snap/moveSession"
import { selectionPivot, shownPivotDots, shownPivotPoint, shownTransform, snapConfigOf, useEditor } from "./store"

/** Two pieces whose near ends meet, and a third some way off. */
const load = () => {
  const [a = "", b = "", c = ""] = loadPieces([{ x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }])
  return { a, b, c }
}

/** Moves `b` away and back with a connector snap, so its end joins `a`'s. */
const join = (b: string) => {
  useEditor.getState().transformItems(new Map([[b, identityTransform({ x: 900, y: 0, z: 0 })]]))
  useEditor.getState().transformItems(new Map([[b, identityTransform({ x: 500, y: 0, z: 0 })]]), { connected: true })
}

describe("a map's snap settings", () => {
  beforeEach(() => void load())

  it("follows the defaults until the map has its own", () => {
    assert.deepStrictEqual(snapConfigOf(useEditor.getState()), defaultSettings.snapping)
    useEditor.getState().setTabSnap({ ...defaultSnapConfig, gridSize: 37 })
    assert.strictEqual(snapConfigOf(useEditor.getState()).gridSize, 37)
  })

  it("is an unsaved change of the map, and not a step of its history", () => {
    useEditor.getState().setTabSnap({ ...defaultSnapConfig, gridSize: 37 })
    const s = useEditor.getState()
    assert.isTrue(s.dirty)
    assert.lengthOf(s.past, 0)
  })

  it("leaves a blank tab blank, which has nothing to lose", () => {
    useEditor.getState().loadMap(useEditor.getState().doc.map, null, undefined, { fresh: true })
    useEditor.getState().setTabSnap({ ...defaultSnapConfig, gridSize: 37 })
    assert.isFalse(useEditor.getState().dirty)
    assert.strictEqual(snapConfigOf(useEditor.getState()).gridSize, 37)
  })

  it("stays unsaved through an undo back to the saved document", () => {
    const { a } = { a: useEditor.getState().doc.ids[0] ?? "" }
    useEditor.getState().setTabSnap({ ...defaultSnapConfig, gridSize: 37 })
    useEditor.getState().transformItems(new Map([[a, identityTransform({ x: -100, y: 0, z: 0 })]]))
    useEditor.getState().undo()
    assert.isTrue(useEditor.getState().dirty)
  })

  it("is clean again once saved", () => {
    useEditor.getState().setTabSnap({ ...defaultSnapConfig, gridSize: 37 })
    const s = useEditor.getState()
    s.markSaved(s.tabId, s.doc, s.doc.map, { name: "x.balledit", path: null }, s.snap)
    assert.isFalse(useEditor.getState().dirty)
  })

  it("doesn't dirty a definition, which keeps them in the editor's prefs", () => {
    useEditor.setState({
      document: {
        kind: "prefab",
        tier: "user",
        name: "P",
        hash: "",
        file: Schema.decodeSync(Schema.fromJsonString(PrefabFile))(PREFAB_TEXT),
        sources: new Map()
      }
    })
    useEditor.getState().setTabSnap({ ...defaultSnapConfig, gridSize: 37 })
    assert.isFalse(useEditor.getState().dirty)
  })
})

describe("joints on commit", () => {
  it("records what a connector snap joined, as part of the step", () => {
    const { a, b } = load()
    const s = useEditor.getState()
    s.transformItems(new Map([[b, identityTransform({ x: 500, y: 0, z: 0 })]]), { connected: true })
    // the same place: nothing moved, so no step, and nothing to record
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).joints, 0)
    join(b)
    const joints = annotationsOf(useEditor.getState().doc.structure).joints
    assert.deepStrictEqual(joints, [{ a: { item: b, end: 1 }, b: { item: a, end: 0 } }])
    useEditor.getState().undo()
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).joints, 0)
  })

  it("drops a joint when either item moves away", () => {
    const { b } = load()
    join(b)
    useEditor.getState().transformItems(new Map([[b, identityTransform({ x: 800, y: 0, z: 0 })]]))
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).joints, 0)
  })

  it("drops a joint when either item is deleted", () => {
    const { b } = load()
    join(b)
    useEditor.getState().select([b])
    useEditor.getState().deleteSelection()
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).joints, 0)
  })
})

describe("where an end connects", () => {
  it("moves the end to the chosen spot as one named step, taking apart a joint it leaves", () => {
    const { b } = load()
    join(b)
    useEditor.getState().setConnectAt(b, 1, "topLeft")
    const s = useEditor.getState()
    assert.deepStrictEqual(s.doc.structure.items.get(b)?.connectAt, { "1": "topLeft" })
    assert.lengthOf(annotationsOf(s.doc.structure).joints, 0)
    assert.match(s.past.at(-1)?.description ?? "", /^Connect .+ at top left$/)
    useEditor.getState().undo()
    assert.isUndefined(useEditor.getState().doc.structure.items.get(b)?.connectAt)
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).joints, 1)
  })

  it("keeps no choice for the spot an end connects at already, and makes no step for it", () => {
    const { b } = load()
    useEditor.getState().setConnectAt(b, 1, "topLeft")
    useEditor.getState().setConnectAt(b, 1, "top")
    assert.isUndefined(useEditor.getState().doc.structure.items.get(b))
    const steps = useEditor.getState().past.length
    useEditor.getState().setConnectAt(b, 1, "top")
    assert.lengthOf(useEditor.getState().past, steps)
  })
})

describe("undo descriptions", () => {
  it("say what the step did, both ways", () => {
    const { b } = load()
    useEditor.getState().transformItems(new Map([[b, identityTransform({ x: 900, y: 0, z: 0 })]]), {
      description: "Move 1 item to end of Curve M"
    })
    assert.strictEqual(useEditor.getState().past.at(-1)?.description, "Move 1 item to end of Curve M")
    useEditor.getState().undo()
    assert.strictEqual(useEditor.getState().future[0]?.description, "Move 1 item to end of Curve M")
  })
})

describe("tracked points", () => {
  it("keeps the newest few, and isn't saved or undone", () => {
    load()
    const s = useEditor.getState()
    useEditor.setState((st) => ({
      settings: { ...st.settings, snapPrefs: { ...st.settings.snapPrefs, trackingKeep: 2 } }
    }))
    for (const x of [1, 2, 3]) s.acquireTracked({ at: { x, y: 0, z: 0 }, label: "Corner" })
    assert.deepStrictEqual(useEditor.getState().tracked.map(({ at }) => at.x), [2, 3])
    s.acquireTracked({ at: { x: 3, y: 0, z: 0 }, label: "Corner" })
    assert.lengthOf(useEditor.getState().tracked, 2)
    s.clearTracked()
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  const atOf = (index = 0) => useEditor.getState().tracked[index]?.at ?? ORIGIN

  /** `b` acquired 100 cm along X from its origin, and a point on nothing. */
  const acquired = () => {
    const { a, b } = load()
    const s = useEditor.getState()
    s.acquireTracked({ at: { x: 600, y: 0, z: 0 }, label: "Corner" }, b)
    s.acquireTracked({ at: { x: 7, y: 8, z: 9 }, label: "Crossing" })
    return { a, b }
  }

  it("goes with its item, and leaves a point on nothing where it is", () => {
    const { b } = acquired()
    useEditor.getState().transformItems(new Map([[b, identityTransform({ x: 500, y: 300, z: 0 })]]))
    assertVec(atOf(0), { x: 600, y: 300, z: 0 }, "the point")
    assertVec(atOf(1), { x: 7, y: 8, z: 9 }, "the point")
  })

  it("turns and mirrors with its item", () => {
    const { b } = acquired()
    const turned = {
      ...identityTransform({ x: 500, y: 0, z: 0 }),
      rotation: rotatorToQuat({ pitch: 0, yaw: 90, roll: 0 }),
      scale3D: { x: -2, y: 1, z: 1 }
    }
    useEditor.getState().transformItems(new Map([[b, turned]]))
    assertVec(atOf(), { x: 500, y: -200, z: 0 }, "the point")
  })

  it("comes back with an undo, and goes again with the redo", () => {
    const { b } = acquired()
    useEditor.getState().transformItems(new Map([[b, identityTransform({ x: 500, y: 300, z: 0 })]]))
    useEditor.getState().undo()
    assertVec(atOf(), { x: 600, y: 0, z: 0 }, "the point")
    useEditor.getState().redo()
    assertVec(atOf(), { x: 600, y: 300, z: 0 }, "the point")
  })

  it("stays put through a preview, which isn't the document", () => {
    const { b } = acquired()
    useEditor.getState().setPreview(new Map([[b, identityTransform({ x: 500, y: 300, z: 0 })]]))
    assertVec(atOf(), { x: 600, y: 0, z: 0 }, "the point")
  })

  it("stays the one point when it is hovered again where its item took it", () => {
    const { b } = acquired()
    const s = useEditor.getState()
    s.transformItems(
      new Map([[b, {
        ...identityTransform({ x: 500, y: 0, z: 0 }),
        rotation: rotatorToQuat({ pitch: 0, yaw: 33, roll: 0 })
      }]])
    )
    const at = atOf()
    s.acquireTracked({ at: { ...at, x: at.x + 1e-9 }, label: "Corner" }, b)
    assert.lengthOf(useEditor.getState().tracked, 2)
  })

  it("goes when its item is deleted, and an undo doesn't bring it back", () => {
    const { b } = acquired()
    const s = useEditor.getState()
    s.select([b])
    s.deleteSelection()
    assert.deepStrictEqual(useEditor.getState().tracked.map(({ label }) => label), ["Crossing"])
    useEditor.getState().undo()
    assert.deepStrictEqual(useEditor.getState().tracked.map(({ label }) => label), ["Crossing"])
  })

  it("goes when another map replaces the one it was on", () => {
    acquired()
    load()
    assert.lengthOf(useEditor.getState().tracked, 0)
  })

  it("follows its item through a re-import, which keeps the item's key, and a point on nothing goes", () => {
    const { b } = acquired()
    const { doc } = useEditor.getState()
    const items = doc.map.items.map((item, i) =>
      doc.ids[i] === b
        ? { ...item, itemTransform: { ...item.itemTransform, translation: { x: 500, y: 300, z: 0 } } }
        : item
    )
    useEditor.getState().loadMap({ ...doc.map, items }, null, undefined, {
      loaded: { ids: doc.ids, structure: doc.structure }
    })
    assert.lengthOf(useEditor.getState().tracked, 1)
    assertVec(atOf(), { x: 600, y: 300, z: 0 }, "the point")
  })
})

describe("construction and measurements", () => {
  const plane = {
    kind: "plane",
    id: "p1",
    name: "Landing",
    origin: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    xAxis: { x: 1, y: 0, z: 0 },
    extent: 100,
    grid: false
  } as const

  it("adds, renames and removes as undoable edits of the map", () => {
    load()
    useEditor.getState().addConstruction(plane)
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).construction, 1)
    useEditor.getState().renameConstruction("p1", "Roof")
    assert.strictEqual(annotationsOf(useEditor.getState().doc.structure).construction[0]?.name, "Roof")
    useEditor.getState().removeConstruction("p1")
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).construction, 0)
    useEditor.getState().undo()
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).construction, 1)
  })

  it("keeps a measurement until it is cleared", () => {
    load()
    useEditor.getState().addMeasurement({ id: "m1", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } })
    useEditor.getState().clearMeasurements()
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).measurements, 0)
    useEditor.getState().undo()
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).measurements, 1)
  })
})

describe("a snapped commit on a group with a Point pivot", () => {
  const POINT: GroupPivot = { choice: "point", world: { x: 450, y: 0, z: 0 } }
  const landing: RigidDelta = {
    kind: "rigid",
    rotation: rotatorToQuat({ roll: 0, pitch: 0, yaw: 90 }),
    about: { x: 0, y: 0, z: 0 },
    offset: { x: 0, y: 0, z: 100 }
  }

  /** `b` joined to `a`, and `b` and `c` grouped with a Point pivot. */
  const joinedGroup = () => {
    const { a, b, c } = load()
    join(b)
    const id = grouped([b, c])
    useEditor.getState().setGroupPivot(id, POINT)
    return { a, b, c, id }
  }
  const pivotOfGroup = (id: string) => findGroup(useEditor.getState().doc.structure.tree, id)?.pivot
  const jointsNow = () => annotationsOf(useEditor.getState().doc.structure).joints

  it("takes the Point along and works out the joints, in one step that says what it did", () => {
    const { a, b, c, id } = joinedGroup()
    const steps = useEditor.getState().past.length
    useEditor.getState().transformItems(
      new Map([
        [b, identityTransform({ x: 500, y: 100, z: 0 })],
        [c, identityTransform({ x: 5000, y: 100, z: 0 })]
      ]),
      { description: "Move 2 items to grid 10 cm" }
    )
    assert.deepStrictEqual(pivotOfGroup(id), { choice: "point", world: { x: 450, y: 100, z: 0 } })
    assert.lengthOf(jointsNow(), 0, "the move took the ends apart")
    assert.lengthOf(useEditor.getState().past, steps + 1)
    assert.strictEqual(useEditor.getState().past.at(-1)?.description, "Move 2 items to grid 10 cm")
    useEditor.getState().undo()
    assert.deepStrictEqual(pivotOfGroup(id), POINT)
    assert.deepStrictEqual(jointsNow(), [{ a: { item: b, end: 1 }, b: { item: a, end: 0 } }])
  })

  it("takes the Point through a landing's turn, and undo brings it and the joints back", () => {
    const { b, c, id } = joinedGroup()
    useEditor.getState().transformItems(
      new Map([
        [b, identityTransform({ x: 0, y: 500, z: 100 })],
        [c, identityTransform({ x: 0, y: 5000, z: 100 })]
      ]),
      { landing }
    )
    const pivot = pivotOfGroup(id)
    assert.isTrue(pivot?.choice === "point" && Math.abs(pivot.world.y - 450) < 1e-6 && pivot.world.z === 100)
    useEditor.getState().undo()
    assert.deepStrictEqual(pivotOfGroup(id), POINT)
    assert.lengthOf(jointsNow(), 1)
  })

  describe("while a landing is only a preview", () => {
    const landedTo = (at: { readonly x: number }) => ({
      ...identityTransform({ x: 0, y: at.x, z: 100 }),
      rotation: landing.rotation
    })
    const preview = (b: string, c: string) => new Map([[b, landedTo({ x: 500 })], [c, landedTo({ x: 5000 })]])
    const livePivot = () => {
      const s = useEditor.getState()
      return selectionPivot(s, (id) => shownTransform(s, id))?.pivot
    }
    const LANDED = { x: 0, y: 450, z: 100 }

    it("shows the Point where it will land, and the commit leaves it there", () => {
      const { b, c, id } = joinedGroup()
      useEditor.getState().select([b, c])
      previewMove(preview(b, c), landing)
      assertVec(livePivot() ?? ORIGIN, LANDED, "the gizmo")
      assertVec(shownPivotPoint(useEditor.getState()) ?? ORIGIN, LANDED, "the Pivot section")
      assertVec(shownPivotDots(useEditor.getState())[0]?.pivot ?? ORIGIN, LANDED, "the dot")
      assert.deepStrictEqual(pivotOfGroup(id), POINT, "the document waits for the commit")
      useEditor.getState().setPreview(null)
      useEditor.getState().transformItems(preview(b, c), { landing })
      assertVec(livePivot() ?? ORIGIN, LANDED, "no jump on release")
    })

    it("goes back with the preview when the drag is cancelled", () => {
      const { b, c, id } = joinedGroup()
      useEditor.getState().select([b, c])
      previewMove(preview(b, c), landing)
      useEditor.getState().setPreview(null)
      assert.isNull(useEditor.getState().previewLanding)
      assertVec(livePivot() ?? ORIGIN, POINT.world, "the Point it had")
      assert.deepStrictEqual(pivotOfGroup(id), POINT)
    })

    it("is said by the landing and not by the turn, which leaves the Point where it is", () => {
      const { b, c } = joinedGroup()
      useEditor.getState().select([b, c])
      previewMove(preview(b, c), { kind: "rotate", rotation: landing.rotation })
      assertVec(livePivot() ?? ORIGIN, POINT.world, "a turn is about it")
      previewMove(preview(b, c), landing)
      previewMove(preview(b, c), { kind: "translate", offset: ORIGIN })
      assert.isNull(useEditor.getState().previewLanding, "the next sample's off the target")
    })

    it("leaves the Point of a group the landing has only part of", () => {
      const { b, c } = joinedGroup()
      useEditor.getState().select([b, c])
      previewMove(new Map([[b, landedTo({ x: 500 })]]), landing)
      assertVec(livePivot() ?? ORIGIN, POINT.world, "not the group's own move")
    })
  })

  /** Two pieces that can be copied, grouped with a Point pivot, and a measurement. */
  const copyable = () => {
    const [b = "", c = ""] = loadPieces([{ x: 500, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }], 1)
    useEditor.getState().addMeasurement({ id: "m", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } })
    const id = grouped([b, c])
    useEditor.getState().setGroupPivot(id, POINT)
    return { b, c, id }
  }

  it("carries a copy's Point on an Alt+drag, and leaves the source's", () => {
    const { b, c, id } = copyable()
    const copies = useEditor.getState().beginDuplicateDrag()
    if (copies === undefined) return assert.fail("nothing was copied")
    const [copyB = "", copyC = ""] = [copies.get(b), copies.get(c)]
    const copyGroup = useEditor.getState().doc.structure.tree.findLast((node) => node.kind === "group")
    if (copyGroup?.kind !== "group" || copyGroup.id === id) return assert.fail("the copy has no group")
    useEditor.getState().endDuplicateDrag(
      new Map([
        [copyB, identityTransform({ x: 500, y: 300, z: 0 })],
        [copyC, identityTransform({ x: 5000, y: 300, z: 0 })]
      ]),
      { description: "Move 2 items to grid 10 cm" }
    )
    assert.deepStrictEqual(pivotOfGroup(copyGroup.id), { choice: "point", world: { x: 450, y: 300, z: 0 } })
    assert.deepStrictEqual(pivotOfGroup(id), POINT)
    assert.strictEqual(useEditor.getState().past.at(-1)?.description, "Move 2 items to grid 10 cm")
    useEditor.getState().undo()
    assert.isUndefined(findGroup(useEditor.getState().doc.structure.tree, copyGroup.id))
    assert.deepStrictEqual(pivotOfGroup(id), POINT)
  })

  it("leaves the document as it was when an Alt+drag is cancelled", () => {
    const { id } = copyable()
    const { doc, past } = useEditor.getState()
    assert.isDefined(useEditor.getState().beginDuplicateDrag())
    assert.notStrictEqual(useEditor.getState().doc, doc)
    useEditor.getState().endDuplicateDrag(null)
    assert.strictEqual(useEditor.getState().doc, doc)
    assert.lengthOf(useEditor.getState().past, past.length)
    assert.deepStrictEqual(pivotOfGroup(id), POINT)
    assert.lengthOf(annotationsOf(useEditor.getState().doc.structure).measurements, 1)
  })
})
