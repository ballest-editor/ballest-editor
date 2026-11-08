import { assert, describe, it } from "@effect/vitest"
import { clearStatusHint, showStatusHint, useStatusHint } from "./statusHint"

const typing = [{ keys: "Enter", text: "Set" }]
const dragging = [{ keys: "Shift", text: "10× faster" }]

describe("the status hint", () => {
  it("is cleared only by the control that shows it", () => {
    showStatusHint("a", dragging)
    showStatusHint("b", dragging)
    // leaving the first field after entering the next keeps the next one's hint
    clearStatusHint("a")
    assert.strictEqual(useStatusHint.getState().hint, dragging)
    clearStatusHint("b")
    assert.isNull(useStatusHint.getState().hint)
  })

  it("comes back to a field still being typed in when another field's hover ends", () => {
    showStatusHint("a", typing)
    showStatusHint("b", dragging)
    assert.strictEqual(useStatusHint.getState().hint, dragging)
    clearStatusHint("b")
    assert.strictEqual(useStatusHint.getState().hint, typing)
    clearStatusHint("a")
    assert.isNull(useStatusHint.getState().hint)
  })
})
