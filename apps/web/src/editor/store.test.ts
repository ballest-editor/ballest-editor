import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog, indexCatalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { setLevelNames, withLevelNames } from "../domain/edits"
import { placementTransform } from "../domain/factory"
import { nodeKeys } from "../domain/groupSelection"
import { applyGroupDelta, type RigidDelta } from "../domain/groupTransform"
import { isPlayerStart } from "../domain/MapFile"
import { withDifficulty } from "../domain/mapTags"
import { mirrorFlagsOf } from "../domain/mirror"
import { prefabOfItems } from "../domain/prefab"
import { definitionOf } from "../domain/prefabInstance"
import { defaultSettings } from "../domain/Settings"
import { loadStructure, sidecarOf, structureOfMap } from "../domain/sidecar"
import { findGroup, treeKeys } from "../domain/structure"
import { lightingOf } from "../domain/sunlight"
import { surfaceOf } from "../domain/surface"
import { defaultViewLayout } from "../domain/viewLayout"
import type { ProjectState } from "../services/Platform"
import { paintTargetOf, pickedBrushOf } from "./paintTarget"
import {
  currentBrush,
  editedAtOf,
  exportProblemOf,
  gameMapOf,
  initialMap,
  isShownChain,
  nextSelection,
  NO_TAB_OPEN,
  nodeNamesOf,
  noTabOpen,
  pivotOf,
  PREFAB_TAB_STAYS_HERE,
  saveProblemOf,
  selectionPivot,
  shownChainStart,
  shownGizmoSpace,
  shownLighting,
  shownPivotMode,
  shownTransform,
  shownValidation,
  tabStateOf,
  useEditor,
  windowTitleOf
} from "./store"

const fixtureCatalog = Schema.decodeUnknownSync(Catalog)(fixture)
const cube = fixtureCatalog.pieces.find((p) => p.className === "BP_Prim_Cube")!
const cubeIndex = indexCatalog(fixtureCatalog)

const emptyPrefab = prefabOfItems([], null)

const state = () => useEditor.getState()
/** A new map with only its player start, so these tests own every other item and index. */
const startOnlyMap = () => {
  const map = initialMap()
  return { ...map, items: map.items.filter(isPlayerStart) }
}
const transformOf = (id: string) => state().doc.map.items[state().doc.ids.indexOf(id)]!.itemTransform
const transformItem = (id: string, t: UeTransform) => state().transformItems(new Map([[id, t]]))
const moveItem = (id: string, translation: Vec3) => transformItem(id, { ...transformOf(id), translation })
/** A new map (player start only) with a cube placed at each x; the last one is selected. */
const mapWithCubes = (...xs: ReadonlyArray<number>) => {
  state().loadMap(startOnlyMap(), null)
  for (const x of xs) state().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
}

