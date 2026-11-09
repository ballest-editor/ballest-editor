import { assert, describe, it } from "@effect/vitest"
import { duringDragActions, heldActions, keybindActions, mouseClickActions, mouseDragActions } from "../domain/Keybinds"
import { commandFor } from "./commands"
import { keyContextOf } from "./keyContext"
import { initialMap, useEditor } from "./store"

describe("commands", () => {
  it("has a command for every one-shot action, and none for held keys, drags or clicks", () => {
    for (const action of keybindActions) {
      const oneShot = !heldActions.has(action) && !duringDragActions.has(action) && !mouseDragActions.has(action) &&
        !mouseClickActions.has(action)
      assert.strictEqual(commandFor(action) !== undefined, oneShot, action)
    }
  })

  it("reads the platform off the capabilities, so Play has a key only where the game can be reached", () => {
    const s = () => useEditor.getState()
    const before = s().capabilities
    assert.strictEqual(keyContextOf().platform, "browser")
    s().setCapabilities({ ...before, play: true })
    assert.strictEqual(keyContextOf().platform, "desktop")
    s().setCapabilities(before)
    assert.deepStrictEqual(keyContextOf(), { drag: "none", tool: s().tool, platform: "browser" })
  })

  it("has nothing to Save or Frame with no tab open", () => {
    const s = () => useEditor.getState()
    const { frameAllRequest } = s()
    useEditor.setState({ tabIds: [] })
    commandFor("saveMap")?.()
    commandFor("saveMapAs")?.()
    commandFor("frameAll")?.()
    assert.isNull(s().dialog)
    assert.strictEqual(s().frameAllRequest, frameAllRequest)
    useEditor.setState({ tabIds: [s().tabId] })
  })

  it("runs the same store entry points as the keybinds", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    commandFor("rotateMode")?.()
    assert.strictEqual(s().tool, "rotate")
    commandFor("toggleGizmoSpace")?.()
    assert.strictEqual(s().gizmoSpace, "local")
    commandFor("toggleGizmoSpace")?.()
    assert.strictEqual(s().gizmoSpace, "world")
    commandFor("saveMapAs")?.()
    assert.strictEqual(s().dialog?.id, "saveAs")
    s().closeDialog()
    // a map that was never saved has no file to write over: Save asks like Save as
    commandFor("saveMap")?.()
    assert.strictEqual(s().dialog?.id, "saveAs")
    s().closeDialog()
    s().select([s().doc.ids[0]!])
    commandFor("deselect")?.()
    assert.deepStrictEqual(s().selectedIds, [])
  })

  it("selects the whole map, or only the entered group", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    const [first] = s().doc.ids
    assert.isAbove(s().doc.ids.length, 1)
    commandFor("selectAll")?.()
    assert.deepStrictEqual(s().selectedIds, s().doc.ids)
    s().select([first!])
    s().groupSelection()
    const groupId = s().doc.structure.tree.find((node) => node.kind === "group")?.id ?? null
    s().enterGroup(groupId)
    commandFor("selectAll")?.()
    assert.deepStrictEqual(s().selectedIds, [first!])
  })

  it("enters the selected group, and does nothing unless the selection is one group", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    const [first] = s().doc.ids
    s().select([first!])
    commandFor("enterGroup")?.()
    assert.isNull(s().enteredGroupId)
    s().groupSelection()
    const groupId = s().doc.structure.tree.find((node) => node.kind === "group")?.id ?? null
    s().select([first!])
    commandFor("enterGroup")?.()
    assert.strictEqual(s().enteredGroupId, groupId)
    assert.deepStrictEqual(s().selectedIds, [])
  })
})
