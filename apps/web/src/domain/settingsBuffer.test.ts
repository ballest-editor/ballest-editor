import { assert, describe, it } from "@effect/vitest"
import { newMapFile } from "./factory"
import type { LevelData } from "./MapFile"
import { difficultyOf, hasTag, tagNameOf, withDifficulty, withTag } from "./mapTags"
import {
  changesLevelData,
  EMPTY_BUFFER,
  entryOf,
  hasUnsaved,
  OPEN_UNSAVED,
  targetOf,
  unsavedPagesOf,
  unsavedTabEntry,
  withMapDraft,
  withMapEdit,
  withoutMap,
  withoutProjectName,
  withProjectName
} from "./settingsBuffer"

const levelData = withDifficulty(
  newMapFile({ displayName: "Loop", creatorName: "me", createdAt: "2026-11-06" }).worldSettings.levelData,
  "beginner"
)
const saved = { levelData, exportOnSave: false }
const entry = entryOf("Loop_me.balledit")

const workshopOf = ({ levelDifficulty, mapTags }: LevelData) => ({ levelDifficulty, mapTags })
const speed = tagNameOf("Gameplay", "speed")
const flow = tagNameOf("Gameplay", "flow")

describe("the settings buffer", () => {
  it("holds an edit until it is put back by hand", () => {
    const harder = withMapEdit(EMPTY_BUFFER, entry, saved, {
      workshop: workshopOf(withDifficulty(levelData, "expert"))
    })
    assert.isTrue(hasUnsaved(harder))
    assert.isFalse(hasUnsaved(withMapEdit(harder, entry, saved, { workshop: workshopOf(levelData) })))

    const named = withMapEdit(EMPTY_BUFFER, entry, saved, { name: "Big Loop" })
    assert.deepStrictEqual(named.maps.get(entry), { name: "Big Loop" })
    assert.isFalse(hasUnsaved(withMapEdit(named, entry, saved, { name: "Loop" })))

    const on = withMapEdit(EMPTY_BUFFER, entry, saved, { exportOnSave: true })
    assert.isFalse(hasUnsaved(withMapEdit(on, entry, saved, { exportOnSave: false })))
  })

  it("keeps a map's edits together, and drops only the one put back", () => {
    const both = withMapEdit(
      withMapEdit(EMPTY_BUFFER, entry, saved, { name: "Big Loop" }),
      entry,
      saved,
      { exportOnSave: true }
    )
    assert.deepStrictEqual(both.maps.get(entry), { name: "Big Loop", exportOnSave: true })
    assert.deepStrictEqual(withMapEdit(both, entry, saved, { name: "Loop" }).maps.get(entry), { exportOnSave: true })
  })

  it("counts a tag turned off and on again as no edit, though it moved", () => {
    const tagged = withTag(withTag(levelData, speed, true), flow, true)
    const off = withTag(tagged, speed, false)
    const back = withTag(off, speed, true)
    assert.notDeepEqual(back.mapTags, tagged.mapTags)
    const values = { levelData: tagged, exportOnSave: false }
    assert.isTrue(hasUnsaved(withMapEdit(EMPTY_BUFFER, entry, values, { workshop: workshopOf(off) })))
    assert.isFalse(hasUnsaved(withMapEdit(EMPTY_BUFFER, entry, values, { workshop: workshopOf(back) })))
  })

  it("ignores levelDifficulty, which a published map keeps at Beginner whatever its tag says", () => {
    const published = { ...withDifficulty(levelData, "expert"), levelDifficulty: "Beginner" as const }
    const values = { levelData: published, exportOnSave: false }
    const back = withDifficulty(withDifficulty(published, "medium"), "expert")
    assert.isFalse(hasUnsaved(withMapEdit(EMPTY_BUFFER, entry, values, { workshop: workshopOf(back) })))
  })

  it("buffers the project's name, and Untitled Project's blank one is no edit", () => {
    const renamed = withProjectName(EMPTY_BUFFER, "Tracks", "My tracks")
    assert.strictEqual(renamed.projectName, "Tracks")
    assert.isFalse(hasUnsaved(withProjectName(renamed, "My tracks", "My tracks")))
    assert.isFalse(hasUnsaved(withProjectName(EMPTY_BUFFER, "", null)))
    assert.isTrue(hasUnsaved(withProjectName(EMPTY_BUFFER, "Tracks", null)))
  })

  it("lets Save take out what it wrote, and keep what failed", () => {
    const other = entryOf("Other_me.balledit")
    const buffer = withMapEdit(
      withMapEdit(withProjectName(EMPTY_BUFFER, "Tracks", "My tracks"), entry, saved, { name: "Big Loop" }),
      other,
      saved,
      { exportOnSave: true }
    )
    const left = withoutMap(withoutProjectName(buffer), entry)
    assert.deepStrictEqual([...left.maps.keys()], [other])
    assert.isUndefined(left.projectName)
    assert.isFalse(hasUnsaved(withoutMap(left, other)))
  })

  it("applies a draft over the level as it is then, leaving its other fields alone", () => {
    const edited = withDifficulty(withTag(levelData, speed, true), "expert")
    const draft = { name: "Big Loop", workshop: workshopOf(edited) }
    const later = { ...levelData, levelDescription: "Changed since" }
    const next = withMapDraft(later, draft, "someone")
    assert.strictEqual(next.levelDisplayName, "Big Loop")
    assert.strictEqual(next.userLevelName, "Big Loop_me")
    assert.strictEqual(difficultyOf(next), "expert")
    assert.isTrue(hasTag(next, speed))
    assert.strictEqual(next.levelDescription, "Changed since")
    assert.deepStrictEqual(withMapDraft(later, undefined, "someone"), later)
  })

  it("gives a map with no creator the saved one when it is renamed", () => {
    const next = withMapDraft({ ...levelData, creatorName: "" }, { name: "Big Loop" }, "someone")
    assert.strictEqual(next.userLevelName, "Big Loop_someone")
  })

  it("says which pages a draft touches, and whether it changes the file", () => {
    const workshop = workshopOf(levelData)
    assert.deepStrictEqual(unsavedPagesOf({ workshop }), { map: false, workshop: true })
    assert.deepStrictEqual(unsavedPagesOf({ name: "Big Loop" }), { map: true, workshop: false })
    assert.deepStrictEqual(unsavedPagesOf({ exportOnSave: true }), { map: true, workshop: false })
    assert.isTrue(changesLevelData({ workshop }))
    assert.isFalse(changesLevelData({ exportOnSave: true }))
  })

  it("tells what an entry edits", () => {
    assert.deepStrictEqual(targetOf(OPEN_UNSAVED), { _tag: "OpenMap" })
    assert.deepStrictEqual(targetOf(unsavedTabEntry("t1")), { _tag: "Tab", tabId: "t1" })
    assert.deepStrictEqual(targetOf(entryOf("Loop_me.balledit")), { _tag: "File", fileName: "Loop_me.balledit" })
  })
})