describe("editor store", () => {
  it("places, moves, deletes, and undoes/redoes", () => {
    const s = () => useEditor.getState()
    s().loadMap(startOnlyMap(), null)
    assert.strictEqual(s().doc.map.items.length, 1)

    s().placePiece(cube, placementTransform(cube, { x: 10, y: 20, z: 30 }))
    const id = s().selectedIds[0]!
    assert.strictEqual(s().doc.map.items.length, 2)

    moveItem(id, { x: 1, y: 2, z: 3 })
    assert.deepStrictEqual(s().doc.map.items[1]!.itemTransform.translation, { x: 1, y: 2, z: 3 })
    moveItem(id, { x: Number.NaN, y: 0, z: 0 }) // rejected by the schema, no history entry
    assert.strictEqual(s().past.length, 2)

    s().deleteSelection()
    assert.strictEqual(s().doc.map.items.length, 1)
    s().undo()
    assert.strictEqual(s().doc.map.items.length, 2)
    s().undo()
    assert.deepStrictEqual(s().doc.map.items[1]!.itemTransform.translation, { x: 10, y: 20, z: 30 })
    s().redo()
    s().redo()
    assert.strictEqual(s().doc.map.items.length, 1)
    assert.strictEqual(s().future.length, 0)
  })

  it("builds at the loaded map's player start height, which stays put while the start moves", () => {
    const s = () => useEditor.getState()
    s().loadMap(startOnlyMap(), null)
    assert.strictEqual(s().floorHeight, 8615)
    const start = s().doc.ids[0]!
    moveItem(start, { x: 0, y: 0, z: 500 })
    assert.strictEqual(s().floorHeight, 8615)
    s().loadMap(s().doc.map, null)
    assert.strictEqual(s().floorHeight, 500)
  })

  it("loads a map at a saved grid height, and sets it without an undo step", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null, 1200)
    assert.strictEqual(s().floorHeight, 1200)
    s().patchTab(s().tabId, { floorHeight: -50 })
    assert.strictEqual(s().floorHeight, -50)
    assert.strictEqual(s().past.length, 0)
  })

  it("changes the level data as one undo step, and not at all when nothing changed", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    const before = s().doc.map.worldSettings.levelData
    s().setLevelData({ ...before })
    assert.strictEqual(s().past.length, 0)
    s().setLevelData(withLevelNames(withDifficulty(before, "expert"), "Night Run", "me"))
    assert.strictEqual(s().past.length, 1)
    assert.strictEqual(s().doc.map.worldSettings.levelData.userLevelName, "Night Run_me")
    assert.strictEqual(s().doc.map.worldSettings.levelData.levelDifficulty, "Expert")
    s().undo()
    assert.deepStrictEqual(s().doc.map.worldSettings.levelData, before)
  })

  it("reports whether a transform was accepted", () => {
    const s = () => useEditor.getState()
    mapWithCubes(0)
    const id = s().selectedIds[0]!
    const t = s().doc.map.items[1]!.itemTransform
    assert.isTrue(transformItem(id, { ...t, rotation: { x: 0, y: 0, z: 2, w: 0 } }))
    assert.deepStrictEqual(s().doc.map.items[1]!.itemTransform.rotation, { x: 0, y: 0, z: 1, w: 0 })
    const before = s().past.length
    assert.isFalse(transformItem(id, { ...t, rotation: { x: 0, y: 0, z: 0, w: 0 } }))
    assert.strictEqual(s().past.length, before)
  })

  it("paints material slots as one undo step, and none when nothing changes", () => {
    const s = () => useEditor.getState()
    mapWithCubes(0, 100)
    const ids = s().doc.ids.slice(1)
    const material = "/Script/Engine.MaterialInstanceConstant'/Game/A/MI_Env_Rough_Red.MI_Env_Rough_Red'"
    const slotOf = (i: number) => s().doc.map.items[i]!.meshComponents[0]!.materials[0]!.material
    const before = slotOf(1)
    const steps = s().past.length
    assert.isTrue(s().paintSlots(ids.map((id) => ({ id, component: 0, slot: 0, material }))))
    assert.deepStrictEqual([slotOf(1), slotOf(2)], [material, material])
    assert.strictEqual(s().past.length, steps + 1)
    assert.isTrue(s().paintSlots(ids.map((id) => ({ id, component: 0, slot: 0, material }))))
    assert.strictEqual(s().past.length, steps + 1)
    assert.isFalse(s().paintSlots([{ id: "nope", component: 0, slot: 0, material }]))
    s().undo()
    assert.deepStrictEqual([slotOf(1), slotOf(2)], [before, before])
  })

  describe("a paint stroke", () => {
    const material = "/Script/Engine.MaterialInstanceConstant'/Game/A/MI_Env_Rough_Red.MI_Env_Rough_Red'"
    const slotOf = (i: number) => s().doc.map.items[i]!.meshComponents[0]!.materials[0]!.material
    const s = state

    it("is one undo step for every target it paints", () => {
      mapWithCubes(0, 100, 200)
      const ids = s().doc.ids.slice(1)
      const before = slotOf(1)
      const steps = s().past.length
      assert.isTrue(s().beginPaintStroke())
      assert.isFalse(s().beginPaintStroke()) // one at a time
      for (const id of ids) assert.isTrue(s().paintSlots([{ id, component: 0, slot: 0, material }]))
      // painted as it goes, with no step yet, and undo waits
      assert.deepStrictEqual([slotOf(1), slotOf(2), slotOf(3)], [material, material, material])
      assert.strictEqual(s().past.length, steps)
      s().undo()
      assert.strictEqual(slotOf(1), material)
      s().endPaintStroke()
      assert.strictEqual(s().past.length, steps + 1)
      assert.isTrue(s().dirty)
      s().undo()
      assert.deepStrictEqual([slotOf(1), slotOf(2), slotOf(3)], [before, before, before])
      s().redo()
      assert.deepStrictEqual([slotOf(1), slotOf(2), slotOf(3)], [material, material, material])
    })

    it("leaves no step when it painted nothing new", () => {
      mapWithCubes(0)
      const id = s().doc.ids[1]!
      s().paintSlots([{ id, component: 0, slot: 0, material }])
      const steps = s().past.length
      s().beginPaintStroke()
      s().endPaintStroke()
      s().beginPaintStroke()
      s().paintSlots([{ id, component: 0, slot: 0, material }])
      s().endPaintStroke()
      assert.strictEqual(s().past.length, steps)
    })

    it("paints the whole piece: every slot of its components, as the paint tool asks", () => {
      mapWithCubes(0)
      const id = s().doc.ids[1]!
      const item = s().doc.map.items[1]!
      const target = paintTargetOf(
        { itemId: id, visual: "m0", slot: 0 },
        item,
        cubeIndex,
        { _tag: "Material", material },
        true
      )
      assert.strictEqual(target.effect._tag, "Slots")
      const slots = target.effect._tag === "Slots" ? target.effect.edits : []
      assert.deepStrictEqual(slots.map((edit) => edit.slot), cube.materialSlots.map((slot) => slot.index))
      s().beginPaintStroke()
      s().paintSlots(slots.map((edit) => ({ id, ...edit })))
      s().endPaintStroke()
      assert.deepStrictEqual(
        s().doc.map.items[1]!.meshComponents[0]!.materials.map((m) => m.material),
        cube.materialSlots.map(() => material)
      )
    })

    it("puts a painted piece back to its defaults, which the eyedropper then picks, as one undo step", () => {
      mapWithCubes(0)
      const id = s().doc.ids[1]!
      const at = { itemId: id, visual: "m0", slot: 0 }
      const editsOf = (brush: Parameters<typeof paintTargetOf>[3]) => {
        const { effect } = paintTargetOf(at, s().doc.map.items[1]!, cubeIndex, brush, true)
        return effect._tag === "Slots" ? effect.edits.map((edit) => ({ id, ...edit })) : []
      }
      s().paintSlots(editsOf({ _tag: "Material", material }))
      const steps = s().past.length
      s().beginPaintStroke()
      s().paintSlots(editsOf({ _tag: "Default" }))
      s().endPaintStroke()
      const mesh = s().doc.map.items[1]!.meshComponents[0]!
      assert.deepStrictEqual([mesh.materials, mesh.materialAssetPaths], [[], []])
      assert.strictEqual(s().past.length, steps + 1)
      assert.deepStrictEqual(pickedBrushOf(at, s().doc.map.items[1]!, cubeIndex), { _tag: "Default" })
      // already there: nothing to do
      s().beginPaintStroke()
      s().paintSlots(editsOf({ _tag: "Default" }))
      s().endPaintStroke()
      assert.strictEqual(s().past.length, steps + 1)
      s().undo()
      assert.strictEqual(slotOf(1), material)
    })

    it("sets surfaces, with or without a stroke, and one step for each", () => {
      mapWithCubes(0, 100)
      const ids = s().doc.ids.slice(1)
      const surfaceAt = (i: number) => surfaceOf(s().doc.map.items[i]!)
      const steps = s().past.length
      s().beginPaintStroke()
      for (const id of ids) assert.isTrue(s().paintSurface([id], 2))
      s().endPaintStroke()
      assert.deepStrictEqual([surfaceAt(1), surfaceAt(2)], [2, 2])
      assert.strictEqual(s().past.length, steps + 1)
      // already on it: no step
      assert.isTrue(s().paintSurface(ids, 2))
      assert.strictEqual(s().past.length, steps + 1)
      assert.isTrue(s().paintSurface(ids.slice(0, 1), 0))
      assert.strictEqual(s().past.length, steps + 2)
      assert.deepStrictEqual([surfaceAt(1), surfaceAt(2)], [0, 2])
      assert.isFalse(s().paintSurface(["nope"], 1))
      s().undo()
      s().undo()
      assert.deepStrictEqual([surfaceAt(1), surfaceAt(2)], [0, 0])
    })

    it("paints with the picker's first colour until another is picked", () => {
      const paint = [{ name: "smooth", colors: [{ color: "Red", material }] }]
      assert.deepStrictEqual(currentBrush({ brush: null, paint }), { _tag: "Material", material })
      assert.isUndefined(currentBrush({ brush: null, paint: [] }))
      const ice = { _tag: "Surface", value: 2 } as const
      assert.deepStrictEqual(currentBrush({ brush: ice, paint }), ice)
    })

    it("holds the tab where it is until it ends", () => {
      mapWithCubes(0)
      s().loadMap(startOnlyMap(), null, undefined, { into: "addedTab" })
      const second = s().tabId
      s().activateTab(s().tabIds[0]!)
      const first = s().tabId
      s().beginPaintStroke()
      s().activateTab(second)
      assert.strictEqual(s().tabId, first)
      s().endPaintStroke()
      s().activateTab(second)
      assert.strictEqual(s().tabId, second)
    })
  })

  it("sets pivots on several items as one undo step, and skips no-op changes", () => {
    const s = state
    mapWithCubes(0, 100)
    const ids = s().doc.ids.slice(1)
    const top = { choice: "Top", localPosition: { x: 0, y: 0, z: 1000 } }
    const before = s().past.length
    s().setItemPivots(new Map(ids.map((id) => [id, top])))
    assert.strictEqual(s().past.length, before + 1)
    assert.deepStrictEqual(ids.map((id) => pivotOf(s(), id).choice), ["Top", "Top"])
    s().setItemPivots(new Map(ids.map((id) => [id, top])))
    assert.strictEqual(s().past.length, before + 1)
    s().undo()
    assert.deepStrictEqual(ids.map((id) => pivotOf(s(), id).choice), ["Default", "Default"])
  })

  describe("history", () => {
    const s = () => useEditor.getState()
    const place = (x: number) => {
      s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
      return s().selectedIds[0]!
    }
    const translationOf = (id: string) => s().doc.map.items[s().doc.ids.indexOf(id)]!.itemTransform.translation
    const withUndoSelection = (on: boolean) =>
      s().setSettings({ ...defaultSettings, editor: { ...defaultSettings.editor, undoSelection: on } })

    it("puts every kind of edit on the stack, and loading a map clears it", () => {
      s().loadMap(startOnlyMap(), null)
      const id = place(0)
      moveItem(id, { x: 5, y: 0, z: 0 })
      const t = s().doc.map.items[1]!.itemTransform
      transformItem(id, { ...t, scale3D: { x: 2, y: 2, z: 2 } })
      s().renameLevel("Renamed", "me")
      s().deleteSelection()
      assert.strictEqual(s().past.length, 5)
      s().loadMap(startOnlyMap(), null)
      assert.strictEqual(s().past.length, 0)
      assert.strictEqual(s().future.length, 0)
      assert.isFalse(s().dirty)
    })

    describe("dirty", () => {
      const saved = { name: "saved.balledit", path: null }
      const save = () => s().markSaved(s().tabId, s().doc, s().doc.map, saved, null)

      it("clears when undo gets back to the map as it was opened", () => {
        s().loadMap(startOnlyMap(), null)
        place(0)
        place(10)
        assert.isTrue(s().dirty)
        s().undo()
        assert.isTrue(s().dirty)
        s().undo()
        assert.isFalse(s().dirty)
        s().redo()
        assert.isTrue(s().dirty)
      })

      it("clears when undo gets back to the last save", () => {
        s().loadMap(startOnlyMap(), null)
        place(0)
        save()
        assert.isFalse(s().dirty)
        place(10)
        assert.isTrue(s().dirty)
        s().undo()
        assert.isFalse(s().dirty)
      })

      it("comes back on undoing past the save, and clears on redoing to it", () => {
        s().loadMap(startOnlyMap(), null)
        place(0)
        save()
        s().undo()
        assert.isTrue(s().dirty)
        s().redo()
        assert.isFalse(s().dirty)
      })

      it("stays once a new edit has replaced the step that was saved", () => {
        s().loadMap(startOnlyMap(), null)
        place(0)
        save()
        s().undo()
        place(10)
        s().undo()
        assert.isTrue(s().dirty)
      })

      it("clears at the step that was saved, when the map was edited during the save", () => {
        s().loadMap(startOnlyMap(), null)
        place(0)
        const from = s().doc
        place(10)
        s().markSaved(s().tabId, from, from.map, saved, null)
        assert.isTrue(s().dirty)
        s().undo()
        assert.isFalse(s().dirty)
      })

      it("isn't changed by undoing a selection step", () => {
        s().loadMap(startOnlyMap(), null)
        withUndoSelection(true)
        try {
          const id = place(0)
          s().select([])
          s().undo()
          assert.deepStrictEqual(s().selectedIds, [id])
          assert.isTrue(s().dirty)
        } finally {
          withUndoSelection(false)
        }
      })

      it("stays on a recovered map, which no step of the history is the file of", () => {
        s().loadMap(startOnlyMap(), saved, undefined, { dirty: true })
        place(0)
        s().undo()
        assert.isTrue(s().dirty)
      })

      it("stays on a map that lost its file", () => {
        s().loadMap(startOnlyMap(), saved)
        place(0)
        s().detachFiles()
        s().undo()
        assert.isTrue(s().dirty)
      })

      it("follows each tab's own saved step", () => {
        s().loadMap(startOnlyMap(), null)
        const first = s().tabId
        place(0)
        s().loadMap(startOnlyMap(), saved, undefined, { into: "newTab" })
        s().activateTab(first)
        s().undo()
        assert.isFalse(s().dirty)
      })
    })

    it("leaves no step for edits that change nothing", () => {
      s().loadMap(startOnlyMap(), null)
      const id = place(10)
      const before = s().past.length
      moveItem(id, { x: 10, y: 0, z: 0 })
      assert.isTrue(transformItem(id, s().doc.map.items[1]!.itemTransform)) // a drag that ended where it began
      const { levelDisplayName, creatorName } = s().doc.map.worldSettings.levelData
      s().renameLevel(levelDisplayName, creatorName)
      assert.strictEqual(s().past.length, before)
    })

    it("clears the redo stack on a new edit", () => {
      s().loadMap(startOnlyMap(), null)
      const id = place(0)
      moveItem(id, { x: 1, y: 0, z: 0 })
      s().undo()
      assert.strictEqual(s().future.length, 1)
      moveItem(id, { x: 2, y: 0, z: 0 })
      assert.strictEqual(s().future.length, 0)
      s().redo() // nothing to redo
      assert.deepStrictEqual(translationOf(id), { x: 2, y: 0, z: 0 })
    })

    it("restores the selection that went with each step", () => {
      s().loadMap(startOnlyMap(), null)
      const a = place(0)
      const b = place(100)
      s().select([a])
      s().deleteSelection()
      assert.deepStrictEqual(s().selectedIds, [])
      s().select([b])
      s().undo() // the deleted item comes back selected
      assert.deepStrictEqual(s().selectedIds, [a])
      s().redo() // and is gone again with nothing selected
      assert.deepStrictEqual(s().selectedIds, [])
      assert.isFalse(s().doc.ids.includes(a))
      s().undo()
      s().undo() // undoing b's placement goes back to a, selected before it
      assert.isFalse(s().doc.ids.includes(b))
      assert.deepStrictEqual(s().selectedIds, [a])
      s().select([])
      s().redo() // redoing it selects b, as placing did
      assert.deepStrictEqual(s().selectedIds, [b])
    })

    it("waits while a gizmo drag or scrub is previewing", () => {
      s().loadMap(startOnlyMap(), null)
      const id = place(0)
      const t = s().doc.map.items[1]!.itemTransform
      s().setPreview(new Map([[id, { ...t, translation: { x: 50, y: 0, z: 0 } }]]))
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 2)
      // the interaction commits once on release
      s().setPreview(null)
      moveItem(id, { x: 50, y: 0, z: 0 })
      s().undo()
      assert.deepStrictEqual(translationOf(id), { x: 0, y: 0, z: 0 })
    })

    it("doesn't record selection changes by default", () => {
      withUndoSelection(false)
      s().loadMap(startOnlyMap(), null)
      const a = place(0)
      const b = place(100)
      const before = s().past.length
      s().select([a])
      s().select([])
      s().select([b])
      assert.strictEqual(s().past.length, before)
    })

    it("records each selection change as its own step when enabled", () => {
      withUndoSelection(true)
      try {
        s().loadMap(startOnlyMap(), null)
        const a = place(0)
        const b = place(100)
        s().select([])
        const before = s().past.length
        const doc = s().doc
        s().select([a])
        s().select([a]) // unchanged: no step
        s().select([b])
        s().select([])
        assert.strictEqual(s().past.length, before + 3)
        s().undo()
        assert.deepStrictEqual(s().selectedIds, [b])
        s().undo()
        assert.deepStrictEqual(s().selectedIds, [a])
        s().undo()
        assert.deepStrictEqual(s().selectedIds, [])
        assert.strictEqual(s().doc, doc) // selection steps never touch the doc
        s().redo()
        s().redo()
        assert.deepStrictEqual(s().selectedIds, [b])
        s().select([a]) // a new selection clears the redo stack
        assert.strictEqual(s().future.length, 0)
      } finally {
        withUndoSelection(false)
      }
    })

    it("doesn't mark the map dirty or leave a deleted selection behind", () => {
      withUndoSelection(true)
      try {
        s().loadMap(startOnlyMap(), null)
        s().select([s().doc.ids[0]!])
        s().select([])
        s().undo()
        s().undo()
        s().redo()
        assert.isFalse(s().dirty)

        // edits around selection steps keep their own before/after selection
        const a = place(0) // selected as part of the placement step
        s().select([])
        s().select([a])
        s().deleteSelection()
        s().undo() // a is back, selected
        assert.deepStrictEqual(s().selectedIds, [a])
        s().undo() // re-selecting a
        s().undo() // deselecting
        assert.deepStrictEqual(s().selectedIds, [a])
        s().undo() // the placement: back to what was selected before it
        assert.isFalse(s().doc.ids.includes(a))
        assert.deepStrictEqual(s().selectedIds, [s().doc.ids[0]!])

        // a selection step naming an item that is gone resolves to no selection
        const b = place(0)
        const step = { doc: s().doc, selectedIds: ["item-gone"], otherSelectedIds: [b], selectionOnly: true }
        useEditor.setState({ past: [...s().past, step] })
        s().undo()
        assert.deepStrictEqual(s().selectedIds, [])
      } finally {
        withUndoSelection(false)
      }
    })

    it("counts selection steps against the 200-step limit", () => {
      withUndoSelection(true)
      try {
        s().loadMap(startOnlyMap(), null)
        const a = place(0)
        for (let i = 0; i < 250; i++) s().select(i % 2 === 0 ? [] : [a])
        assert.strictEqual(s().past.length, 200)
      } finally {
        withUndoSelection(false)
      }
    })

    it("keeps at most 200 steps", () => {
      s().loadMap(startOnlyMap(), null)
      const id = place(0)
      for (let i = 1; i <= 250; i++) moveItem(id, { x: i, y: 0, z: 0 })
      assert.strictEqual(s().past.length, 200)
      for (let i = 0; i < 300; i++) s().undo()
      assert.deepStrictEqual(translationOf(id), { x: 50, y: 0, z: 0 })
      for (let i = 0; i < 300; i++) s().redo()
      assert.deepStrictEqual(translationOf(id), { x: 250, y: 0, z: 0 })
      assert.strictEqual(s().past.length, 200)
    })
  })

  describe("multi-select", () => {
    const s = state
    const place = (x: number) => {
      s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
      return s().selectedIds[0]!
    }
    const setup = () => {
      s().loadMap(startOnlyMap(), null)
      const ids = [place(0), place(100), place(200)]
      s().select(ids)
      return { ids, steps: s().past.length }
    }

    it("selects with replace, add and toggle clicks", () => {
      assert.deepStrictEqual(nextSelection(["a", "b"], ["c"], "replace"), ["c"])
      assert.deepStrictEqual(nextSelection(["a", "b"], [], "replace"), [])
      assert.deepStrictEqual(nextSelection(["a", "b"], ["c"], "add"), ["a", "b", "c"])
      assert.deepStrictEqual(nextSelection(["a", "b"], ["a"], "add"), ["b", "a"]) // re-adding makes it active
      assert.deepStrictEqual(nextSelection(["a", "b"], ["a"], "toggle"), ["b"])
      assert.deepStrictEqual(nextSelection(["a", "b"], ["c"], "toggle"), ["a", "b", "c"])
      // a modifier click on empty space keeps the selection
      assert.deepStrictEqual(nextSelection(["a", "b"], [], "add"), ["a", "b"])
      assert.deepStrictEqual(nextSelection(["a", "b"], [], "toggle"), ["a", "b"])
    })

    it("keeps the selection a set", () => {
      const { ids } = setup()
      s().select([ids[0]!, ids[1]!, ids[0]!])
      assert.deepStrictEqual(s().selectedIds, [ids[0]!, ids[1]!])
    })

    it("transforms several items as one undo step, or none of them", () => {
      const { ids, steps } = setup()
      const moved = new Map(ids.map((id) => [id, { ...transformOf(id), translation: { x: 7, y: 7, z: 7 } }]))
      assert.isTrue(s().transformItems(moved))
      assert.strictEqual(s().past.length, steps + 1)
      for (const id of ids) assert.deepStrictEqual(transformOf(id).translation, { x: 7, y: 7, z: 7 })
      s().undo()
      assert.deepStrictEqual(ids.map((id) => transformOf(id).translation.x), [0, 100, 200])
      assert.deepStrictEqual(s().selectedIds, ids)

      const bad = new Map(moved).set(ids[2]!, { ...transformOf(ids[2]!), rotation: { x: 0, y: 0, z: 0, w: 0 } })
      assert.isFalse(s().transformItems(bad))
      assert.deepStrictEqual(ids.map((id) => transformOf(id).translation.x), [0, 100, 200])
    })

    it("resizes a decal as one undo step, though its transform in the file doesn't change", () => {
      const { steps } = setup()
      const name = "BP_UGCCircuitDecal"
      const classPath = `/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/Decals/${name}.${name}_C'`
      s().placePiece({ ...cube, classPath }, placementTransform(cube, { x: 0, y: 0, z: 0 }))
      const id = s().doc.ids.at(-1)!
      const size = () =>
        s().doc.map.items[s().doc.ids.indexOf(id)]!.floatProperties.find((p) => p.propertyName === "DecalHeight")
      const before = shownTransform(s(), id)!
      assert.deepStrictEqual(before.scale3D, { x: 200, y: 200, z: 100 })

      assert.isTrue(s().transformItems(new Map([[id, { ...before, scale3D: { ...before.scale3D, x: 500 } }]])))
      assert.strictEqual(s().past.length, steps + 2) // the placing and the resizing
      assert.strictEqual(size()?.currentValue, 500)
      assert.deepStrictEqual(transformOf(id).scale3D, { x: 1, y: 1, z: 1 })
      assert.strictEqual(shownTransform(s(), id)!.scale3D.x, 500)

      s().undo()
      assert.strictEqual(shownTransform(s(), id)!.scale3D.x, 200)
    })

    it("deletes the whole selection as one step and restores it on undo", () => {
      const { ids, steps } = setup()
      s().deleteSelection()
      assert.strictEqual(s().doc.map.items.length, 1)
      assert.strictEqual(s().past.length, steps + 1)
      assert.deepStrictEqual(s().selectedIds, [])
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.deepStrictEqual(s().selectedIds, ids)
    })

    it("duplicates the selection in place as one step, selecting the copies", () => {
      const { ids, steps } = setup()
      s().duplicateSelection()
      assert.strictEqual(s().past.length, steps + 1)
      assert.strictEqual(s().doc.map.items.length, 7)
      const copies = s().selectedIds
      assert.strictEqual(copies.length, 3)
      assert.isFalse(copies.some((id) => ids.includes(id)))
      assert.deepStrictEqual(copies.map((id) => transformOf(id).translation.x), [0, 100, 200])
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.deepStrictEqual(s().selectedIds, ids)
    })

    it("pastes copied items where they were copied, as one step, selecting them", () => {
      const { ids, steps } = setup()
      s().select([ids[2]!, ids[0]!])
      s().copySelection()
      assert.strictEqual(s().past.length, steps) // copying changes nothing
      moveItem(ids[0]!, { x: 50, y: 0, z: 0 })
      s().paste()
      assert.strictEqual(s().doc.map.items.length, 6)
      assert.strictEqual(s().past.length, steps + 2)
      const pasted = s().selectedIds
      assert.isFalse(pasted.some((id) => ids.includes(id)))
      // the copy keeps the transform it had when copied, not the source's later move
      assert.deepStrictEqual(pasted.map((id) => transformOf(id).translation.x), [200, 0])
      s().paste()
      assert.strictEqual(s().doc.map.items.length, 8)
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 6)
      assert.deepStrictEqual(s().selectedIds, pasted)
    })

    it("cuts the selection as one step, leaving the player start, and pastes it back in place", () => {
      const { ids, steps } = setup()
      s().select([s().doc.ids[0]!, ids[0]!, ids[2]!])
      s().cutSelection()
      assert.strictEqual(s().past.length, steps + 1)
      assert.strictEqual(s().doc.map.items.length, 2)
      assert.isTrue(isPlayerStart(s().doc.map.items[0]!))
      assert.deepStrictEqual(s().selectedIds, [])
      s().paste()
      assert.deepStrictEqual(s().selectedIds.map((id) => transformOf(id).translation.x), [0, 200])
      s().undo()
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.deepStrictEqual(s().selectedIds, [s().doc.ids[0]!, ids[0]!, ids[2]!])
    })

    it("keeps the clipboard across loading another map", () => {
      const { ids } = setup()
      s().select([ids[1]!])
      s().copySelection()
      s().loadMap(startOnlyMap(), null)
      s().paste()
      assert.strictEqual(s().doc.map.items.length, 2)
      assert.strictEqual(transformOf(s().selectedIds[0]!).translation.x, 100)
    })

    it("does nothing on paste with an empty clipboard or copy with an empty selection", () => {
      const { steps } = setup()
      useEditor.setState({ clipboard: null })
      s().paste()
      s().select([])
      s().copySelection()
      assert.isNull(s().clipboard)
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.strictEqual(s().past.length, steps)
    })

    it("commits an alt+drag duplicate and its move as one step", () => {
      const { ids, steps } = setup()
      const copies = s().beginDuplicateDrag()!
      assert.deepStrictEqual([...copies.keys()], ids)
      const copyIds = [...copies.values()]
      assert.deepStrictEqual(s().selectedIds, copyIds)
      assert.strictEqual(s().doc.map.items.length, 7)
      assert.strictEqual(s().past.length, steps) // nothing committed mid-drag
      const moved = new Map(copyIds.map((id) => [id, { ...transformOf(id), translation: { x: 9, y: 9, z: 9 } }]))
      assert.isTrue(s().endDuplicateDrag(moved))
      assert.strictEqual(s().past.length, steps + 1)
      assert.deepStrictEqual(ids.map((id) => transformOf(id).translation.x), [0, 100, 200]) // originals stay
      for (const id of copyIds) assert.deepStrictEqual(transformOf(id).translation, { x: 9, y: 9, z: 9 })
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.deepStrictEqual(s().selectedIds, ids)
      s().redo()
      assert.deepStrictEqual(s().selectedIds, copyIds)
    })

    it("drops the copies of a cancelled or refused alt+drag", () => {
      const { ids, steps } = setup()
      s().beginDuplicateDrag()
      assert.isFalse(s().endDuplicateDrag(null))
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.deepStrictEqual(s().selectedIds, ids)

      const copyIds = [...s().beginDuplicateDrag()!.values()]
      const bad = new Map([[copyIds[0]!, { ...transformOf(copyIds[0]!), rotation: { x: 0, y: 0, z: 0, w: 0 } }]])
      assert.isFalse(s().endDuplicateDrag(bad))
      assert.strictEqual(s().doc.map.items.length, 4)
      assert.deepStrictEqual(s().selectedIds, ids)
      assert.strictEqual(s().past.length, steps)
    })

    it("never duplicates the player start", () => {
      const { ids } = setup()
      s().select([s().doc.ids[0]!, ids[0]!])
      s().duplicateSelection()
      assert.strictEqual(s().doc.map.items.length, 5)
      s().select([s().doc.ids[0]!])
      const before = s().past.length
      s().duplicateSelection()
      assert.strictEqual(s().past.length, before)
      assert.isUndefined(s().beginDuplicateDrag())
      s().copySelection()
      s().paste()
      assert.strictEqual(s().doc.map.items.filter(isPlayerStart).length, 1)
    })
  })

  it("previews lighting live and commits it as one undo step", () => {
    state().loadMap(initialMap(), null)
    const before = shownLighting(state())
    state().setLightingPreview({ ...before, timeOfDay: 20 })
    assert.strictEqual(shownLighting(state()).timeOfDay, 20)
    assert.strictEqual(state().doc.map.worldSettings.directionalLight.timeOfDay, before.timeOfDay)
    state().undo() // waits while the preview is up
    assert.strictEqual(shownLighting(state()).timeOfDay, 20)

    state().setLightingPreview(null)
    state().setLighting({ ...before, timeOfDay: 20 })
    state().setLighting({ ...before, timeOfDay: 20 }) // unchanged: no step
    state().setLighting({ ...before, brightness: Number.POSITIVE_INFINITY }) // rejected: no step
    assert.strictEqual(state().past.length, 1)
    assert.strictEqual(state().doc.map.worldSettings.directionalLight.timeOfDay, 20)
    state().undo()
    assert.deepStrictEqual(shownLighting(state()), before)
  })

  it("tracks the open dialog and settings category", () => {
    const s = () => useEditor.getState()
    assert.isNull(s().dialog)
    s().openDialog({ id: "settings", category: "keybinds" })
    assert.strictEqual(s().dialog?.id, "settings")
    assert.strictEqual(s().settingsCategory, "keybinds")
    s().setSettingsCategory("camera")
    s().closeDialog()
    s().openDialog({ id: "settings" })
    assert.strictEqual(s().settingsCategory, "camera") // the last page shown when no category is given
    s().openDialog({ id: "saveAs" })
    assert.strictEqual(s().dialog?.id, "saveAs")
    assert.strictEqual(s().settingsCategory, "camera")
    s().closeDialog()
    assert.isNull(s().dialog)
  })

  it("sets an item property on the whole selection as one undo step", () => {
    const s = () => useEditor.getState()
    s().loadMap(startOnlyMap(), null)
    for (const x of [0, 100]) s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
    s().select(s().doc.ids.slice(1))
    const before = s().past.length
    const strength = { list: "floatProperties", name: "Strength", type: "Float" } as const
    assert.isTrue(s().setSelectionProperties([{ property: strength, value: 2 }]))
    assert.deepStrictEqual(s().doc.map.items.map((i) => i.floatProperties.map((p) => p.currentValue)), [[], [2], [2]])
    assert.strictEqual(s().past.length, before + 1)
    assert.isTrue(s().setSelectionProperties([{ property: strength, value: 2 }])) // unchanged: no step
    assert.strictEqual(s().past.length, before + 1)
    const weight = { list: "floatProperties", name: "Weight", type: "Float" } as const
    // all or nothing: a bad value leaves the good one unset too
    assert.isFalse(s().setSelectionProperties([{ property: weight, value: 1 }, { property: strength, value: "fast" }]))
    assert.deepStrictEqual(s().doc.map.items[1]?.floatProperties.map((p) => p.propertyName), ["Strength"])
    assert.strictEqual(s().past.length, before + 1)
    s().undo()
    assert.deepStrictEqual(s().doc.map.items.map((i) => i.floatProperties.length), [0, 0, 0])
  })

  it("flips each selected item from its own state as one undo step, skipping what can't flip", () => {
    const s = () => useEditor.getState()
    const flag = { list: "boolProperties", type: "Bool", default: false } as const
    const mirrorable = { ...cube, properties: [{ ...flag, name: "bMirror" }, { ...flag, name: "bMirrorX" }] }
    s().loadMap(startOnlyMap(), null)
    for (const x of [0, 100]) s().placePiece(mirrorable, placementTransform(mirrorable, { x, y: 0, z: 0 }))
    const [start, a, b] = s().doc.ids
    const flipped = () => s().doc.map.items.map((item) => mirrorFlagsOf(item).x)
    s().select([a!])
    s().flipSelection("x")
    assert.deepStrictEqual(flipped(), [false, true, false])
    s().select([start!, a!, b!])
    const before = s().past.length
    s().flipSelection("x")
    assert.deepStrictEqual(flipped(), [false, false, true])
    assert.strictEqual(s().past.length, before + 1)
    s().select([start!])
    s().flipSelection("x") // the player start doesn't flip: no step
    assert.strictEqual(s().past.length, before + 1)
    s().undo()
    assert.deepStrictEqual(flipped(), [false, true, false])
  })

  it("loading a map replaces the document, its history and any live interaction", () => {
    const s = () => useEditor.getState()
    mapWithCubes(2)
    s().select([s().doc.ids[0]!])
    s().setPreview(new Map())
    s().loadMap(initialMap(), null)
    assert.include(s(), { dirty: false, file: null, preview: null, lightingPreview: null })
    assert.deepStrictEqual(s().past, [])
    assert.deepStrictEqual(s().selectedIds, [])
    assert.strictEqual(s().doc.map.items.length, initialMap().items.length)
  })

  it("records every notification, newest first; a persistent kind pins until resolved", () => {
    const s = () => useEditor.getState()
    s().clearNotifications()
    s().notify("info", "Big Loop was changed in the game", {
      kind: "changedInGame",
      actions: [{ label: "Reveal", command: { _tag: "RevealProject" } }]
    })
    s().notify("error", "The game wasn't found", { kind: "gameNotFound", persistent: true, body: "Choose its folder." })
    s().notify("error", "Its editor data couldn't be read", { kind: "sidecarUnreadable" })
    assert.deepStrictEqual(s().notifications.map((n) => [n.kind, n.level, n.title]), [
      ["sidecarUnreadable", "error", "Its editor data couldn't be read"],
      ["gameNotFound", "error", "The game wasn't found"],
      ["changedInGame", "info", "Big Loop was changed in the game"]
    ])
    assert.deepInclude(s().notifications[1], { body: "Choose its folder.", persistent: true, resolvedAt: null })
    assert.deepStrictEqual(s().notifications[2]?.actions, [{ label: "Reveal", command: { _tag: "RevealProject" } }])

    s().markNotificationsRead([s().notifications[0]!.id])
    assert.deepStrictEqual(s().notifications.map((n) => n.read), [true, false, false])
    s().clearNotifications()
    assert.deepStrictEqual(s().notifications.map((n) => n.kind), ["gameNotFound"])
    s().resolveNotifications("gameNotFound")
    assert.isNotNull(s().notifications[0]?.resolvedAt)
    s().markNotificationsRead()
    s().clearNotifications()
    assert.deepStrictEqual(s().notifications, [])
  })

  it("sends each event to the inbox or a toast, never both", () => {
    const s = () => useEditor.getState()
    s().clearNotifications()
    useEditor.setState({ toasts: [] })
    s().notify("error", "Select 2 to 4096 items before saving a prefab.", { kind: "prefabRefused" })
    s().notify("error", "Something failed")
    s().notify("info", "Saved Big Loop", { kind: "mapSaved" })
    assert.deepStrictEqual(s().toasts.map((n) => n.kind), ["mapSaved", "error", "prefabRefused"])
    assert.deepStrictEqual(s().notifications, [])

    useEditor.setState({ toasts: [] })
    s().notify("info", "Big Loop was changed in the game", { kind: "changedInGame" })
    s().notify("info", "Exported, but the plugin isn't there", { kind: "anything", persistent: true })
    assert.deepStrictEqual(s().notifications.map((n) => n.kind), ["anything", "changedInGame"])
    assert.deepStrictEqual(s().toasts, [])
    s().resolveNotifications("anything")
    s().clearNotifications()
  })
})

