import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog } from "../domain/Catalog"
import { placementTransform } from "../domain/factory"
import { defaultSettings } from "../domain/Settings"
import { initialMap, useEditor } from "./store"

const cube = Schema.decodeUnknownSync(Catalog)(fixture).pieces.find((p) => p.className === "BP_Prim_Cube")!

describe("editor store", () => {
  it("places, moves, deletes, and undoes/redoes", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    assert.strictEqual(s().doc.map.items.length, 1)

    s().placePiece(cube, placementTransform(cube, { x: 10, y: 20, z: 30 }))
    const id = s().selectedId!
    assert.strictEqual(s().doc.map.items.length, 2)

    s().moveItem(id, { x: 1, y: 2, z: 3 })
    assert.deepStrictEqual(s().doc.map.items[1]!.itemTransform.translation, { x: 1, y: 2, z: 3 })
    s().moveItem(id, { x: Number.NaN, y: 0, z: 0 }) // rejected by the schema, no history entry
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

  it("reports whether a transform was accepted", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    s().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 0 }))
    const id = s().selectedId!
    const t = s().doc.map.items[1]!.itemTransform
    assert.isTrue(s().transformItem(id, { ...t, rotation: { x: 0, y: 0, z: 2, w: 0 } }))
    assert.deepStrictEqual(s().doc.map.items[1]!.itemTransform.rotation, { x: 0, y: 0, z: 1, w: 0 })
    const before = s().past.length
    assert.isFalse(s().transformItem(id, { ...t, rotation: { x: 0, y: 0, z: 0, w: 0 } }))
    assert.strictEqual(s().past.length, before)
  })

  describe("history", () => {
    const s = () => useEditor.getState()
    const place = (x: number) => {
      s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
      return s().selectedId!
    }
    const translationOf = (id: string) => s().doc.map.items[s().doc.ids.indexOf(id)]!.itemTransform.translation

    it("puts every kind of edit on the stack, and loading a map clears it", () => {
      s().loadMap(initialMap(), null)
      const id = place(0)
      s().moveItem(id, { x: 5, y: 0, z: 0 })
      const t = s().doc.map.items[1]!.itemTransform
      s().transformItem(id, { ...t, scale3D: { x: 2, y: 2, z: 2 } })
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
      s().moveItem(id, { x: 10, y: 0, z: 0 })
      assert.isTrue(s().transformItem(id, s().doc.map.items[1]!.itemTransform)) // a drag that ended where it began
      const { levelDisplayName, creatorName } = s().doc.map.worldSettings.levelData
      s().renameLevel(levelDisplayName, creatorName)
      assert.strictEqual(s().past.length, before)
    })

    it("clears the redo stack on a new edit", () => {
      s().loadMap(initialMap(), null)
      const id = place(0)
      s().moveItem(id, { x: 1, y: 0, z: 0 })
      s().undo()
      assert.strictEqual(s().future.length, 1)
      s().moveItem(id, { x: 2, y: 0, z: 0 })
      assert.strictEqual(s().future.length, 0)
      s().redo() // nothing to redo
      assert.deepStrictEqual(translationOf(id), { x: 2, y: 0, z: 0 })
    })

    it("restores the selection that went with each step", () => {
      s().loadMap(initialMap(), null)
      const a = place(0)
      const b = place(100)
      s().select(a)
      s().deleteSelection()
      assert.isNull(s().selectedId)
      s().select(b)
      s().undo() // the deleted item comes back selected
      assert.strictEqual(s().selectedId, a)
      s().redo() // and is gone again with nothing selected
      assert.isNull(s().selectedId)
      assert.isFalse(s().doc.ids.includes(a))
      s().undo()
      s().undo() // undoing b's placement goes back to a, selected before it
      assert.isFalse(s().doc.ids.includes(b))
      assert.strictEqual(s().selectedId, a)
      s().select(null)
      s().redo() // redoing it selects b, as placing did
      assert.strictEqual(s().selectedId, b)
    })

    it("waits while a gizmo drag or scrub is previewing", () => {
      s().loadMap(initialMap(), null)
      const id = place(0)
      const t = s().doc.map.items[1]!.itemTransform
      s().setPreview({ id, transform: { ...t, translation: { x: 50, y: 0, z: 0 } } })
      s().undo()
      assert.strictEqual(s().doc.map.items.length, 2)
      // the interaction commits once on release
      s().setPreview(null)
      s().moveItem(id, { x: 50, y: 0, z: 0 })
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
      s().select(a)
      s().select(null)
      s().select(b)
      assert.strictEqual(s().past.length, before)
    })

    it("records each selection change as its own step when enabled", () => {
      withUndoSelection(true)
      try {
        s().loadMap(initialMap(), null)
        const a = place(0)
        const b = place(100)
        s().select(null)
        const before = s().past.length
        const doc = s().doc
        s().select(a)
        s().select(a) // unchanged: no step
        s().select(b)
        s().select(null)
        assert.strictEqual(s().past.length, before + 3)
        s().undo()
        assert.strictEqual(s().selectedId, b)
        s().undo()
        assert.strictEqual(s().selectedId, a)
        s().undo()
        assert.isNull(s().selectedId)
        assert.strictEqual(s().doc, doc) // selection steps never touch the doc
        s().redo()
        s().redo()
        assert.strictEqual(s().selectedId, b)
        s().select(a) // a new selection clears the redo stack
        assert.strictEqual(s().future.length, 0)
      } finally {
        withUndoSelection(false)
      }
    })

    it("doesn't mark the map dirty or leave a deleted selection behind", () => {
      withUndoSelection(true)
      try {
        s().loadMap(initialMap(), null)
        s().select(s().doc.ids[0]!)
        s().select(null)
        s().undo()
        s().undo()
        s().redo()
        assert.isFalse(s().dirty)

        // edits around selection steps keep their own before/after selection
        const a = place(0) // selected as part of the placement step
        s().select(null)
        s().select(a)
        s().deleteSelection()
        s().undo() // a is back, selected
        assert.strictEqual(s().selectedId, a)
        s().undo() // re-selecting a
        s().undo() // deselecting
        assert.strictEqual(s().selectedId, a)
        s().undo() // the placement: back to what was selected before it
        assert.isFalse(s().doc.ids.includes(a))
        assert.strictEqual(s().selectedId, s().doc.ids[0])

        // a selection step naming an item that is gone resolves to no selection
        const b = place(0)
        const step = { doc: s().doc, selectedId: "item-gone", otherSelectedId: b, selectionOnly: true }
        useEditor.setState({ past: [...s().past, step] })
        s().undo()
        assert.isNull(s().selectedId)
      } finally {
        withUndoSelection(false)
      }
    })

    it("counts selection steps against the 200-step limit", () => {
      withUndoSelection(true)
      try {
        s().loadMap(initialMap(), null)
        const a = place(0)
        for (let i = 0; i < 250; i++) s().select(i % 2 === 0 ? null : a)
        assert.strictEqual(s().past.length, 200)
      } finally {
        withUndoSelection(false)
      }
    })

    it("keeps at most 200 steps", () => {
      s().loadMap(initialMap(), null)
      const id = place(0)
      for (let i = 1; i <= 250; i++) s().moveItem(id, { x: i, y: 0, z: 0 })
      assert.strictEqual(s().past.length, 200)
      for (let i = 0; i < 300; i++) s().undo()
      assert.deepStrictEqual(translationOf(id), { x: 50, y: 0, z: 0 })
      for (let i = 0; i < 300; i++) s().redo()
      assert.deepStrictEqual(translationOf(id), { x: 250, y: 0, z: 0 })
      assert.strictEqual(s().past.length, 200)
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
})
