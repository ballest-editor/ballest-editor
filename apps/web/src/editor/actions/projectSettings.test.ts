import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import type { LevelData } from "../../domain/MapFile"
import { difficultyOf, withDifficulty } from "../../domain/mapTags"
import { EMPTY_BUFFER, entryOf, hasUnsaved, type MapDraft, withProjectName } from "../../domain/settingsBuffer"
import { MapCodec } from "../../services/MapCodec"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { makeTestDisk, projectFile } from "../../test/desktopBridge"
import { layerFor, noticesWhile, reset, s, twoMaps } from "../../test/editorActions"
import { openProjectMapFile } from "./maps"
import { saveProjectSettingsEffect } from "./projectSettings"
import { refreshProject } from "./shared"

const harder = ({ levelData }: { readonly levelData: LevelData }): MapDraft => {
  const { levelDifficulty, mapTags } = withDifficulty(levelData, "expert")
  return { workshop: { levelDifficulty, mapTags } }
}

const decoded = Effect.fnUntraced(function*(text: string | undefined) {
  return yield* MapCodec.use((codec) => codec.decode(text!))
})

const bufferOf = (entries: ReadonlyArray<readonly [string, MapDraft]>) => ({
  ...EMPTY_BUFFER,
  maps: new Map(entries.map(([fileName, draft]) => [entryOf(fileName), draft]))
})

describe("Project settings' Save", () => {
  it.effect("edits a map open in a tab as one undo step there, and writes nothing", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* refreshProject
      yield* openProjectMapFile(first)
      const was = disk.files.get(projectFile(first))
      const { levelData } = s().doc.map.worldSettings
      const draft = { ...harder({ levelData }), name: "Renamed", exportOnSave: true }
      const steps = s().past.length

      const saved = yield* saveProjectSettingsEffect(bufferOf([[first, draft]]), "me")
      assert.isFalse(hasUnsaved(saved.left))
      assert.strictEqual(saved.moved.size, 0)
      assert.strictEqual(difficultyOf(s().doc.map.worldSettings.levelData), "expert")
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, "Renamed")
      assert.isTrue(s().exportOnSave)
      assert.isTrue(s().dirty)
      assert.strictEqual(s().past.length, steps + 1)
      assert.strictEqual(disk.files.get(projectFile(first)), was)
      s().undo()
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, levelData.levelDisplayName)

      // a tab that isn't the active one
      const firstTab = s().tabId
      yield* openProjectMapFile(second)
      yield* saveProjectSettingsEffect(bufferOf([[first, { ...harder({ levelData }) }]]), "me")
      const other = s().parkedTabs.get(firstTab)!
      assert.strictEqual(difficultyOf(other.doc.map.worldSettings.levelData), "expert")
      assert.strictEqual(s().file?.name, second)
      assert.strictEqual(disk.files.get(projectFile(first)), was)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("writes a map no tab has open, and carries its prefs to a new name", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* refreshProject
      yield* openProjectMapFile(first)
      const map = yield* decoded(disk.files.get(projectFile(second)))
      const { levelData } = map.worldSettings

      // prefs only: the file stays as it was
      const was = disk.files.get(projectFile(second))
      yield* saveProjectSettingsEffect(bufferOf([[second, { exportOnSave: true }]]), "me")
      assert.strictEqual(disk.files.get(projectFile(second)), was)
      const prefs = yield* MapPrefsStore.use((store) => store.load(levelData.userLevelName))
      assert.isTrue(prefs.exportOnSave)

      const saved = yield* saveProjectSettingsEffect(
        bufferOf([[second, { ...harder({ levelData }), name: "Moved" }]]),
        "me"
      )
      const moved = saved.moved.get(entryOf(second))!
      assert.isDefined(moved)
      assert.isFalse(disk.files.has(projectFile(second)))
      const patched = yield* decoded(disk.files.get(projectFile(moved)))
      assert.strictEqual(difficultyOf(patched.worldSettings.levelData), "expert")
      assert.strictEqual(disk.backups[0]?.fileName, second)
      const carried = yield* MapPrefsStore.use((store) => store.load(patched.worldSettings.levelData.userLevelName))
      assert.isTrue(carried.exportOnSave)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("keeps what failed in the buffer and tells why, and saves the rest", () => {
    const { first, second, disk } = twoMaps()
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        yield* reset
        yield* refreshProject
        yield* openProjectMapFile(first)
        const gone = entryOf("Gone_me.balledit")
        const buffer = {
          ...EMPTY_BUFFER,
          maps: new Map([[gone, { exportOnSave: true }], [entryOf(second), { exportOnSave: true }]])
        }
        const saved = yield* saveProjectSettingsEffect(buffer, "me")
        assert.deepStrictEqual([...saved.left.maps.keys()], [gone])
        assert.lengthOf(notices, 1)
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("renames a named project, and names Untitled Project", () => {
    const disk = makeTestDisk()
    disk.project.current = null
    return Effect.gen(function*() {
      yield* reset
      assert.isNull(s().project?.current)
      const named = yield* saveProjectSettingsEffect(withProjectName(EMPTY_BUFFER, "My tracks", null), "me")
      assert.isFalse(hasUnsaved(named.left))
      assert.strictEqual(s().project?.current?.name, "My tracks")

      const renamed = yield* saveProjectSettingsEffect(withProjectName(EMPTY_BUFFER, "Tracks", "My tracks"), "me")
      assert.isFalse(hasUnsaved(renamed.left))
      assert.strictEqual(s().project?.current?.name, "Tracks")
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
