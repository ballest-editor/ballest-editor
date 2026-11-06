import { assert, describe, it } from "@effect/vitest"
import {
  CHIP_STATUS_LABELS,
  CHIP_STATUS_TONES,
  chipStatusOf,
  LINK_STATE_LABELS,
  type LinkedMap,
  type LinkState,
  linkStateDetailOf,
  linkStateOf,
  nextSavedChip,
  restingChip,
  SAVED_CHIP_MS,
  savedChipMsLeft,
  SYNC_STATUS_LABELS,
  SYNC_STATUS_TONES,
  syncDetailOf,
  type SyncStatus,
  syncStatusOf
} from "./linkState"

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

describe("syncStatusOf", () => {
  const states: ReadonlyArray<LinkState> = [
    "notExported",
    "inSync",
    "editedSinceExport",
    "changedInGame",
    "bothChanged",
    "publishedDraft"
  ]

  it("says Unsaved for a map with unsaved edits, whatever its link state", () => {
    for (const state of states) assert.strictEqual(syncStatusOf(state, true), "unsaved")
  })

  it("folds the three changed states into one and keeps the others", () => {
    assert.deepStrictEqual(states.map((state) => syncStatusOf(state, false)), [
      "notExported",
      "inSync",
      "changedSinceExport",
      "changedSinceExport",
      "changedSinceExport",
      "publishedDraft"
    ])
  })

  it("tells a dirty map from a clean one that was never exported", () => {
    const neverExported = map("a".repeat(64), -1, null)
    const label = (unsaved: boolean) =>
      SYNC_STATUS_LABELS[syncStatusOf(linkStateOf(neverExported, { unsaved }), unsaved)]
    assert.strictEqual(label(true), "Unsaved")
    assert.strictEqual(label(false), "Not exported")
  })

  it("has a label and a colour for every status", () => {
    const statuses: ReadonlyArray<SyncStatus> = [
      "unsaved",
      "notExported",
      "inSync",
      "changedSinceExport",
      "publishedDraft"
    ]
    assert.deepStrictEqual(statuses.map((status) => [SYNC_STATUS_LABELS[status], SYNC_STATUS_TONES[status]]), [
      ["Unsaved", "warn"],
      ["Not exported", "neutral"],
      ["In sync", "ok"],
      ["Changed since export", "warn"],
      ["Published draft", "neutral"]
    ])
  })
})

