import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { lightingOf } from "../domain/sunlight"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { makeTestDisk, Platform, TEST_MAPS_FOLDER, type TestDisk } from "../services/Platform"
import { listSamples, readSample } from "../test/samples"
import { launchGameEffect, openMapFile, openRecentFile, saveMap, saveMapFile, saveToGameFile } from "./actions"
import { useEditor } from "./store"

const s = () => useEditor.getState()

const layerFor = (disk: TestDisk) =>
  Layer.mergeAll(
    Platform.layerTest(disk),
    MapPrefsStore.layerTest,
    MapExporter.layerNoDeps.pipe(Layer.provideMerge(Layer.mergeAll(MapCodec.layer, DateTime.layerCurrentZoneOffset(0))))
  )

/** The time a save stamps into `createdAt` ("2026.10.06-17.49.47"), so a test can make it write the same one. */
const createdAtTime = (createdAt: string) => {
  const [y, mo, d, h, mi, sec] = createdAt.split(/[.-]/).map(Number)
  return Date.UTC(y!, mo! - 1, d, h, mi, sec)
}

const balledits = listSamples().filter((sample) => sample.kind === "balledit")
const DIR = "/home/me/UserSavedMaps"

describe("file actions", () => {
  it.effect.each(balledits.map((sample) => [sample.name, sample] as const))(
    "opens %s and saves it back over the same file, byte for byte",
    ([, sample]) => {
      const name = sample.name.split("/").pop()!
      const path = `${DIR}/${name}`
      const text = readSample(sample)
      const disk = makeTestDisk({ [path]: text })
      return Effect.gen(function*() {
        disk.answers.push(path)
        yield* openMapFile
        assert.deepStrictEqual(s().file, { name, path })
        assert.isFalse(s().dirty)

        yield* TestClock.setTime(createdAtTime(s().doc.map.worldSettings.levelData.createdAt))
        yield* saveMapFile("save")
        // No save dialog: Save wrote over the open file.
        assert.deepStrictEqual(disk.dialogs.map((d) => d.kind), ["open"])
        assert.isTrue(disk.files.get(path) === text, "the saved file differs from the game's")
        assert.deepStrictEqual(disk.recent, [path])
      }).pipe(Effect.provide(layerFor(disk)))
    }
  )

  it.effect("marks edits dirty until saved; Save as asks next to the open file and moves the document there", () => {
    const sample = balledits[0]!
    const path = `${DIR}/${sample.name.split("/").pop()!}`
    const disk = makeTestDisk({ [path]: readSample(sample) })
    return Effect.gen(function*() {
      disk.answers.push(path)
      yield* openMapFile
      const before = lightingOf(s().doc.map.worldSettings)
      s().setLighting({ ...before, timeOfDay: (before.timeOfDay + 1) % 24 })
      assert.isTrue(s().dirty)

      yield* saveMapFile("save")
      assert.isFalse(s().dirty)
      const saved = yield* MapCodec.use((codec) => codec.decode(disk.files.get(path)!))
      assert.strictEqual(saved.worldSettings.directionalLight.timeOfDay, (before.timeOfDay + 1) % 24)

      // Cancelling Save as changes nothing.
      disk.answers.push(null)
      yield* saveMapFile("saveAs")
      assert.strictEqual(s().file?.path, path)

      const copy = "/home/me/backup/copy.balledit"
      disk.answers.push(copy)
      yield* saveMapFile("saveAs")
      assert.deepStrictEqual(disk.dialogs.slice(1).map((d) => [d.kind, d.near]), [["save", path], ["save", path]])
      assert.strictEqual(disk.dialogs[1]?.name, sample.name.split("/").pop())
      assert.deepStrictEqual(s().file, { name: "copy.balledit", path: copy })
      assert.strictEqual(disk.files.get(copy), disk.files.get(path))
      assert.deepStrictEqual(s().recentFiles.map((f) => f.path), [copy, path])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save asks for a name instead of writing over a file the map no longer matches", () => {
    const sample = balledits[0]!
    const path = `${DIR}/${sample.name.split("/").pop()!}`
    const text = readSample(sample)
    const disk = makeTestDisk({ [path]: text })
    return Effect.gen(function*() {
      disk.answers.push(path)
      yield* openMapFile
      s().closeDialog()
      const { creatorName } = s().doc.map.worldSettings.levelData
      s().renameLevel("Renamed", creatorName)
      yield* Effect.promise(saveMap)
      assert.strictEqual(s().dialog, "saveAs")
      assert.strictEqual(disk.files.get(path), text)
      s().closeDialog()

      // The Save as dialog's own save suggests the new name, in the same folder.
      disk.answers.push(`${DIR}/Map_LevelEditorMain&Renamed_${creatorName}.balledit`)
      yield* saveMapFile("saveAs")
      assert.deepStrictEqual(disk.dialogs.at(-1), {
        kind: "save",
        name: `Map_LevelEditorMain&Renamed_${creatorName}.balledit`,
        near: path
      })
      assert.strictEqual(disk.files.get(path), text)
      assert.strictEqual(s().file?.name, `Map_LevelEditorMain&Renamed_${creatorName}.balledit`)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a cancelled open keeps the document; a recent file that has gone fails and drops off the list", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const doc = s().doc
      disk.answers.push(null)
      yield* openMapFile
      assert.strictEqual(s().doc, doc)

      disk.recent.push("/gone.balledit")
      s().setRecentFiles([{ name: "gone.balledit", path: "/gone.balledit" }])
      disk.recent.splice(0)
      const error = yield* Effect.flip(openRecentFile("/gone.balledit"))
      assert.strictEqual(error._tag, "PlatformError")
      assert.strictEqual(error.message, "/gone.balledit doesn't exist any more.")
      assert.deepStrictEqual(s().recentFiles, [])
      assert.strictEqual(s().doc, doc)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save to game writes a copy into the maps folder; a map never saved moves there", () => {
    const sample = balledits[0]!
    const name = sample.name.split("/").pop()!
    const path = `${DIR}/${name}`
    const disk = makeTestDisk({ [path]: readSample(sample) })
    return Effect.gen(function*() {
      disk.answers.push(path)
      yield* openMapFile
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 3 })
      yield* saveToGameFile(false)
      const inGame = `${TEST_MAPS_FOLDER}/${name}`
      const copy = yield* MapCodec.use((codec) => codec.decode(disk.files.get(inGame)!))
      assert.strictEqual(copy.worldSettings.directionalLight.timeOfDay, 3)
      // Still the file Save writes to, and still unsaved there.
      assert.deepStrictEqual(s().file, { name, path })
      assert.isTrue(s().dirty)
      assert.deepStrictEqual(s().recentFiles.map((f) => f.path), [inGame, path])

      s().loadMap(copy, null)
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 4 })
      yield* saveToGameFile(false)
      assert.deepStrictEqual(s().file, { name, path: inGame })
      assert.isFalse(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save to game asks before replacing a published map's draft", () => {
    const sample = balledits[0]!
    const name = sample.name.split("/").pop()!
    const inGame = `${TEST_MAPS_FOLDER}/${name}`
    const published = JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: 3561234567 } } })
    const disk = makeTestDisk({ [`${DIR}/${name}`]: readSample(sample), [inGame]: published })
    return Effect.gen(function*() {
      disk.answers.push(`${DIR}/${name}`)
      yield* openMapFile
      yield* saveToGameFile(false)
      assert.deepStrictEqual(s().publishedDraft, { name, publishedFileId: 3561234567 })
      assert.strictEqual(s().dialog, "replacePublished")
      assert.strictEqual(disk.files.get(inGame), published)

      s().setPublishedDraft(null)
      assert.strictEqual(s().dialog, null)
      yield* saveToGameFile(true)
      const replaced = yield* MapCodec.use((codec) => codec.decode(disk.files.get(inGame)!))
      assert.strictEqual(replaced.items.length, s().doc.map.items.length)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Launch starts the game through Steam unless it is running", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      disk.game.running = true
      yield* launchGameEffect
      assert.strictEqual(disk.game.launches, 0)
      disk.game.running = false
      yield* launchGameEffect
      assert.strictEqual(disk.game.launches, 1)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
