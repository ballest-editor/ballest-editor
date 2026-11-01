import type { MapLink } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { seeExport } from "./sync"

const exported = { path: "/game/UserSavedMaps/a.balledit", hash: "a".repeat(64), at: "2026-10-31T12:00:00.000Z" }
const origin = { ...exported, path: "/home/me/Downloads/a.balledit" }
const link: MapLink = { origin, export: exported, lastSeenHash: exported.hash }
const inGame = "b".repeat(64)

describe("seeExport", () => {
  it("leaves an unchanged export alone, and a map that was never exported", () => {
    assert.deepStrictEqual(seeExport(link, exported.hash), { link, report: null })
    const unexported: MapLink = { origin, export: null, lastSeenHash: null }
    assert.deepStrictEqual(seeExport(unexported, null), { link: unexported, report: null })
  })

  it("reports a change in the game once, keeping the hash it saw", () => {
    const first = seeExport(link, inGame)
    assert.deepStrictEqual(first, { link: { ...link, lastSeenHash: inGame }, report: "changed" })
    // the same version of the file, looked at again (the next focus)
    assert.deepStrictEqual(seeExport(first.link, inGame), { link: first.link, report: null })
    // the game saved it again: a new change
    assert.deepStrictEqual(seeExport(first.link, "c".repeat(64)).report, "changed")
    // back to the bytes exported: in sync again, nothing to report
    assert.deepStrictEqual(seeExport(first.link, exported.hash), { link, report: null })
  })

  it("drops the export of a map whose file is gone, once, and keeps where it came from", () => {
    const missing = seeExport(link, null)
    assert.deepStrictEqual(missing, { link: { origin, export: null, lastSeenHash: null }, report: "missing" })
    assert.deepStrictEqual(seeExport(missing.link, null).report, null)
  })
})