describe("the chip's Saved state", () => {
  const fileName = "a.balledit"
  const before = "2026-10-31T11:00:00.000Z"
  const savedAt = "2026-10-31T12:00:00.000Z"
  const saved = Date.parse(savedAt)
  const view = (status: SyncStatus, modifiedAt: string | null = before, name: string | null = fileName) => ({
    fileName: name,
    modifiedAt,
    status
  })
  /** The chip on a clean map it has been looking at for a while, saved long ago. */
  const resting = restingChip(view("notExported"))
  /** The same with unsaved edits. */
  const edited = nextSavedChip(resting, view("unsaved"), saved - 5_000)

  it("lasts two seconds from when the chip sees the save, however old the file time is by then", () => {
    assert.strictEqual(SAVED_CHIP_MS, 2_000)
    const seen = saved + 1_500
    const chip = nextSavedChip(edited, view("notExported", savedAt), seen)
    assert.strictEqual(chip.shown, "saved")
    assert.strictEqual(savedChipMsLeft(chip, seen), SAVED_CHIP_MS)
    assert.strictEqual(nextSavedChip(chip, view("notExported", savedAt), seen + SAVED_CHIP_MS - 1).shown, "saved")
    const after = nextSavedChip(chip, view("notExported", savedAt), seen + SAVED_CHIP_MS)
    assert.strictEqual(after.shown, "notExported")
    assert.strictEqual(savedChipMsLeft(after, seen + SAVED_CHIP_MS), 0)
  })

  it("goes from Unsaved to Saved with nothing between, while the project's list catches up", () => {
    // the tab is clean, and the list still has the file time from before the save
    const clean = nextSavedChip(edited, view("notExported"), saved + 10)
    assert.strictEqual(clean.shown, "unsaved")
    assert.strictEqual(nextSavedChip(clean, view("notExported"), saved + 340).shown, "unsaved")
    assert.strictEqual(nextSavedChip(clean, view("notExported", savedAt), saved + 340).shown, "saved")
  })

  it("gives up the wait when the new file time never comes", () => {
    const clean = nextSavedChip(edited, view("inSync"), saved)
    assert.strictEqual(savedChipMsLeft(clean, saved), SAVED_CHIP_MS)
    assert.strictEqual(nextSavedChip(clean, view("inSync"), saved + SAVED_CHIP_MS).shown, "inSync")
  })

  it("starts over on a save during Saved, and shows an edit between the two at once", () => {
    const first = nextSavedChip(edited, view("notExported", savedAt), saved)
    assert.strictEqual(nextSavedChip(first, view("unsaved", savedAt), saved + 500).shown, "unsaved")
    const again = "2026-10-31T12:00:01.000Z"
    const second = nextSavedChip(first, view("notExported", again), saved + 1_000)
    assert.strictEqual(second.shown, "saved")
    assert.strictEqual(savedChipMsLeft(second, saved + 1_000), SAVED_CHIP_MS)
  })

  it("claims no save for a map whose file time it has seen, or one written long ago", () => {
    assert.strictEqual(resting.shown, "notExported")
    assert.strictEqual(nextSavedChip(resting, view("notExported"), saved).shown, "notExported")
    assert.strictEqual(nextSavedChip(resting, view("inSync", before, "b.balledit"), saved).shown, "inSync")
  })

  it("holds nothing over from another map, when a tab with edits gives way to a clean one", () => {
    const switched = nextSavedChip(edited, view("notExported", before, "b.balledit"), saved)
    assert.strictEqual(switched.shown, "notExported")
    assert.strictEqual(savedChipMsLeft(switched, saved), 0)
  })

  it("says Saved of a map's first save, when it appears in the project", () => {
    const nameless = nextSavedChip(resting, view("unsaved", null, null), saved)
    assert.strictEqual(nextSavedChip(nameless, view("notExported", savedAt), saved + 100).shown, "saved")
  })

  it("doesn't begin for a file time ahead of the clock", () => {
    assert.strictEqual(nextSavedChip(resting, view("notExported", savedAt), saved - 1).shown, "notExported")
  })

  it("stands in for any status but Unsaved, and goes back to the status after", () => {
    const statuses: ReadonlyArray<SyncStatus> = ["notExported", "inSync", "changedSinceExport", "publishedDraft"]
    for (const status of statuses) {
      assert.strictEqual(chipStatusOf(status, true), "saved")
      assert.strictEqual(chipStatusOf(status, false), status)
    }
    assert.strictEqual(chipStatusOf("unsaved", true), "unsaved")
  })

  it("is labelled, and wears ok", () => {
    assert.strictEqual(CHIP_STATUS_LABELS.saved, "Saved")
    assert.strictEqual(CHIP_STATUS_TONES.saved, "ok")
  })
})

describe("syncDetailOf", () => {
  it("says which side changed under Changed since export", () => {
    assert.strictEqual(syncDetailOf("editedSinceExport", "changedSinceExport"), "Edited since export")
    assert.strictEqual(syncDetailOf("changedInGame", "changedSinceExport"), "Changed in game")
    assert.strictEqual(syncDetailOf("bothChanged", "changedSinceExport"), "Both changed")
  })

  it("keeps the link state that Unsaved hides", () => {
    assert.strictEqual(syncDetailOf("bothChanged", "unsaved"), "Both changed")
    assert.strictEqual(syncDetailOf("notExported", "unsaved"), "Not exported")
  })

  it("has nothing to add when the status already says it", () => {
    assert.isNull(syncDetailOf("notExported", "notExported"))
    assert.isNull(syncDetailOf("inSync", "inSync"))
    assert.isNull(syncDetailOf("publishedDraft", "publishedDraft"))
  })
})

describe("linkStateDetailOf", () => {
  const now = Date.parse(exported.at) + 5 * 60_000

  it("says when the map was last exported", () => {
    const detail = linkStateDetailOf(map("b".repeat(64)), "editedSinceExport", now)
    assert.isTrue(detail.startsWith("Edited since export · exported 5 min ago ("))
  })

  it("has no time to give for a map with no export", () => {
    assert.strictEqual(linkStateDetailOf(map("a".repeat(64), -1, null), "notExported", now), "Not exported yet")
  })
})
