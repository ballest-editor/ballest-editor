import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { setLevelData, setLevelNames } from "../../domain/edits"
import type { MapFile } from "../../domain/MapFile"
import { type Difficulty, difficultyOf, withDifficulty } from "../../domain/mapTags"
import { lightingOf } from "../../domain/sunlight"
import { MapCodec } from "../../services/MapCodec"
import { makeTestDisk, projectFile, TEST_PROJECT } from "../../test/desktopBridge"
import { balledits, edit, fileNameOf, layerFor, reset, s } from "../../test/editorActions"
import { readSample } from "../../test/samples"
import { followOpenMapEffect, freshMapEffect, openProjectMapFile, openStartingMap, patchProjectMapEffect } from "./maps"
import { openProjectMap } from "./project"
import { refreshProject } from "./shared"
import { unlessCancelled } from "./unsaved"

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

  it.effect("closing a map's tab asks about unsaved edits with the shared prompt, then shows a fresh map", () => {
    const name = fileNameOf(balledits[0]!)
    const disk = makeTestDisk({ [projectFile(name)]: readSample(balledits[0]!) })
    const editTo = (timeOfDay: number) => s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      // opening the map that is open does nothing
      yield* Effect.promise(() => openProjectMap(name))
      assert.strictEqual(s().file?.name, name)

      // leaving the map for a fresh one (what New map does) asks first
      const leave = unlessCancelled("newMap", freshMapEffect)
      editTo(9)
      disk.promptAnswers.push("cancel", "save")
      yield* leave
      assert.include(s(), { dirty: true })
      assert.strictEqual(s().file?.name, name)
      assert.match(disk.prompts[0]?.message ?? "", /before starting a new map\?$/)
      // Save: written first, then the tab shows a fresh unsaved map
      yield* leave
      assert.include(s(), { file: null, dirty: false })
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, "Untitled")
      const saved = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(name))!))
      assert.strictEqual(saved.worldSettings.directionalLight.timeOfDay, 9)

      // Don't save: the file keeps its last save
      yield* openProjectMapFile(name)
      editTo(2)
      const before = disk.files.get(projectFile(name))
      disk.promptAnswers.push("discard")
      yield* leave
      assert.include(s(), { file: null, dirty: false })
      assert.strictEqual(disk.files.get(projectFile(name)), before)

      // a clean map closes without asking
      yield* openProjectMapFile(name)
      const asked = disk.prompts.length
      yield* leave
      assert.isNull(s().file)
      assert.strictEqual(disk.prompts.length, asked)
    }).pipe(Effect.provide(layerFor(disk)))
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

  it.effect("Project settings edits a map that isn't open on disk, through the save path; the open map's unsaved edits refuse", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      const before = disk.files.get(projectFile(second))
      // another map: patched on disk, the editor untouched
      const harder = (difficulty: Difficulty) => (map: MapFile) =>
        setLevelData(map, withDifficulty(map.worldSettings.levelData, difficulty))
      const saved = yield* patchProjectMapEffect(second, harder("expert"))
      assert.strictEqual(saved.fileName, second)
      assert.notStrictEqual(disk.files.get(projectFile(second)), before)
      const patched = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(second))!))
      assert.strictEqual(difficultyOf(patched.worldSettings.levelData), "expert")
      assert.strictEqual(s().file?.name, first)
      assert.isFalse(s().dirty)

      // a rename moves the file, and the old one goes to the backups
      const renamed = yield* patchProjectMapEffect(second, (map) => setLevelNames(map, "Moved", "me"))
      assert.strictEqual(renamed.fileName, "Map_LevelEditorMain&Moved_me.balledit")
      assert.isFalse(disk.files.has(projectFile(second)))
      assert.strictEqual(disk.backups[0]?.fileName, second)

      // the open map, clean: written and reloaded
      yield* patchProjectMapEffect(first, harder("baller"))
      assert.strictEqual(difficultyOf(s().doc.map.worldSettings.levelData), "baller")
      assert.isFalse(s().dirty)

      // the open map, dirty: refused, nothing written
      edit()
      const was = disk.files.get(projectFile(first))
      const error = yield* Effect.flip(patchProjectMapEffect(first, harder("medium")))
      assert.match(error.message, /unsaved edits/)
      assert.strictEqual(disk.files.get(projectFile(first)), was)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