describe("document tabs", () => {
  /** One tab, with a fresh map in it. */
  const oneTab = () => {
    useEditor.setState({ tabIds: [state().tabId], parkedTabs: new Map() })
    state().loadMap(startOnlyMap(), null, undefined, { fresh: true })
  }
  const named = (name: string) => setLevelNames(startOnlyMap(), name, "me")
  const fileOf = (name: string) => ({ name: `${name}.balledit`, path: null })

  it("opens a map in a new tab after the active one; an untouched fresh map is replaced instead", () => {
    oneTab()
    const first = state().tabId
    state().loadMap(named("A"), { name: "a.balledit", path: null }, undefined, { into: "newTab" })
    assert.deepStrictEqual(state().tabIds, [first])

    state().loadMap(named("B"), { name: "b.balledit", path: null }, undefined, { into: "newTab" })
    const second = state().tabId
    state().activateTab(first)
    state().loadMap(named("C"), { name: "c.balledit", path: null }, undefined, { into: "newTab" })
    assert.deepStrictEqual(state().tabIds, [first, state().tabId, second])
    assert.strictEqual(state().file?.name, "c.balledit")
  })

  it("opens a map in a background tab after the active one, whatever is active, and leaves that active", () => {
    oneTab()
    const first = state().tabId
    state().loadMap(named("A"), fileOf("a"), undefined, { into: "backgroundTab" })
    assert.strictEqual(state().tabId, first)
    assert.isNull(state().file)
    assert.strictEqual(state().tabIds[0], first)
    assert.strictEqual(state().tabIds.length, 2)
    const behind = state().tabIds[1]!
    assert.strictEqual(state().parkedTabs.get(behind)?.file?.name, "a.balledit")

    state().activateTab(behind)
    assert.strictEqual(state().file?.name, "a.balledit")
    assert.strictEqual(state().doc.map.worldSettings.levelData.levelDisplayName, "A")
  })

  it("says a map was edited when a tab has its edits, and when its file changed otherwise", () => {
    oneTab()
    const modifiedAt = "2026-01-01T00:00:00.000Z"
    state().loadMap(named("A"), fileOf("a"), undefined)
    assert.strictEqual(editedAtOf(state(), "a.balledit", modifiedAt), modifiedAt)
    assert.strictEqual(editedAtOf(state(), "other.balledit", modifiedAt), modifiedAt)

    state().setLighting({ ...lightingOf(state().doc.map.worldSettings), timeOfDay: 3 })
    const edited = editedAtOf(state(), "a.balledit", modifiedAt)
    assert.isAbove(Date.parse(edited), Date.parse(modifiedAt))

    // an undo back to what the file holds has no edits left to date
    state().undo()
    assert.strictEqual(editedAtOf(state(), "a.balledit", modifiedAt), modifiedAt)
  })

  it("keeps each tab's document, history, selection and file while another is active", () => {
    oneTab()
    const first = state().tabId
    state().placePiece(cube, placementTransform(cube, { x: 10, y: 0, z: 0 }))
    const placed = state().selectedIds
    state().loadMap(named("B"), { name: "b.balledit", path: null }, undefined, { into: "newTab" })
    assert.strictEqual(state().doc.map.items.length, 1)
    assert.deepStrictEqual(state().selectedIds, [])
    assert.isFalse(state().dirty)

    state().activateTab(first)
    assert.deepStrictEqual(state().selectedIds, placed)
    assert.isTrue(state().dirty)
    assert.strictEqual(state().doc.map.items.length, 2)
    state().undo()
    assert.strictEqual(state().doc.map.items.length, 1)
  })

  it("closes a tab: the one after it becomes active, else the one before; the last tab stays", () => {
    oneTab()
    const first = state().tabId
    state().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 0 }))
    state().loadMap(named("B"), fileOf("b"), undefined, { into: "newTab" })
    const second = state().tabId
    state().loadMap(named("C"), fileOf("c"), undefined, { into: "newTab" })
    const third = state().tabId

    state().activateTab(second)
    state().closeTab(second)
    assert.deepStrictEqual(state().tabIds, [first, third])
    assert.strictEqual(state().tabId, third)
    state().closeTab(third)
    assert.strictEqual(state().tabId, first)
    assert.strictEqual(state().doc.map.items.length, 2)
    assert.strictEqual(state().parkedTabs.size, 0)
    state().closeTab(first)
    assert.deepStrictEqual(state().tabIds, [first])
  })

  describe("the last tab of a named project", () => {
    const NAMED: ProjectState = {
      current: { path: "/projects/Season 3", name: "Season 3", exists: true },
      recent: [],
      lastOpenMap: null,
      chooserRequired: false,
      openElsewhere: [],
      projectsFolder: "/projects",
      startRefused: null
    }
    /** A project's one tab, with its map; the project goes when the test does. */
    const inProject = (test: () => void) => () => {
      const { project } = state()
      oneTab()
      state().setProject(NAMED, [])
      state().loadMap(named("A"), fileOf("a"))
      try {
        test()
      } finally {
        useEditor.setState({ project })
        oneTab()
      }
    }
    const closeTheTab = () => state().closeTab(state().tabId)

    it(
      "closes, leaving no tab and nothing of it behind",
      inProject(() => {
        const closed = state().tabId
        closeTheTab()
        assert.isTrue(noTabOpen(state()))
        assert.deepStrictEqual(state().tabIds, [])
        assert.notStrictEqual(state().tabId, closed)
        assert.strictEqual(state().parkedTabs.size, 0)
        assert.isNull(state().file)
        assert.isFalse(state().dirty)
        assert.deepStrictEqual(state().doc.ids, [])
        assert.isUndefined(tabStateOf(state(), state().tabId))
      })
    )

    it(
      "keeps the window's title on the project, with no dot",
      inProject(() => {
        state().setLighting({ ...lightingOf(state().doc.map.worldSettings), timeOfDay: 3 })
        assert.strictEqual(windowTitleOf(state()), "• Season 3 – Ballest Editor")
        closeTheTab()
        assert.strictEqual(windowTitleOf(state()), "Season 3 – Ballest Editor")
      })
    )

    it(
      "edits nothing while no tab is open",
      inProject(() => {
        closeTheTab()
        const { doc } = state()
        state().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 0 }))
        state().placeGroup([], "Bridge")
        state().setLighting({ ...lightingOf(doc.map.worldSettings), timeOfDay: 3 })
        state().renameLevel("Other", "me")
        assert.strictEqual(state().doc, doc)
        assert.isFalse(state().dirty)
        assert.lengthOf(state().past, 0)
      })
    )

    it(
      "gives Save, Export and Play nothing to act on while no tab is open",
      inProject(() => {
        assert.isNull(saveProblemOf(state()))
        assert.isNull(exportProblemOf(state()))
        closeTheTab()
        assert.strictEqual(saveProblemOf(state()), NO_TAB_OPEN)
        assert.strictEqual(exportProblemOf(state()), NO_TAB_OPEN)
      })
    )

    for (const into of ["active", "newTab", "addedTab", "backgroundTab"] as const) {
      it(
        `opens the first tab again, as the active one (${into})`,
        inProject(() => {
          closeTheTab()
          const { mapShownRequest, tabId } = state()
          state().loadMap(named("B"), fileOf("b"), undefined, { into })
          assert.deepStrictEqual(state().tabIds, [tabId])
          assert.strictEqual(state().tabId, tabId)
          assert.strictEqual(state().file?.name, "b.balledit")
          assert.strictEqual(state().mapShownRequest, mapShownRequest + 1)
          assert.isFalse(noTabOpen(state()))
        })
      )
    }

    it(
      "stays while a drag is under way",
      inProject(() => {
        const { tabId } = state()
        state().setPreview(new Map())
        closeTheTab()
        state().setPreview(null)
        assert.deepStrictEqual(state().tabIds, [tabId])
      })
    )

    it(
      "says a definition's tab isn't a map, and closes like one",
      inProject(() => {
        state().patchTab(state().tabId, {
          document: { kind: "prefab", tier: "project", name: "Bridge", hash: "", file: emptyPrefab, sources: new Map() }
        })
        assert.strictEqual(exportProblemOf(state()), PREFAB_TAB_STAYS_HERE)
        closeTheTab()
        assert.strictEqual(state().document.kind, "map")
        assert.isTrue(noTabOpen(state()))
      })
    )
  })

  it("marks the tab a save started from as saved, even when another is active by then", () => {
    oneTab()
    const first = state().tabId
    state().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 0 }))
    const { doc } = state()
    state().loadMap(named("B"), fileOf("b"), undefined, { into: "newTab" })
    state().markSaved(first, doc, doc.map, fileOf("a"), null)
    assert.strictEqual(state().file?.name, "b.balledit")
    assert.include(state().parkedTabs.get(first), { dirty: false })
    assert.deepStrictEqual(state().parkedTabs.get(first)?.file, { name: "a.balledit", path: null })
  })

  it("doesn't switch tabs mid-drag", () => {
    oneTab()
    state().loadMap(named("A"), fileOf("a"), undefined, { into: "newTab" })
    const first = state().tabId
    state().loadMap(named("B"), fileOf("b"), undefined, { into: "newTab" })
    state().setLightingPreview(shownLighting(state()))
    state().activateTab(first)
    assert.notStrictEqual(state().tabId, first)
    state().setLightingPreview(null)
    state().activateTab(first)
    assert.strictEqual(state().tabId, first)
  })
})

