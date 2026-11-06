import { assert, describe, it } from "@effect/vitest"
import type { LinkedMap } from "../domain/linkState"
import { tabStatusOf } from "./DocumentTabs"

const hash = "a".repeat(64)
const unexported: LinkedMap = { hash, publishedFileId: -1, link: null }
const exported: LinkedMap = {
  hash,
  publishedFileId: -1,
  link: { export: { path: "/game/map.balledit", hash, at: "2026-11-05T12:00:00Z" }, lastSeenHash: hash }
}

describe("a document tab's status", () => {
  it("says Unsaved before anything else", () => {
    assert.strictEqual(tabStatusOf(true, exported), "Unsaved")
    assert.strictEqual(tabStatusOf(true, undefined), "Unsaved")
  })

  it("gives a project map's link state", () => {
    assert.strictEqual(tabStatusOf(false, unexported), "Not exported")
    assert.strictEqual(tabStatusOf(false, exported), "In sync")
  })

  it("says Saved of what has no link state, such as a definition", () => {
    assert.strictEqual(tabStatusOf(false, undefined), "Saved")
  })
})
