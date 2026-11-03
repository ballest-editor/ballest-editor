import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { lightingOf } from "../../domain/sunlight"
import { MapCodec } from "../../services/MapCodec"
import { makeTestDisk, projectFile, TEST_MAPS_FOLDER, testBridge } from "../../test/desktopBridge"
import { layerFor, reset, s } from "../../test/editorActions"
import { listSamples, readSample } from "../../test/samples"
import { describeBackupEffect, recoverBackupEffect } from "./backups"
import { exportToGameEffect } from "./exportPlay"
import { createNewMap } from "./maps"
import { duplicateMapEffect, saveMapFile } from "./save"
import { unlessCancelledFor } from "./unsaved"

describe("backup actions", () => {
  it.effect("Save keeps the file it writes over; Recover opens it as unsaved edits and Save writes it back", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      const name = "Map_LevelEditorMain&Big Loop_Isaac.balledit"
      const first = disk.files.get(projectFile(name))!
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 3 })
      yield* saveMapFile
      // Saving again with nothing changed keeps nothing more.
      yield* saveMapFile
      assert.deepStrictEqual(disk.backups.map((b) => [b.place, b.fileName, b.text]), [["project", name, first]])

      const [backup] = yield* Effect.promise(() => testBridge(disk).listBackups())
      const summary = yield* describeBackupEffect(backup!)
      const items = (yield* MapCodec.use((codec) => codec.decode(first))).items.length
      assert.deepStrictEqual(summary, { _tag: "Map", displayName: "Big Loop", creatorName: "Isaac", items })

      yield* recoverBackupEffect(backup!)
      assert.isTrue(s().dirty)
      assert.deepStrictEqual(s().file, { name, path: projectFile(name) })
      assert.notStrictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 3)
      yield* saveMapFile
      assert.isFalse(s().dirty)
      const saved = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(name))!))
      assert.notStrictEqual(saved.worldSettings.directionalLight.timeOfDay, 3)
      // The version that was there before the recovered one went back in is kept too.
      assert.strictEqual(disk.backups.length, 2)
      const kept = yield* MapCodec.use((codec) => codec.decode(disk.backups[0]!.text))
      assert.strictEqual(kept.worldSettings.directionalLight.timeOfDay, 3)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Recover asks about unsaved edits first; the prompt's Save keeps the file it writes over", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      const name = "Map_LevelEditorMain&Big Loop_Isaac.balledit"
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 3 })
      yield* saveMapFile
      const [first] = yield* Effect.promise(() => testBridge(disk).listBackups())
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 9 })
      const saved = disk.files.get(projectFile(name))

      // Cancel: nothing written, nothing recovered.
      yield* unlessCancelledFor(name, "recover", (open) => recoverBackupEffect(first!, open))
      assert.strictEqual(disk.prompts.length, 1)
      assert.strictEqual(disk.files.get(projectFile(name)), saved)
      assert.strictEqual(disk.backups.length, 1)
      assert.strictEqual(lightingOf(s().doc.map.worldSettings).timeOfDay, 9)

      // Save: the edits are written over the file, which goes to the backups, then the version opens.
      disk.promptAnswers.push("save")
      yield* unlessCancelledFor(name, "recover", (open) => recoverBackupEffect(first!, open))
      assert.deepStrictEqual(disk.backups.map((b) => [b.place, b.fileName, b.text]).slice(0, 1), [[
        "project",
        name,
        saved
      ]])
      const written = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(name))!))
      assert.strictEqual(written.worldSettings.directionalLight.timeOfDay, 9)
      assert.isTrue(s().dirty)
      assert.notStrictEqual(lightingOf(s().doc.map.worldSettings).timeOfDay, 9)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect.each(listSamples().map((sample) => [sample.name, sample] as const))(
    "recovers %s from a backup with all its items",
    ([, sample]) => {
      const fileName = "Map_LevelEditorMain&Gone_me.balledit"
      const text = readSample(sample)
      const disk = makeTestDisk()
      disk.backups.push({ place: "export", id: `0 ${fileName}`, fileName, at: "2026-10-31T12:00:00.000Z", text })
      return Effect.gen(function*() {
        yield* reset
        const decoded = yield* MapCodec.use((codec) => codec.decode(text))
        const summary = yield* describeBackupEffect(disk.backups[0]!)
        assert.deepInclude(summary, { _tag: "Map", items: decoded.items.length })
        yield* recoverBackupEffect(disk.backups[0]!)
        assert.strictEqual(s().doc.map.items.length, decoded.items.length)
        // No longer in the project: it opens as a new map, named on Save.
        assert.isNull(s().file)
        assert.isTrue(s().dirty)
      }).pipe(Effect.provide(layerFor(disk)))
    }
  )

  it.effect("a backup that doesn't decode is described as such", () => {
    const fileName = "Map_LevelEditorMain&Broken_me.balledit"
    const disk = makeTestDisk()
    disk.backups.push({ place: "project", id: `0 ${fileName}`, fileName, at: "2026-10-31T12:00:00.000Z", text: "{" })
    return Effect.gen(function*() {
      const summary = yield* describeBackupEffect(disk.backups[0]!)
      assert.strictEqual(summary._tag, "Unreadable")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Duplicate over a map of the same name replaces it, keeping it in the backups", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Hairpin", "Isaac")
      const other = "Map_LevelEditorMain&Hairpin_Isaac.balledit"
      const before = disk.files.get(projectFile(other))!
      yield* createNewMap("Big Loop", "Isaac")
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 7 })

      const refused = yield* Effect.flip(duplicateMapEffect("Hairpin", "Isaac"))
      assert.match(refused.message, /already has a map called/)
      yield* duplicateMapEffect("Hairpin", "Isaac", true)
      assert.deepStrictEqual(s().file, { name: other, path: projectFile(other) })
      const written = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(other))!))
      assert.strictEqual(written.worldSettings.directionalLight.timeOfDay, 7)
      assert.deepStrictEqual(disk.backups.map((b) => [b.fileName, b.text]), [[other, before]])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Export keeps the game's copy it writes over", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Shuttle", "Isaac")
      const name = "Map_LevelEditorMain&Shuttle_Isaac.balledit"
      disk.files.set(`${TEST_MAPS_FOLDER}/${name}`, "edited in the game")
      yield* exportToGameEffect
      assert.deepStrictEqual(disk.backups.map((b) => [b.place, b.text]), [["export", "edited in the game"]])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
