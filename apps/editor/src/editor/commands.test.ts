import { assert, describe, it } from "@effect/vitest"
import { heldActions, keybindActions, mouseClickActions, mouseDragActions } from "../domain/Keybinds"
import { commandFor } from "./commands"
import { initialMap, useEditor } from "./store"

describe("commands", () => {
  it("has a command for every one-shot action, and none for held keys, drags or clicks", () => {
    for (const action of keybindActions) {
      const oneShot = !heldActions.has(action) && !mouseDragActions.has(action) && !mouseClickActions.has(action)
      assert.strictEqual(commandFor(action) !== undefined, oneShot, action)
    }
  })

  it("runs the same store entry points as the keybinds", () => {
    const s = () => useEditor.getState()
    s().loadMap(initialMap(), null)
    commandFor("rotateMode")?.()
    assert.strictEqual(s().tool, "rotate")
    commandFor("toggleGizmoSpace")?.()
    assert.strictEqual(s().gizmoSpace, "local")
    commandFor("exportMap")?.()
    assert.strictEqual(s().dialog, "export")
    s().closeDialog()
    s().select([s().doc.ids[0]!])
    commandFor("deselect")?.()
    assert.deepStrictEqual(s().selectedIds, [])
  })
})
