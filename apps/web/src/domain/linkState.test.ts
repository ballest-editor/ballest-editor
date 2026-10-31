import { assert, describe, it } from "@effect/vitest"
import { LINK_STATE_LABELS, type LinkedMap, linkStateOf } from "./linkState"

const exported = { path: "/game/UserSavedMaps/a.balledit", hash: "a".repeat(64), at: "2026-10-31T12:00:00.000Z" }
const map = (hash: string, publishedFileId = -1, link: LinkedMap["link"] = { export: exported }): LinkedMap => ({
  hash,
  publishedFileId,
  link
})

describe("linkStateOf", () => {
  it("tells a map that was never exported from one that matches its export, or was edited since", () => {
    assert.strictEqual(linkStateOf(map("a".repeat(64), -1, null)), "notExported")
    assert.strictEqual(linkStateOf(map("a".repeat(64), -1, { export: null })), "notExported")
    assert.strictEqual(linkStateOf(map("a".repeat(64))), "inSync")
    assert.strictEqual(linkStateOf(map("b".repeat(64))), "editedSinceExport")
    // unsaved edits count, although the file is still the export
    assert.strictEqual(linkStateOf(map("a".repeat(64)), { unsaved: true }), "editedSinceExport")
  })

  it("reports a change in the game over the project side, and a published draft over edits", () => {
    const changed = { gameHash: "c".repeat(64) }
    assert.strictEqual(linkStateOf(map("a".repeat(64)), changed), "changedInGame")
    assert.strictEqual(linkStateOf(map("b".repeat(64)), changed), "bothChanged")
    assert.strictEqual(linkStateOf(map("a".repeat(64)), { gameHash: "a".repeat(64) }), "inSync")
    assert.strictEqual(linkStateOf(map("b".repeat(64), 3456)), "publishedDraft")
    assert.strictEqual(linkStateOf(map("a".repeat(64), 3456), changed), "changedInGame")
    assert.strictEqual(linkStateOf(map("a".repeat(64), 3456, null)), "notExported")
  })

  it("has a label for every state", () => {
    assert.deepStrictEqual(Object.values(LINK_STATE_LABELS), [
      "Not exported",
      "In sync",
      "Edited since export",
      "Changed in game",
      "Both changed",
      "Published draft"
    ])
  })
})