describe("document structure", () => {
  const structure = () => state().doc.structure
  const tree = () => structure().tree
  /** The tree as nested lists: an item's key, or a group's name and children. */
  const shape = (nodes = tree()): ReadonlyArray<unknown> =>
    nodes.map((node) => node.kind === "item" ? node.key : [node.name, shape(node.children)])
  /** The store's one rule: `ids` and the tree hold the same items, each in one place. */
  const assertConsistent = () => {
    const placed = treeKeys(tree())
    assert.lengthOf(placed, state().doc.ids.length)
    assert.sameMembers([...placed], [...state().doc.ids])
  }
  /** A map of the player start and three cubes, and their keys. */
  const threeCubes = () => {
    mapWithCubes(0, 100, 200)
    const [start = "", a = "", b = "", c = ""] = state().doc.ids
    return { start, a, b, c }
  }
  /** Those cubes as `Outer` holding `Inner` (the first two cubes) and the third. */
  const nestedGroups = () => {
    const cubes = threeCubes()
    const inner = state().groupItems([cubes.a, cubes.b], "Inner")!
    const outer = state().groupItems([cubes.c], "Outer")!
    state().moveNodes([inner], outer, 0)
    return { ...cubes, inner }
  }
  /** `action` as one undo step: undo goes back to the shape before it, redo to the shape after. */
  const assertUndoable = (action: () => void) => {
    const before = state().doc
    const steps = state().past.length
    action()
    assertConsistent()
    assert.strictEqual(state().past.length, steps + 1)
    assert.isTrue(state().dirty)
    const after = state().doc
    state().undo()
    assert.strictEqual(state().doc, before)
    state().redo()
    assert.strictEqual(state().doc, after)
  }

  it("gives every item a key when it enters the document, one identity with the selection", () => {
    const { a } = threeCubes()
    assert.match(a, /^[\w-]{12}$/)
    assert.deepStrictEqual(state().selectedIds, state().doc.ids.slice(3))
    assertConsistent()
  })

  it("renames an item, and clears the name with null", () => {
    const { a } = threeCubes()
    assertUndoable(() => state().renameItem(a, "Left ramp"))
    assert.deepStrictEqual(structure().items.get(a), { name: "Left ramp" })
    assert.deepStrictEqual(nodeNamesOf(state()).get(a), { name: "Left ramp", ordinal: undefined })
    assertUndoable(() => state().renameItem(a, null))
    assert.isFalse(structure().items.has(a))
    const steps = state().past.length
    state().renameItem(a, null)
    state().renameItem("gone", "x")
    assert.strictEqual(state().past.length, steps)
  })

  it("groups items where the first key was, and answers the group's id", () => {
    const { a, b, c, start } = threeCubes()
    let id: string | undefined
    assertUndoable(() => {
      id = state().groupItems([b, c])
    })
    assert.deepStrictEqual(shape(), [start, a, ["Group", [b, c]]])
    const group = tree().find((node) => node.kind === "group")
    assert.strictEqual(group?.kind === "group" ? group.id : undefined, id)
    assert.isUndefined(state().groupItems(["gone"]))
  })

  it("pulls a selection that spans groups out of them, and a group left empty goes", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "One")
    state().groupItems([c], "Two")
    assertUndoable(() => state().groupItems([a, c], "Three"))
    assert.deepStrictEqual(shape(), [start, ["One", [["Three", [a, c]], b]]])
  })

  it("renames and tags a group, and tags an item", () => {
    const { a, b } = threeCubes()
    const id = state().groupItems([a, b])!
    assertUndoable(() => state().renameGroup(id, "Bridge"))
    assertUndoable(() => state().setTags(id, ["start", "start ", "fast"]))
    assertUndoable(() => state().setTags(a, ["fast"]))
    const group = tree().find((node) => node.kind === "group")
    assert.deepInclude(group, { name: "Bridge", tags: ["start", "fast"] })
    assert.deepStrictEqual(structure().items.get(a), { tags: ["fast"] })
    const steps = state().past.length
    state().renameGroup(id, " ")
    state().setTags(a, ["fast"])
    assert.strictEqual(state().past.length, steps)
  })

  it("ungroups into the parent, where the group was", () => {
    const { a, b, c, start } = nestedGroups()
    assert.deepStrictEqual(shape(), [start, ["Outer", [["Inner", [a, b]], c]]])
    state().select([a, b])
    assertUndoable(() => state().ungroupSelection())
    assert.deepStrictEqual(shape(), [start, ["Outer", [a, b, c]]])
  })

  it("moves nodes, refusing a group into itself", () => {
    const { a, b, c, start } = threeCubes()
    const id = state().groupItems([a, b], "G")!
    assertUndoable(() => state().moveNodes([c], id, 1))
    assert.deepStrictEqual(shape(), [start, ["G", [a, c, b]]])
    assertUndoable(() => state().moveNodes([id], null, 0))
    assert.deepStrictEqual(shape(), [["G", [a, c, b]], start])
    const steps = state().past.length
    state().moveNodes([id], id, 0)
    assert.strictEqual(state().past.length, steps)
  })

  it("places a new item loose at the end", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "G")
    assertUndoable(() => state().placePiece(cube, placementTransform(cube, { x: 300, y: 0, z: 0 })))
    assert.deepStrictEqual(shape(), [start, ["G", [a, b]], c, state().doc.ids[4]])
  })

  it("takes deleted items out of the tree with their data, and undo brings them back", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "G")
    state().renameItem(a, "Named")
    state().select([a, b])
    assertUndoable(() => state().deleteSelection())
    assert.deepStrictEqual(shape(), [start, c])
    assert.isFalse(structure().items.has(a))
    state().undo()
    assert.deepStrictEqual(shape(), [start, ["G", [a, b]], c])
    assert.deepStrictEqual(structure().items.get(a), { name: "Named" })
  })

  it("duplicates a whole group as a new group beside it, keeping names and tags", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "G")
    state().renameItem(a, "Named")
    state().setTags(b, ["t"])
    state().select([a, b])
    assertUndoable(() => state().duplicateSelection())
    const [copyA = "", copyB = ""] = state().selectedIds
    assert.deepStrictEqual(shape(), [start, ["G", [a, b]], ["G", [copyA, copyB]], c])
    assert.deepStrictEqual(structure().items.get(copyA), { name: "Named" })
    assert.deepStrictEqual(structure().items.get(copyB), { tags: ["t"] })
    const groups = tree().flatMap((node) => node.kind === "group" ? [node.id] : [])
    assert.strictEqual(new Set(groups).size, 2)
  })

  it("duplicates nested groups with their shape", () => {
    const { a, b, c, start } = nestedGroups()
    state().select([a, b, c])
    state().duplicateSelection()
    const [copyA, copyB, copyC] = state().selectedIds
    assert.deepStrictEqual(shape(), [
      start,
      ["Outer", [["Inner", [a, b]], c]],
      ["Outer", [["Inner", [copyA, copyB]], copyC]]
    ])
    assertConsistent()
  })

  it("keeps a copy of part of a group in that group", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "G")
    state().select([a])
    state().duplicateSelection()
    assert.deepStrictEqual(shape(), [start, ["G", [a, state().selectedIds[0], b]], c])
  })

  it("cuts and pastes a group with its structure", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "G")
    state().select([a, b])
    assertUndoable(() => state().cutSelection())
    assert.deepStrictEqual(shape(), [start, c])
    assertUndoable(() => state().paste())
    const [copyA, copyB] = state().selectedIds
    assert.deepStrictEqual(shape(), [start, c, ["G", [copyA, copyB]]])
  })

  it("pastes into another tab's map, where the sources don't exist", () => {
    const { a, b } = threeCubes()
    state().groupItems([a, b], "G")
    state().select([a, b])
    state().copySelection()
    state().loadMap(startOnlyMap(), null, undefined, { into: "newTab" })
    state().paste()
    assertConsistent()
    assert.deepStrictEqual(shape(), [state().doc.ids[0], ["G", [...state().selectedIds]]])
  })

  it("keeps the tree through an Alt+drag duplicate, committed or cancelled", () => {
    const { a, b, c, start } = threeCubes()
    state().groupItems([a, b], "G")
    state().select([a, b])
    const before = state().doc
    state().beginDuplicateDrag()
    assertConsistent()
    assert.strictEqual(state().endDuplicateDrag(null), false)
    assert.strictEqual(state().doc, before)

    const copies = state().beginDuplicateDrag()!
    const [copyA = "", copyB = ""] = [...copies.values()]
    const moved = new Map(
      [...copies.values()].map((id) => [id, { ...transformOf(id), translation: { x: 1, y: 2, z: 3 } }])
    )
    assert.isTrue(state().endDuplicateDrag(moved))
    assertConsistent()
    assert.deepStrictEqual(shape(), [start, ["G", [a, b]], ["G", [copyA, copyB]], c])
    state().undo()
    assert.strictEqual(state().doc, before)
  })

  it("loads what a sidecar gives, keeping keys and structure", () => {
    const { a, b } = threeCubes()
    state().groupItems([a, b], "G")
    state().renameItem(a, "Named")
    const { doc } = state()
    const hash = "a".repeat(64)
    const sidecar = sidecarOf(doc.map, doc.ids, doc.structure, hash)
    state().loadMap(doc.map, null, undefined, { loaded: loadStructure(doc.map, hash, sidecar) })
    assert.deepStrictEqual(state().doc.ids, doc.ids)
    assert.deepStrictEqual(state().doc.structure.tree, doc.structure.tree)
    assert.deepStrictEqual(structure().items.get(a), { name: "Named" })
  })

  it("makes a tree of the game groups of a map that has no sidecar", () => {
    const map = startOnlyMap()
    const { ids } = structureOfMap(map)
    assert.lengthOf(ids, 1)
    state().loadMap(map, null)
    assertConsistent()
  })

  it("projects its groups into the map the game gets, and the document's own map isn't touched", () => {
    const { a, b } = threeCubes()
    state().groupItems([a, b], "G 1")
    const { doc } = state()
    assert.deepStrictEqual(gameMapOf(doc, null).editorState?.groups.map((g) => [g.members, g.name]), [[[1, 2], "G1"]])
    assert.deepStrictEqual(doc.map.editorState?.groups, [])
  })
})

