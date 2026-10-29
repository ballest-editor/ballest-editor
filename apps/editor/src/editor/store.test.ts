import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { placementTransform } from "../domain/factory"
import { isPlayerStart } from "../domain/MapFile"
import { defaultSettings } from "../domain/Settings"
import { initialMap, nextSelection, useEditor } from "./store"

const cube = Schema.decodeUnknownSync(Catalog)(fixture).pieces.find((p) => p.className === "BP_Prim_Cube")!

const state = () => useEditor.getState()
const transformOf = (id: string) => state().doc.map.items[state().doc.ids.indexOf(id)]!.itemTransform
const transformItem = (id: string, t: UeTransform) => state().transformItems(new Map([[id, t]]))
const moveItem = (id: string, translation: Vec3) => transformItem(id, { ...transformOf(id), translation })

describe("editor store", () => {
  it("places, moves, deletes, and undoes/redoes", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
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
    s().loadMap(initialMap(), null)
    assert.strictEqual(s().floorHeight, 8615)
    const start = s().doc.ids[0]!
    moveItem(start, { x: 0, y: 0, z: 500 })
    assert.strictEqual(s().floorHeight, 8615)
    s().loadMap(s().doc.map, null)
    assert.strictEqual(s().floorHeight, 500)
  })

  it("reports whether a transform was accepted", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    s().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 0 }))
    const id = s().selectedIds[0]!
    const t = s().doc.map.items[1]!.itemTransform
    assert.isTrue(transformItem(id, { ...t, rotation: { x: 0, y: 0, z: 2, w: 0 } }))
    assert.deepStrictEqual(s().doc.map.items[1]!.itemTransform.rotation, { x: 0, y: 0, z: 1, w: 0 })
    const before = s().past.length
    assert.isFalse(transformItem(id, { ...t, rotation: { x: 0, y: 0, z: 0, w: 0 } }))
    assert.strictEqual(s().past.length, before)
  })

  describe("history", () => {
    const s = () => useEditor.getState()
    const place = (x: number) => {
      s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
      return s().selectedIds[0]!
    }
    const translationOf = (id: string) => s().doc.map.items[s().doc.ids.indexOf(id)]!.itemTransform.translation

    it("puts every kind of edit on the stack, and loading a map clears it", () => {
      s().loadMap(initialMap(), null)
      const id = place(0)
      moveItem(id, { x: 5, y: 0, z: 0 })
      const t = s().doc.map.items[1]!.itemTransform
      transformItem(id, { ...t, scale3D: { x: 2, y: 2, z: 2 } })
      s().renameLevel("Renamed", "me")
      s().deleteSelection()
      assert.strictEqual(s().past.length, 5)
      s().loadMap(initialMap(), null)
      assert.strictEqual(s().past.length, 0)
      assert.strictEqual(s().future.length, 0)
      assert.isFalse(s().dirty)
    })

    it("leaves no step for edits that change nothing", () => {
      s().loadMap(initialMap(), null)
      const id = place(10)
      const before = s().past.length
      moveItem(id, { x: 10, y: 0, z: 0 })
      assert.isTrue(transformItem(id, s().doc.map.items[1]!.itemTransform)) // a drag that ended where it began
      const { levelDisplayName, creatorName } = s().doc.map.worldSettings.levelData
      s().renameLevel(levelDisplayName, creatorName)
      assert.strictEqual(s().past.length, before)
    })

    it("clears the redo stack on a new edit", () => {
      s().loadMap(initialMap(), null)
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
      s().loadMap(initialMap(), null)
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
      s().loadMap(initialMap(), null)
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

    const withUndoSelection = (on: boolean) =>
      s().setSettings({ ...defaultSettings, general: { ...defaultSettings.general, undoSelection: on } })

    it("doesn't record selection changes by default", () => {
      withUndoSelection(false)
      s().loadMap(initialMap(), null)
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
        s().loadMap(initialMap(), null)
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
        s().loadMap(initialMap(), null)
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
        s().loadMap(initialMap(), null)
        const a = place(0)
        for (let i = 0; i < 250; i++) s().select(i % 2 === 0 ? [] : [a])
        assert.strictEqual(s().past.length, 200)
      } finally {
        withUndoSelection(false)
      }
    })

    it("keeps at most 200 steps", () => {
      s().loadMap(initialMap(), null)
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
      s().loadMap(initialMap(), null)
      const ids = [place(0), place(100), place(200)]
      s().select(ids)
      return { ids, steps: s().past.length }
    }

    it("selects with replace, add and toggle clicks", () => {
      assert.deepStrictEqual(nextSelection(["a", "b"], "c", "replace"), ["c"])
      assert.deepStrictEqual(nextSelection(["a", "b"], null, "replace"), [])
      assert.deepStrictEqual(nextSelection(["a", "b"], "c", "add"), ["a", "b", "c"])
      assert.deepStrictEqual(nextSelection(["a", "b"], "a", "add"), ["b", "a"]) // re-adding makes it active
      assert.deepStrictEqual(nextSelection(["a", "b"], "a", "toggle"), ["b"])
      assert.deepStrictEqual(nextSelection(["a", "b"], "c", "toggle"), ["a", "b", "c"])
      // a modifier click on empty space keeps the selection
      assert.deepStrictEqual(nextSelection(["a", "b"], null, "add"), ["a", "b"])
      assert.deepStrictEqual(nextSelection(["a", "b"], null, "toggle"), ["a", "b"])
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
      s().loadMap(initialMap(), null)
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

  it("tracks the open dialog and settings category", () => {
    const s = () => useEditor.getState()
    assert.isNull(s().dialog)
    s().openDialog("settings", "keybinds")
    assert.strictEqual(s().dialog, "settings")
    assert.strictEqual(s().settingsCategory, "keybinds")
    s().openDialog("export")
    assert.strictEqual(s().settingsCategory, "keybinds") // unchanged when no category is given
    s().closeDialog()
    assert.isNull(s().dialog)
  })

  it("sets an item property on the whole selection as one undo step", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
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
})
