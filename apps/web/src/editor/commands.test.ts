import { assert, describe, it } from "@effect/vitest"
import { heldActions, keybindActions, mouseClickActions, mouseDragActions } from "../domain/Keybinds"
import { commandFor, runsHere } from "./commands"
import { initialMap, useEditor } from "./store"

describe("commands", () => {
  it("has a command for every one-shot action, and none for held keys, drags or clicks", () => {
    for (const action of keybindActions) {
      const oneShot = !heldActions.has(action) && !mouseDragActions.has(action) && !mouseClickActions.has(action)
      assert.strictEqual(commandFor(action) !== undefined, oneShot, action)
    }
  })

  it("runs Play only where the game can be reached", () => {
    const s = () => useEditor.getState()
    const before = s().capabilities
    assert.isFalse(runsHere("playMap"))
    assert.isTrue(runsHere("saveMap"))
    s().setCapabilities({ ...before, play: true })
    assert.isTrue(runsHere("playMap"))
    s().setCapabilities(before)
  })

  it("runs the same store entry points as the keybinds", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    commandFor("rotateMode")?.()
    assert.strictEqual(s().tool, "rotate")
    commandFor("toggleGizmoSpace")?.()
    assert.strictEqual(s().gizmoSpace, "local")
    commandFor("saveMapAs")?.()
    assert.strictEqual(s().dialog, "saveAs")
    s().closeDialog()
    // a map that was never saved has no file to write over: Save asks like Save as
    commandFor("saveMap")?.()
    assert.strictEqual(s().dialog, "saveAs")
    s().closeDialog()
    s().select([s().doc.ids[0]!])
    commandFor("deselect")?.()
    assert.deepStrictEqual(s().selectedIds, [])
  })
})
