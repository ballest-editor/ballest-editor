import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { lightingOf } from "../../domain/sunlight"
import { MapCodec } from "../../services/MapCodec"
import { makeTestDisk, projectFile, TEST_MAPS_FOLDER, TEST_PROJECTS_FOLDER } from "../../test/desktopBridge"
import { createNewMap, layerFor, reset, s } from "../../test/editorActions"
import { nameProjectEffect, openProjectMapFile } from "./maps"
import { importMapFile } from "./project"
import { duplicateMapEffect, saveMapAsEffect, saveMapFile } from "./save"

describe("save actions", () => {
  it.effect("A map's first Save puts it in the project; Save, Rename and Duplicate ask nothing more", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      const first = "Map_LevelEditorMain&Big Loop_Isaac.balledit"
      assert.deepStrictEqual(s().file, { name: first, path: projectFile(first) })
      assert.isFalse(s().dirty)
      const created = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(first))!))
      assert.strictEqual(created.worldSettings.levelData.levelDisplayName, "Big Loop")

      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 3 })
      assert.isTrue(s().dirty)
      yield* saveMapFile
      assert.isFalse(s().dirty)
      const saved = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(first))!))
      assert.strictEqual(saved.worldSettings.directionalLight.timeOfDay, 3)

      // Rename: the file moves to the new name; the old one is gone from the project.
      s().renameLevel("Hairpin", "Isaac")
      yield* saveMapAsEffect()
      const renamed = "Map_LevelEditorMain&Hairpin_Isaac.balledit"
      assert.deepStrictEqual(s().file, { name: renamed, path: projectFile(renamed) })
      assert.isFalse(disk.files.has(projectFile(first)))
      assert.isTrue(disk.files.has(projectFile(renamed)))

      // Duplicate: a second file, and editing goes on in it.
      yield* duplicateMapEffect("Hairpin 2", "Isaac")
      const copy = "Map_LevelEditorMain&Hairpin 2_Isaac.balledit"
      assert.deepStrictEqual(s().file, { name: copy, path: projectFile(copy) })
      assert.deepStrictEqual(s().projectMaps.map((m) => m.fileName).sort(), [copy, renamed].sort())
      assert.deepStrictEqual(disk.dialogs, [])

      // A name the project has is refused, and nothing is overwritten.
      const before = disk.files.get(projectFile(renamed))
      const error = yield* Effect.flip(createNewMap("Hairpin", "Isaac"))
      assert.match(String(error), /already has a map called/)
      assert.strictEqual(disk.files.get(projectFile(renamed)), before)

      yield* openProjectMapFile(renamed)
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, "Hairpin")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save keeps the date a map was created; a Duplicate is created now", () => {
    const disk = makeTestDisk()
    const createdAt = () => s().doc.map.worldSettings.levelData.createdAt
    return Effect.gen(function*() {
      yield* TestClock.setTime(Date.UTC(2026, 10, 5, 12, 0, 0))
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      assert.strictEqual(createdAt(), "2026.11.05-12.00.00")

      yield* TestClock.setTime(Date.UTC(2026, 10, 6, 9, 30, 0))
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 3 })
      yield* saveMapFile
      assert.strictEqual(createdAt(), "2026.11.05-12.00.00")

      yield* duplicateMapEffect("Big Loop 2", "Isaac")
      assert.strictEqual(createdAt(), "2026.11.06-09.30.00")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Untitled Project: nothing on disk until the first Save names the project", () => {
    const disk = makeTestDisk()
    disk.project.current = null
    return Effect.gen(function*() {
      yield* reset
      assert.isNull(s().project?.current)
      // a new map stays in memory, and there is nothing to import into
      yield* createNewMap("Big Loop", "Isaac")
      assert.isNull(s().file)
      assert.strictEqual(disk.files.size, 0)
      const refused = yield* Effect.flip(importMapFile)
      assert.match(refused.message, /no project to import into/)
      assert.deepStrictEqual(disk.dialogs, [])

      // The Save dialog's project name makes the folder, then the map is written into it
      yield* nameProjectEffect({ name: "My tracks" })
      const project = `${TEST_PROJECTS_FOLDER}/My tracks`
      assert.deepInclude(s().project?.current, { path: project, name: "My tracks" })
      assert.isNull(s().file)
      yield* saveMapAsEffect()
      const name = "Map_LevelEditorMain&Big Loop_Isaac.balledit"
      assert.deepStrictEqual(s().file, { name, path: projectFile(name, project) })
      assert.isTrue(disk.files.has(projectFile(name, project)))
      assert.deepStrictEqual(s().projectMaps.map((m) => m.fileName), [name])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save names a map that has no file yet first, then writes it into the project", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* saveMapFile
      assert.strictEqual(s().dialog?.id, "saveAs")
      assert.strictEqual(disk.files.size, 0)
      s().closeDialog()

      s().renameLevel("Fresh", "Isaac")
      yield* saveMapAsEffect()
      const name = "Map_LevelEditorMain&Fresh_Isaac.balledit"
      assert.deepStrictEqual(s().file, { name, path: projectFile(name) })
      assert.isTrue(disk.files.has(projectFile(name)))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Export on save exports every save of that map", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Shuttle", "Isaac")
      const name = "Map_LevelEditorMain&Shuttle_Isaac.balledit"
      yield* saveMapFile
      assert.isFalse(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))

      s().patchTab(s().tabId, { exportOnSave: true })
      yield* saveMapFile
      assert.strictEqual(disk.files.get(`${TEST_MAPS_FOLDER}/${name}`), disk.files.get(projectFile(name)))
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
