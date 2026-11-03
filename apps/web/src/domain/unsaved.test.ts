import { assert, describe, it } from "@effect/vitest"
import { discardQuestionOf, unsavedPromptOf } from "./unsaved"

describe("unsavedPromptOf", () => {
  it("names the map and what is about to happen", () => {
    assert.deepStrictEqual(unsavedPromptOf("close", "Big Loop"), {
      message: "Save the changes to Big Loop before closing?",
      detail: "If you don't save, the changes are lost."
    })
    assert.strictEqual(
      unsavedPromptOf("closeTab", "Big Loop").message,
      "Save the changes to Big Loop before closing it?"
    )
  })

  it("says the map stays open when switching projects", () => {
    assert.include(unsavedPromptOf("switchProject", "Big Loop").detail, "stays open, unsaved, in the other project")
  })
})

describe("discardQuestionOf", () => {
  it("asks whether to go on without saving", () => {
    assert.strictEqual(
      discardQuestionOf("recover", "Big Loop"),
      "Big Loop has unsaved changes. Discard them and open a previous version?"
    )
  })
})