describe("the gizmo's axes", () => {
  it("scales along the items' own axes, and gives the toggle's choice back after", () => {
    state().loadMap(startOnlyMap(), null)
    state().setTool("translate")
    useEditor.setState({ gizmoSpace: "world" })
    assert.strictEqual(shownGizmoSpace(state()), "world")
    state().setTool("scale")
    assert.strictEqual(shownGizmoSpace(state()), "local")
    state().setTool("rotate")
    assert.strictEqual(shownGizmoSpace(state()), "world")
  })

  it("holds the toggle under Scale, so nothing changes out of sight", () => {
    state().loadMap(startOnlyMap(), null)
    useEditor.setState({ gizmoSpace: "world" })
    state().setTool("scale")
    state().toggleGizmoSpace()
    assert.strictEqual(state().gizmoSpace, "world")
    state().setTool("translate")
    state().toggleGizmoSpace()
    assert.strictEqual(state().gizmoSpace, "local")
    state().setTool("scale")
    state().setTool("translate")
    assert.strictEqual(shownGizmoSpace(state()), "local")
    useEditor.setState({ gizmoSpace: "world" })
  })
})

describe("groups and the selection", () => {
  /** A new map with four cubes: inner > (a, b) and outer > (inner, c), then d loose; nothing selected. */
  const nestedMap = () => {
    mapWithCubes(0, 100, 200, 300)
    const [, a, b, c, d] = state().doc.ids
    const inner = state().groupItems([a!, b!], "Inner")!
    const outer = state().groupItems([inner, c!], "Outer")!
    state().select([])
    return { a: a!, b: b!, c: c!, d: d!, inner, outer }
  }
  const selected = () => [...state().selectedIds].sort()
  const sorted = (...keys: ReadonlyArray<string>) => [...keys].sort()

  it("selects the outermost group on a click, with the clicked item active", () => {
    const { a, b, c } = nestedMap()
    state().clickItem(b, "replace")
    assert.deepStrictEqual(selected(), sorted(a, b, c))
    assert.strictEqual(state().selectedIds.at(-1), b)
  })

  it("adds and toggles a whole group", () => {
    const { a, b, c, d } = nestedMap()
    state().clickItem(d, "replace")
    state().clickItem(a, "add")
    assert.deepStrictEqual(selected(), sorted(a, b, c, d))
    state().clickItem(b, "toggle")
    assert.deepStrictEqual(selected(), [d])
    state().clickItem(null, "toggle")
    assert.deepStrictEqual(selected(), [d])
  })

  it("enters a level per double-click", () => {
    const { a, b, inner, outer } = nestedMap()
    state().doubleClickItem(a)
    assert.strictEqual(state().enteredGroupId, outer)
    assert.deepStrictEqual(selected(), sorted(a, b))
    state().doubleClickItem(a)
    assert.strictEqual(state().enteredGroupId, inner)
    assert.deepStrictEqual(selected(), [a])
    state().doubleClickItem(a)
    assert.strictEqual(state().enteredGroupId, inner)
  })

  it("clicks at the entered level", () => {
    const { a, b, c, outer } = nestedMap()
    state().doubleClickItem(a)
    state().clickItem(c, "replace")
    assert.deepStrictEqual(selected(), [c])
    state().clickItem(b, "replace")
    assert.deepStrictEqual(selected(), sorted(a, b))
    assert.strictEqual(state().enteredGroupId, outer)
  })

  it("stays on a click on empty space, and leaves on one outside the group", () => {
    const { a, d } = nestedMap()
    state().doubleClickItem(a)
    const entered = state().enteredGroupId
    assert.isNotNull(entered)
    state().clickItem(null, "add")
    assert.strictEqual(state().enteredGroupId, entered)
    state().clickItem(null, "replace")
    assert.strictEqual(state().enteredGroupId, entered)
    assert.deepStrictEqual(selected(), [])
    state().clickItem(d, "replace")
    assert.isNull(state().enteredGroupId)
    assert.deepStrictEqual(selected(), [d])
  })

  it("takes all of the entered group as its members: Group nests them, Ungroup leaves it be", () => {
    const { a, b, c, inner, outer } = nestedMap()
    state().enterGroup(outer)
    state().select([a, b, c])
    state().ungroupSelection()
    assert.isDefined(findGroup(state().doc.structure.tree, outer))
    assert.isUndefined(findGroup(state().doc.structure.tree, inner))
    state().groupSelection()
    const group = findGroup(state().doc.structure.tree, outer)
    assert.strictEqual(group?.children.length, 1)
    assert.strictEqual(group?.children[0]?.kind, "group")
  })

  it("steps out one level on deselect, then clears", () => {
    const { a, b, c, outer } = nestedMap()
    state().doubleClickItem(a)
    state().doubleClickItem(a)
    state().deselect()
    assert.strictEqual(state().enteredGroupId, outer)
    assert.deepStrictEqual(selected(), sorted(a, b))
    state().deselect()
    assert.isNull(state().enteredGroupId)
    assert.deepStrictEqual(selected(), sorted(a, b, c))
    state().deselect()
    assert.deepStrictEqual(selected(), [])
  })

  it("forgets an entered group that goes, and one undo brings back", () => {
    const { a, inner } = nestedMap()
    state().select(nodeKeys(state().doc.structure.tree, inner))
    state().enterGroup(inner)
    state().deleteSelection()
    assert.isNull(state().enteredGroupId)
    state().enterGroup("gone")
    state().undo()
    assert.isNull(state().enteredGroupId)
    state().doubleClickItem(a)
    assert.isNotNull(state().enteredGroupId)
  })

  it("keeps the entered group and the collapsed groups per tab", () => {
    const { inner, outer } = nestedMap()
    state().enterGroup(inner)
    state().setGroupCollapsed(outer, true)
    const first = state().tabId
    state().loadMap(startOnlyMap(), null, undefined, { into: "newTab" })
    assert.isNull(state().enteredGroupId)
    assert.strictEqual(state().collapsedGroups.size, 0)
    state().activateTab(first)
    assert.strictEqual(state().enteredGroupId, inner)
    assert.isTrue(state().collapsedGroups.has(outer))
  })

  it("keeps collapsed groups out of the history", () => {
    const { a, outer } = nestedMap()
    const steps = state().past.length
    state().setGroupCollapsed(outer, true)
    assert.strictEqual(state().past.length, steps)
    state().renameItem(a, "Named")
    state().undo()
    assert.isTrue(state().collapsedGroups.has(outer))
    state().expandGroups([outer])
    assert.isFalse(state().collapsedGroups.has(outer))
  })

  it("pivots a whole group on the centre of its members, and anything else on the active item", () => {
    const { a, b, c, d } = nestedMap()
    const pivot = () => selectionPivot(state(), transformOf)
    const turned = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    transformItem(b, { ...transformOf(b), rotation: turned })
    state().select([a, b, c])
    // no catalog here, so each member counts as its origin: x 0 to 200
    assert.deepStrictEqual(pivot()?.pivot, { x: 100, y: 0, z: transformOf(a).translation.z })
    assert.deepStrictEqual(pivot()?.rotation, { x: 0, y: 0, z: 0, w: 1 })
    assert.deepStrictEqual(pivot()?.activePivot, transformOf(c).translation)
    // a group and a loose piece: the game goes back to the active item
    state().select([a, b, c, d])
    assert.deepStrictEqual(pivot()?.pivot, transformOf(d).translation)
    state().select([d, a, c, b])
    assert.deepStrictEqual(pivot()?.rotation, transformOf(b).rotation)
    state().select([])
    assert.isUndefined(pivot())
  })

  it("holds the pivot setting at Together until two units are selected, and toggles it", () => {
    const { a, b, c, d } = nestedMap()
    assert.strictEqual(state().pivotMode, "together")
    state().togglePivotMode()
    assert.strictEqual(state().pivotMode, "each")
    state().select([a, b, c])
    assert.strictEqual(shownPivotMode(state()), "together", "one whole group is one unit")
    state().select([a, b, c, d])
    assert.strictEqual(shownPivotMode(state()), "each")
    // in Each the gizmo sits on the active unit, which is the group when its item is active
    state().select([d, a, b, c])
    assert.deepStrictEqual(selectionPivot(state(), transformOf)?.pivot, {
      x: 100,
      y: 0,
      z: transformOf(a).translation.z
    })
    state().togglePivotMode()
    assert.deepStrictEqual(selectionPivot(state(), transformOf)?.pivot, transformOf(c).translation)
  })

  it("sets, freezes and clears a group's pivot as undo steps, and carries a Point with a move", () => {
    const { a, b, c, outer } = nestedMap()
    const groupPivot = () => findGroup(state().doc.structure.tree, outer)?.pivot
    state().select([a, b, c])
    const steps = state().past.length
    state().setGroupPivot(outer, { choice: "Top" })
    assert.deepStrictEqual(groupPivot(), { choice: "Top" })
    state().freezeGroupPivot(outer)
    // frozen where the Top pivot was: the top of the members' box (no catalog, so each is its origin)
    assert.deepStrictEqual(groupPivot(), { choice: "point", world: { x: 100, y: 0, z: transformOf(a).translation.z } })
    assert.strictEqual(state().past.length, steps + 2, "two pivot edits")
    // a move of the whole group takes the point along; a move of one member doesn't
    state().transformItems(
      new Map(
        [a, b, c].map((id) => [id, { ...transformOf(id), translation: { ...transformOf(id).translation, y: 50 } }])
      )
    )
    assert.deepStrictEqual(groupPivot(), { choice: "point", world: { x: 100, y: 50, z: transformOf(a).translation.z } })
    moveItem(a, { ...transformOf(a).translation, y: 500 })
    const kept = groupPivot()
    assert.strictEqual(kept?.choice === "point" ? kept.world.y : undefined, 50)
    state().setGroupPivot(outer, undefined)
    assert.isUndefined(groupPivot())
    state().undo()
    assert.strictEqual(groupPivot()?.choice, "point")
  })

  it("shows a Point pivot carried by a live move, and left alone by a live turn or scale", () => {
    const { a, b, c, outer } = nestedMap()
    state().select([a, b, c])
    state().setGroupPivot(outer, { choice: "point", world: { x: 0, y: 0, z: 0 } })
    const shown = (edit: (t: UeTransform, i: number) => UeTransform) => {
      const live = new Map([a, b, c].map((id, i) => [id, edit(transformOf(id), i)]))
      return selectionPivot(state(), (id) => live.get(id) ?? transformOf(id))?.pivot
    }
    // offsets that differ only by floating-point noise still count as one move
    const by = (t: UeTransform, i: number) => ({
      ...t,
      translation: { ...t.translation, x: t.translation.x + 0.1 + (i === 0 ? 0 : 1e-12) }
    })
    assert.closeTo(shown(by)?.x ?? NaN, 0.1, 1e-9)
    const turned = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    assert.deepStrictEqual(shown((t) => ({ ...t, rotation: turned })), { x: 0, y: 0, z: 0 })
    assert.deepStrictEqual(shown((t) => ({ ...t, scale3D: { x: 2, y: 1, z: 1 } })), { x: 0, y: 0, z: 0 })
  })

  it("makes, reverses and unmakes a chain, and groups a selection as one from the first selected", () => {
    mapWithCubes(0, 100, 200)
    const [a = "", b = "", c = ""] = state().doc.ids.slice(1)
    state().select([c, a, b])
    state().chainSelection()
    const chain = state().doc.structure.tree.find((n) => n.kind === "group")
    assert.strictEqual(chain?.kind === "group" ? chain.chain : undefined, true)
    assert.strictEqual(chain?.kind === "group" ? chain.name : undefined, "Chain", "a default name follows")
    assert.deepStrictEqual(chain?.kind === "group" ? treeKeys(chain.children) : [], [c, b, a], "along the row from c")
    const id = chain?.kind === "group" ? chain.id : ""
    state().reverseChain(id)
    assert.deepStrictEqual(treeKeys(findGroup(state().doc.structure.tree, id)!.children), [a, b, c])
    state().setChain(id, false)
    assert.isUndefined(findGroup(state().doc.structure.tree, id)?.chain)
    assert.strictEqual(findGroup(state().doc.structure.tree, id)?.name, "Group", "and back")
    state().undo()
    assert.strictEqual(findGroup(state().doc.structure.tree, id)?.chain, true)
    // a name the user gave stays either way
    state().renameGroup(id, "Finger")
    state().setChain(id, false)
    assert.strictEqual(findGroup(state().doc.structure.tree, id)?.name, "Finger")
    state().setChain(id, true)
    assert.strictEqual(findGroup(state().doc.structure.tree, id)?.name, "Finger")
    // a growth is one undo step, and goes with the chain
    const steps = state().past.length
    state().setChainGrowth(id, { curve: "compound", percent: 20 })
    state().setChainGrowth(id, { curve: "compound", percent: 20 })
    assert.strictEqual(state().past.length, steps + 1, "the same growth again is no step")
    assert.deepStrictEqual(findGroup(state().doc.structure.tree, id)?.growth, { curve: "compound", percent: 20 })
    state().setChain(id, false)
    assert.isUndefined(findGroup(state().doc.structure.tree, id)?.growth)
    state().setChain(id, true)
    assert.isUndefined(findGroup(state().doc.structure.tree, id)?.growth, "a chain made again starts even")
    state().setChainGrowth(id, { curve: "linear", percent: 5 })
    state().setChainGrowth(id, undefined)
    assert.isUndefined(findGroup(state().doc.structure.tree, id)?.growth)
  })

  it("orders a chain's links along its pieces as they lie, from the first selected", () => {
    // placed in blocks, so the document order isn't the order along the row
    mapWithCubes(0, 2000, 3000, 1000)
    const [a = "", b = "", c = "", d = ""] = state().doc.ids.slice(1)
    const linksOf = (id: string) => treeKeys(findGroup(state().doc.structure.tree, id)!.children)
    state().select([a, b, c, d])
    state().groupSelection()
    const { id } = state().doc.structure.tree.find((n) => n.kind === "group")!
    state().setChain(id, true)
    assert.deepStrictEqual(linksOf(id), [a, d, b, c], "Make chain on a group")
    state().undo()
    state().undo()
    state().select([c, a, d, b])
    state().chainSelection()
    const chain = state().doc.structure.tree.find((n) => n.kind === "group")!
    assert.deepStrictEqual(linksOf(chain.id), [c, b, d, a], "Make chain on a selection")
  })

  it("lays a chain along a shape as one undo step, and nothing that isn't a chain", () => {
    mapWithCubes(0, 1000, 2000)
    const [a = "", b = "", c = ""] = state().doc.ids.slice(1)
    state().select([a, b, c])
    state().chainSelection()
    const { id } = state().doc.structure.tree.find((n) => n.kind === "group")!
    const before = [a, b, c].map(transformOf)
    const steps = state().past.length
    assert.isTrue(state().layChain(id, { kind: "helix", axis: { x: 0, y: 0, z: 1 }, turn: 90, rise: 100 }))
    assert.strictEqual(state().past.length, steps + 1)
    assert.deepStrictEqual(transformOf(a).translation, before[0]!.translation, "the first link stays")
    assert.closeTo(transformOf(b).translation.z - transformOf(a).translation.z, 100, 1e-6, "and the next climbs")
    assert.closeTo(transformOf(c).translation.z, 200, 1e-6)
    state().undo()
    assert.deepStrictEqual([a, b, c].map(transformOf), before)
    assert.isFalse(state().layChain(a, { kind: "straight" }))
  })

  it("chains one whole group selected in place, and bends it link by link at once, without entering it", () => {
    const { a, b, c, d, outer } = nestedMap()
    state().select([a, b, c])
    state().chainSelection()
    assert.strictEqual(findGroup(state().doc.structure.tree, outer)?.chain, true, "the group itself")
    assert.strictEqual(state().enteredGroupId, null)
    assert.isTrue(isShownChain(state()))
    assert.strictEqual(shownPivotMode(state()), "each", "a new chain goes link by link, so a turn bends it")
    assert.deepStrictEqual(shownChainStart(state()), selectionPivot(state(), transformOf)?.pivot, "link 1, its pivot")
    // the period key flips the chain's setting, and leaves the pivot setting alone
    state().togglePivotMode()
    assert.strictEqual(state().chainMode, "rigid")
    assert.strictEqual(state().pivotMode, "together")
    assert.strictEqual(shownPivotMode(state()), "together", "Rigid")
    state().togglePivotMode()
    // a chain among other units follows the pivot setting, and has no start to mark
    state().select([a, b, c, d])
    assert.isFalse(isShownChain(state()))
    assert.strictEqual(shownPivotMode(state()), "together")
    assert.isUndefined(shownChainStart(state()))
    state().togglePivotMode()
    assert.strictEqual(state().chainMode, "links")
    assert.strictEqual(shownPivotMode(state()), "each")
    state().togglePivotMode()
  })

  it("pivots a prefab instance on its origin, and follows a live move", () => {
    mapWithCubes(0, 1000)
    const [, a, b] = state().doc.ids
    const pair = [a!, b!].map((key) => state().doc.map.items[state().doc.ids.indexOf(key)]!)
    // saved with real bounds, a cube's origin being the middle of its base; this test's store has no catalog, so its
    // own idea of the middle is off from the point the offsets count from
    const made = prefabOfItems(pair, indexCatalog(Schema.decodeUnknownSync(Catalog)(fixture)))
    const { items, link } = definitionOf(made, { tier: "user", name: "Pair", hash: "a".repeat(64) }, null)
    const shifted = items.map((item) => ({
      ...item,
      itemTransform: {
        ...item.itemTransform,
        translation: { ...item.itemTransform.translation, x: item.itemTransform.translation.x + 5000 }
      }
    }))
    state().placeGroup(shifted, "Pair", link)
    const keys = [...state().selectedIds]
    const origin = selectionPivot(state(), transformOf)?.pivot
    assert.closeTo(origin?.x ?? 0, 5000, 0.01)
    assert.closeTo(origin?.z ?? 1, 0, 0.01)
    const live = (id: string) => {
      const t = transformOf(id)
      return { ...t, translation: { ...t.translation, x: t.translation.x + 300 } }
    }
    assert.closeTo(selectionPivot(state(), live)?.pivot.x ?? 0, 5300, 0.01)
    const landing: RigidDelta = {
      kind: "rigid",
      about: { x: 0, y: 0, z: 0 },
      offset: { x: 100, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    }
    state().setPreview(
      new Map(keys.map((key) => [key, applyGroupDelta(transformOf(key), { x: 0, y: 0, z: 0 }, landing)])),
      landing
    )
    const previewPivot = selectionPivot(state(), (key) => shownTransform(state(), key))?.pivot
    assert.closeTo(previewPivot?.x ?? 0, 100, 0.01)
    assert.closeTo(previewPivot?.y ?? 0, 5000, 0.01)
    state().setPreview(null)
    assert.closeTo(selectionPivot(state(), transformOf)?.pivot.x ?? 0, 5000, 0.01)
    // edited, it has no origin left, so it's any group
    moveItem(keys[0]!, { ...transformOf(keys[0]!).translation, x: 9000 })
    assert.isAbove(Math.abs(selectionPivot(state(), transformOf)?.pivot.z ?? 0), 1)
  })

  it("groups the selection, whole groups staying whole", () => {
    const { a, b, c, d, outer } = nestedMap()
    state().select([a, b, c, d])
    state().groupSelection()
    const top = state().doc.structure.tree.find((node) => node.kind === "group")
    assert.deepStrictEqual(top?.kind === "group" ? top.children.map((n) => n.kind === "group" ? n.id : n.key) : [], [
      outer,
      d
    ])
    assert.deepStrictEqual(selected(), sorted(a, b, c, d))
    state().undo()
    assert.strictEqual(state().doc.structure.tree.filter((node) => node.kind === "group").length, 1)
  })

  it("won't wrap one whole group in another", () => {
    const { a, b, c } = nestedMap()
    state().select([a, b, c])
    const steps = state().past.length
    state().groupSelection()
    assert.strictEqual(state().past.length, steps)
  })

  it("ungroups every whole group in the selection as one step", () => {
    const { a, b, c, d } = nestedMap()
    state().select([d])
    state().groupSelection()
    state().select([a, b, c, d])
    const steps = state().past.length
    state().ungroupSelection()
    assert.strictEqual(state().past.length, steps + 1)
    assert.deepStrictEqual(selected(), sorted(a, b, c, d))
  })

  it("moves several nodes as one undo step", () => {
    const { a, c, d, inner } = nestedMap()
    const steps = state().past.length
    state().moveNodes([c, d], inner, 0)
    assert.strictEqual(state().past.length, steps + 1)
    assert.deepStrictEqual(treeKeys(state().doc.structure.tree).slice(1, 4), [c, d, a])
    state().undo()
    assert.strictEqual(state().past.length, steps)
  })

  it("deletes and duplicates a group through the expanded selection", () => {
    const { a, c } = nestedMap()
    const groups = () => state().doc.structure.tree.filter((node) => node.kind === "group").length
    state().clickItem(a, "replace")
    state().duplicateSelection()
    assert.strictEqual(groups(), 2)
    assert.strictEqual(state().selectedIds.length, 3)
    state().deleteSelection()
    assert.strictEqual(groups(), 1)
    state().clickItem(c, "replace")
    state().deleteSelection()
    assert.strictEqual(groups(), 0)
  })
})

describe("view panes", () => {
  const twoTabs = () => {
    const first = useEditor.getState().tabId
    useEditor.getState().loadMap(initialMap(), null, undefined, { into: "newTab" })
    return { first, second: useEditor.getState().tabId }
  }
  /** One tab on a map of its own, whatever came before. */
  const resetStore = () => {
    useEditor.setState({ tabIds: [state().tabId], parkedTabs: new Map() })
    state().loadMap(initialMap(), null)
  }

  it("keeps each tab's layout and active pane as it was left", () => {
    resetStore()
    const { first, second } = twoTabs()
    state().setViewLayoutKind("quad")
    state().setActivePane(3)
    state().setPaneProjection(3, "bottom")
    state().activateTab(first)
    assert.strictEqual(state().viewLayout.kind, "single")
    assert.strictEqual(state().activePane, 0)
    state().activateTab(second)
    assert.strictEqual(state().viewLayout.kind, "quad")
    assert.strictEqual(state().activePane, 3)
    assert.strictEqual(state().viewLayout.projections[3], "bottom")
  })

  it("opens a map on the layout remembered for it, or the default", () => {
    resetStore()
    const viewLayout = { ...defaultViewLayout, kind: "rows" as const }
    state().loadMap(initialMap(), null, undefined, { viewLayout })
    assert.deepStrictEqual(state().viewLayout, viewLayout)
    state().loadMap(initialMap(), null)
    assert.deepStrictEqual(state().viewLayout, defaultViewLayout)
  })

  it("moves the active pane when a smaller layout no longer shows it", () => {
    resetStore()
    state().setViewLayoutKind("quad")
    state().setActivePane(3)
    state().setViewLayoutKind("columns")
    assert.strictEqual(state().activePane, 1)
    state().setViewLayoutKind("single")
    assert.strictEqual(state().activePane, 0)
  })

  it("makes a maximised pane the active one, and keeps it there going back", () => {
    resetStore()
    state().setViewLayoutKind("quad")
    state().togglePaneMaximised(2)
    assert.strictEqual(state().viewLayout.maximised, 2)
    assert.strictEqual(state().activePane, 2)
    state().togglePaneMaximised(2)
    assert.isUndefined(state().viewLayout.maximised)
    assert.strictEqual(state().viewLayout.kind, "quad")
    assert.strictEqual(state().activePane, 2)
  })

  it("picking a layout ends a maximised pane", () => {
    resetStore()
    state().setViewLayoutKind("quad")
    state().togglePaneMaximised(3)
    state().setViewLayoutKind("columns")
    assert.isUndefined(state().viewLayout.maximised)
    assert.strictEqual(state().activePane, 1)
  })

  it("opens on the pane a map was left maximised on", () => {
    resetStore()
    const viewLayout = { ...defaultViewLayout, kind: "quad" as const, maximised: 3 as const }
    state().loadMap(initialMap(), null, undefined, { viewLayout })
    assert.strictEqual(state().activePane, 3)
  })

  it("keeps a tab's dividers while another tab is in front", () => {
    resetStore()
    const { first, second } = twoTabs()
    state().setViewLayoutKind("quad")
    state().setPaneSplit({ x: 0.3, y: 0.7 })
    state().activateTab(first)
    assert.strictEqual(state().viewLayout.splitX, 0.5)
    state().activateTab(second)
    assert.strictEqual(state().viewLayout.splitX, 0.3)
    assert.strictEqual(state().viewLayout.splitY, 0.7)
  })

  it("keeps what a hidden slot looks along", () => {
    resetStore()
    state().setViewLayoutKind("quad")
    state().setPaneProjection(2, "back")
    state().setViewLayoutKind("single")
    state().setViewLayoutKind("quad")
    assert.deepStrictEqual(state().viewLayout.projections, ["perspective", "top", "back", "right"])
  })

  it("holds the dividers off the edges and moves them one at a time", () => {
    resetStore()
    state().setPaneSplit({ x: 0.01 })
    assert.strictEqual(state().viewLayout.splitX, 0.1)
    assert.strictEqual(state().viewLayout.splitY, 0.5)
    state().setPaneSplit({ y: 2 })
    assert.strictEqual(state().viewLayout.splitX, 0.1)
    assert.strictEqual(state().viewLayout.splitY, 0.9)
  })

  it("doesn't touch the map, its history or the dirty flag", () => {
    resetStore()
    const { doc, past } = state()
    state().setViewLayoutKind("quad")
    state().setPaneProjection(0, "top")
    state().setPaneSplit({ x: 0.3 })
    state().setActivePane(1)
    assert.strictEqual(state().doc, doc)
    assert.strictEqual(state().past, past)
    assert.isFalse(state().dirty)
  })

  it("frames the whole map in every pane when one is loaded, and only the active pane on request", () => {
    resetStore()
    const { frameAllRequest, mapShownRequest } = state()
    state().requestFrameAll()
    assert.strictEqual(state().frameAllRequest, frameAllRequest + 1)
    assert.strictEqual(state().mapShownRequest, mapShownRequest)
    state().loadMap(initialMap(), null)
    assert.strictEqual(state().frameAllRequest, frameAllRequest + 1)
    assert.strictEqual(state().mapShownRequest, mapShownRequest + 1)
  })
})

describe("the Validate result", () => {
  const validated = () => {
    mapWithCubes(0, 100)
    state().validateDoc()
    assert.isDefined(shownValidation(state()))
  }

  it("is there only once Validate has run", () => {
    mapWithCubes(0)
    assert.isUndefined(shownValidation(state()))
  })

  it("outlasts a selection change, which edits nothing", () => {
    validated()
    state().select([state().doc.ids[0]!])
    state().deselect()
    assert.isDefined(shownValidation(state()))
  })

  it("goes with the next edit, and undo is an edit of its own", () => {
    validated()
    moveItem(state().doc.ids[1]!, { x: 5, y: 0, z: 0 })
    assert.isUndefined(shownValidation(state()))
    state().undo()
    assert.isDefined(shownValidation(state()), "the document it was run on, as it was")
    moveItem(state().doc.ids[1]!, { x: 9, y: 0, z: 0 })
    state().validateDoc()
    state().undo()
    assert.isUndefined(shownValidation(state()))
  })

  it("outlasts a Save, which edits nothing", () => {
    validated()
    const { doc } = state()
    state().markSaved(state().tabId, doc, { ...doc.map }, { name: "saved.balledit", path: null }, null)
    assert.notStrictEqual(state().doc, doc)
    assert.isDefined(shownValidation(state()))
  })

  it("stays with its tab", () => {
    validated()
    const { tabId } = state()
    state().loadMap(startOnlyMap(), { name: "b.balledit", path: null }, undefined, { into: "newTab" })
    assert.isUndefined(shownValidation(state()))
    state().activateTab(tabId)
    assert.isDefined(shownValidation(state()))
  })
})
