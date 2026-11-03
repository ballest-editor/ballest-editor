import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { setLevelData, setLevelNames } from "../../domain/edits"
import type { MapFile } from "../../domain/MapFile"
import { type Difficulty, difficultyOf, withDifficulty } from "../../domain/mapTags"
import { MapCodec } from "../../services/MapCodec"
import { makeTestDisk, projectFile, TEST_PROJECT } from "../../test/desktopBridge"
import { balledits, edit, fileNameOf, layerFor, noticesWhile, reset, s } from "../../test/editorActions"
import { readSample } from "../../test/samples"
import { followOpenMapEffect, freshMapEffect, openProjectMapFile, openStartingMap, patchProjectMapEffect } from "./maps"
import { openProjectMap } from "./project"
import { refreshProject } from "./shared"

describe("map actions", () => {
  /** A project with the first two sample maps in it. */
  const twoMaps = () => {
    const first = fileNameOf(balledits[0]!)
    const second = fileNameOf(balledits[1]!)
    const disk = makeTestDisk({
      [projectFile(first)]: readSample(balledits[0]!),
      [projectFile(second)]: readSample(balledits[1]!)
    })
    return { first, second, disk }
  }

  it.effect("opening a map gives it a tab of its own, or makes its tab active; an untouched fresh map gives way", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      const fresh = s().tabId
      // the fresh map the app starts on is replaced, not kept beside it
      yield* openProjectMapFile(first)
      assert.deepStrictEqual(s().tabIds, [fresh])
      assert.strictEqual(s().file?.name, first)

      edit()
      yield* openProjectMapFile(second)
      assert.strictEqual(s().tabIds.length, 2)
      assert.strictEqual(s().file?.name, second)
      // the first keeps its edits and history, and nothing was asked
      const parked = s().parkedTabs.get(fresh)
      assert.isTrue(parked?.dirty)
      assert.strictEqual(parked.past.length, 1)
      assert.deepStrictEqual(disk.prompts, [])

      // opening it again goes back to its tab, as it was left
      yield* Effect.promise(() => openProjectMap(first))
      assert.strictEqual(s().tabId, fresh)
      assert.strictEqual(s().tabIds.length, 2)
      assert.isTrue(s().dirty)
      s().undo()
      assert.isFalse(s().past.length > 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("opening a map tells nothing: no notification", () => {
    const { first, disk } = twoMaps()
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        yield* reset
        yield* openProjectMapFile(first)
        assert.deepStrictEqual(notices, [])
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("starts on the map last open, else the most recently edited one, else a fresh map, and keeps the open one", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* refreshProject
      // nothing kept: the first of the list (the most recently changed)
      yield* openStartingMap
      assert.strictEqual(s().file?.name, s().projectMaps[0]?.fileName)

      // the kept map wins
      disk.project.lastOpenMap = { [TEST_PROJECT]: second }
      yield* refreshProject
      yield* openStartingMap
      assert.strictEqual(s().file?.name, second)

      // a kept map that is gone from the project is passed over
      disk.project.lastOpenMap = { [TEST_PROJECT]: "Map_LevelEditorMain&Gone_me.balledit" }
      yield* refreshProject
      yield* openStartingMap
      assert.strictEqual(s().file?.name, s().projectMaps[0]?.fileName)

      // an empty project starts on a fresh unsaved map, named Untitled with the creator in use
      disk.files.clear()
      disk.project.lastOpenMap = {}
      yield* refreshProject
      yield* openStartingMap
      assert.include(s(), { file: null, dirty: false })
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, "Untitled")

      // what is open is kept for the next launch, from the startup load on
      disk.files.set(projectFile(first), readSample(balledits[0]!))
      disk.files.set(projectFile(second), readSample(balledits[1]!))
      disk.project.lastOpenMap = { [TEST_PROJECT]: first }
      yield* refreshProject
      yield* openStartingMap
      const stop = yield* followOpenMapEffect
      assert.strictEqual(s().file?.name, first)
      yield* openProjectMapFile(second)
      yield* Effect.yieldNow
      assert.deepStrictEqual(disk.project.lastOpenMap, { [TEST_PROJECT]: second })
      yield* freshMapEffect
      yield* Effect.yieldNow
      assert.deepStrictEqual(disk.project.lastOpenMap, {})
      stop()
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Project settings edits a map on disk through the save path, or in its tab when one has it open", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      const before = disk.files.get(projectFile(second))
      // another map: patched on disk, the editor untouched
      const harder = (difficulty: Difficulty) => (map: MapFile) =>
        setLevelData(map, withDifficulty(map.worldSettings.levelData, difficulty))
      const saved = yield* patchProjectMapEffect(second, harder("expert"))
      assert.strictEqual(saved?.fileName, second)
      assert.notStrictEqual(disk.files.get(projectFile(second)), before)
      const patched = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(second))!))
      assert.strictEqual(difficultyOf(patched.worldSettings.levelData), "expert")
      assert.strictEqual(s().file?.name, first)
      assert.isFalse(s().dirty)

      // a rename moves the file, and the old one goes to the backups
      const renamed = yield* patchProjectMapEffect(second, (map) => setLevelNames(map, "Moved", "me"))
      assert.strictEqual(renamed?.fileName, "Map_LevelEditorMain&Moved_me.balledit")
      assert.isFalse(disk.files.has(projectFile(second)))
      assert.strictEqual(disk.backups[0]?.fileName, second)

      // the map in the active tab: an undo step there, nothing written until it is saved
      const was = disk.files.get(projectFile(first))
      yield* patchProjectMapEffect(first, harder("baller"))
      assert.strictEqual(difficultyOf(s().doc.map.worldSettings.levelData), "baller")
      assert.isTrue(s().dirty)
      assert.strictEqual(disk.files.get(projectFile(first)), was)
      s().undo()
      assert.notStrictEqual(difficultyOf(s().doc.map.worldSettings.levelData), "baller")

      // a map open in another tab, edited meanwhile: the step lands in that tab's history
      edit()
      const firstTab = s().tabId
      yield* openProjectMapFile(renamed!.fileName)
      yield* patchProjectMapEffect(first, harder("medium"))
      const other = s().parkedTabs.get(firstTab)!
      assert.strictEqual(difficultyOf(other.doc.map.worldSettings.levelData), "medium")
      assert.strictEqual(other.past.length, 2)
      assert.strictEqual(disk.files.get(projectFile(first)), was)
      assert.strictEqual(s().file?.name, renamed!.fileName)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
