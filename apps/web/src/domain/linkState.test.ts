import { assert, describe, it } from "@effect/vitest"
import { LINK_STATE_LABELS, type LinkedMap, linkStateOf } from "./linkState"

const exported = { path: "/game/UserSavedMaps/a.balledit", hash: "a".repeat(64), at: "2026-10-31T12:00:00.000Z" }
const map = (
  hash: string,
  publishedFileId = -1,
  link: LinkedMap["link"] = { export: exported, lastSeenHash: exported.hash }
): LinkedMap => ({ hash, publishedFileId, link })
/** A map whose export the game changed: the check saw another hash than the one exported. */
const changed = (hash: string, publishedFileId = -1) =>
  map(hash, publishedFileId, { export: exported, lastSeenHash: "c".repeat(64) })

describe("linkStateOf", () => {
  it("tells a map that was never exported from one that matches its export, or was edited since", () => {
    assert.strictEqual(linkStateOf(map("a".repeat(64), -1, null)), "notExported")
    assert.strictEqual(linkStateOf(map("a".repeat(64))), "inSync")
    assert.strictEqual(linkStateOf(map("b".repeat(64))), "editedSinceExport")
    // unsaved edits count, although the file is still the export
    assert.strictEqual(linkStateOf(map("a".repeat(64)), { unsaved: true }), "editedSinceExport")
    // not looked at in the game yet (or a link from before sync): only the project side counts
    assert.strictEqual(linkStateOf(map("a".repeat(64), -1, { export: exported, lastSeenHash: null })), "inSync")
  })

  it("shows a missing export, whose link the check dropped, as not exported", () => {
    assert.strictEqual(linkStateOf(map("a".repeat(64), -1, { export: null, lastSeenHash: null })), "notExported")
  })

  it("reports a change in the game, and both changed when the project map has edits too", () => {
    assert.strictEqual(linkStateOf(changed("a".repeat(64))), "changedInGame")
    // saved since the export, or with unsaved edits
    assert.strictEqual(linkStateOf(changed("b".repeat(64))), "bothChanged")
    assert.strictEqual(linkStateOf(changed("a".repeat(64)), { unsaved: true }), "bothChanged")
  })

  it("puts a change in the game over the published flag, and the published flag over edits", () => {
    assert.strictEqual(linkStateOf(map("b".repeat(64), 3456)), "publishedDraft")
    assert.strictEqual(linkStateOf(changed("a".repeat(64), 3456)), "changedInGame")
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
