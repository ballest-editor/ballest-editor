import { assert, describe, it } from "@effect/vitest"
import {
  CHIP_STATUS_LABELS,
  CHIP_STATUS_TONES,
  chipStatusOf,
  type ChipView,
  GAME_WRITE_STAGE_LABELS,
  type GameWrite,
  gameWritePercentOf,
  LINK_STATE_LABELS,
  type LinkedMap,
  type LinkState,
  linkStateDetailOf,
  linkStateOf,
  nextSavedChip,
  restingChip,
  SAVED_CHIP_MS,
  type SavedChip,
  SYNC_STATUS_LABELS,
  SYNC_STATUS_TONES,
  syncDetailOf,
  type SyncStatus,
  syncStatusOf,
  WIDEST_CHIP_LABEL
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

describe("the status chip", () => {
  const onDisk = { name: "what the file holds" }
  const resaved = { name: "what a save wrote" }
  const view = (status: SyncStatus, savedDoc: unknown = onDisk, opened = "tab-1/1") => ({ opened, savedDoc, status })
  /** What a chip says after looking at `views` in turn, from `chip`. */
  const says = (chip: SavedChip, ...views: ReadonlyArray<ChipView>) => chipStatusOf(views.reduce(nextSavedChip, chip))
  /** The chip on a clean map it has been looking at for a while. */
  const resting = restingChip(view("notExported"))
  /** The same with unsaved edits. */
  const edited = nextSavedChip(resting, view("unsaved"))

  it("shows the real state on launch, the moment a clean map opens over the blank tab", () => {
    const blank = restingChip(view("unsaved", { name: "the blank map" }, "tab-1/0"))
    assert.strictEqual(says(blank, view("inSync", onDisk, "tab-1/1")), "inSync")
    assert.strictEqual(chipStatusOf(restingChip(view("notExported"))), "notExported")
  })

  it("follows an undo back to the saved document at once, with nothing to wait for", () => {
    for (const status of ["notExported", "inSync", "changedSinceExport", "publishedDraft"] as const) {
      assert.strictEqual(says(edited, view(status)), status)
    }
  })

  it("shows an edit at once", () => {
    assert.strictEqual(says(resting, view("unsaved")), "unsaved")
  })

  it("goes straight from Unsaved to Saved on a save", () => {
    assert.strictEqual(SAVED_CHIP_MS, 2_000)
    assert.strictEqual(says(edited, view("notExported", resaved)), "saved")
  })

  it("goes on saying Saved when the project's list catches up with a new status, then says that", () => {
    const chip = nextSavedChip(nextSavedChip(edited, view("notExported", resaved)), view("changedSinceExport", resaved))
    assert.strictEqual(chipStatusOf(chip), "saved")
    assert.strictEqual(chipStatusOf({ ...chip, justSaved: false }), "changedSinceExport")
  })

  it("says Saved of a save with no edits", () => {
    assert.strictEqual(says(resting, view("notExported", resaved)), "saved")
  })

  it("says Saved of a map's first save, before the project's list has it", () => {
    assert.strictEqual(says(resting, view("unsaved", null), view("notExported", resaved)), "saved")
  })

  it("ends Saved on an edit, and an undo of that edit doesn't bring it back", () => {
    const saved = view("notExported", resaved)
    assert.strictEqual(says(edited, saved, view("unsaved", resaved)), "unsaved")
    assert.strictEqual(says(edited, saved, view("unsaved", resaved), saved), "notExported")
  })

  it("stays Unsaved when edits landed while the save ran, and an undo of them isn't a save", () => {
    assert.strictEqual(says(edited, view("unsaved", resaved)), "unsaved")
    assert.strictEqual(says(edited, view("unsaved", resaved), view("notExported", resaved)), "notExported")
  })

  it("claims no save for another tab, or a map loaded over this one", () => {
    assert.strictEqual(says(edited, view("notExported", resaved, "tab-2/1")), "notExported")
    assert.strictEqual(says(resting, view("inSync", resaved, "tab-1/2")), "inSync")
  })

  it("carries Saved over to no other map", () => {
    assert.strictEqual(says(edited, view("notExported", resaved), view("inSync", onDisk, "tab-2/1")), "inSync")
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

describe("the chip's width", () => {
  it("comes from a label no other label outruns, the stages' included", () => {
    for (const label of [...Object.values(CHIP_STATUS_LABELS), ...Object.values(GAME_WRITE_STAGE_LABELS)]) {
      assert.isAtMost(label.length, WIDEST_CHIP_LABEL.length)
    }
    assert.strictEqual(WIDEST_CHIP_LABEL, "Changed since export")
  })
})

describe("gameWritePercentOf", () => {
  const at = (intent: GameWrite["intent"], stage: GameWrite["stage"]) =>
    gameWritePercentOf({ intent, fileName: null, stage })

  it("splits Play evenly over its four stages", () => {
    assert.deepStrictEqual(
      (["save", "copy", "verify", "launch"] as const).map((stage) => at("play", stage)),
      [25, 50, 75, 100]
    )
  })

  it("fills Export by the time it verifies: there is nothing to launch", () => {
    assert.closeTo(at("export", "save"), 33.3, 0.1)
    assert.closeTo(at("export", "copy"), 66.7, 0.1)
    assert.strictEqual(at("export", "verify"), 100)
  })
})
