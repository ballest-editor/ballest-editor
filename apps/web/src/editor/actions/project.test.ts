import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { defaultEditorState } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import {
  makeTestDisk,
  projectFile,
  TEST_MAPS_FOLDER,
  TEST_PROJECT,
  type TestDisk,
  testHash
} from "../../test/desktopBridge"
import { balledits, fileNameOf, layerFor, reset, s } from "../../test/editorActions"
import { listSamples, readSample } from "../../test/samples"
import { exportToGameEffect } from "./exportPlay"
import { overwriteChangedEffect } from "./gameWrite"
import { importAsCopyEffect, importMapFile, replaceOnImportEffect } from "./project"
import { saveMapFile } from "./save"

/** The time a save stamps into `createdAt` ("2026.10.06-17.49.47"), so a test can make it write the same one. */
const createdAtTime = (createdAt: string) => {
  const [y, mo, d, h, mi, sec] = createdAt.split(/[.-]/).map(Number)
  return Date.UTC(y!, mo! - 1, d, h, mi, sec)
}

const ballmaps = listSamples().filter((sample) => sample.kind === "ballmap")

/** Imports `path` through the dialog. */
const importFrom = (disk: TestDisk, path: string) =>
  Effect.gen(function*() {
    disk.answers.push(path)
    yield* importMapFile
  })

describe("import actions", () => {
  it.effect.each(balledits.map((sample) => [sample.name, sample] as const))(
    "imports %s from the game linked to it, saves it and exports it back, byte for byte",
    ([, sample]) => {
      const name = fileNameOf(sample)
      const inGame = `${TEST_MAPS_FOLDER}/${name}`
      const text = readSample(sample)
      const disk = makeTestDisk({ [inGame]: text })
      return Effect.gen(function*() {
        yield* reset
        yield* importFrom(disk, inGame)
        assert.deepStrictEqual(s().file, { name, path: projectFile(name) })
        assert.isTrue(disk.files.get(projectFile(name)) === text, "the imported copy differs from the game's")
        assert.deepInclude(disk.links.get(TEST_PROJECT)?.get(name), {
          origin: { path: inGame, hash: testHash(text), at: "2026-10-31T12:00:00.000Z" },
          export: { path: inGame, hash: testHash(text), at: "2026-10-31T12:00:00.000Z" }
        })
        assert.deepStrictEqual(s().projectMaps.map((m) => m.fileName), [name])

        yield* TestClock.setTime(createdAtTime(s().doc.map.worldSettings.levelData.createdAt))
        yield* saveMapFile
        assert.deepStrictEqual(disk.dialogs.map((d) => d.kind), ["import"])
        // 0.4.1's saves have no editorState (docs/qa/save-roundtrip.md); the editor writes the empty one 0.4.0 did, and
        // changes nothing else
        const saved = text.includes("\"editorState\"") ?
          text :
          yield* MapCodec.use((codec) =>
            Effect.flatMap(codec.decode(text), (map) => codec.encode({ ...map, editorState: defaultEditorState() }))
          )
        assert.isTrue(disk.files.get(projectFile(name)) === saved, "the saved file differs from the game's")

        // the game changed it since: Export asks, and Back up and overwrite writes the project file over it
        disk.files.set(inGame, "changed in the game")
        yield* exportToGameEffect
        assert.strictEqual(s().dialog?.id, "overwriteChanged")
        assert.strictEqual(disk.files.get(inGame), "changed in the game")
        yield* overwriteChangedEffect
        assert.isTrue(disk.files.get(inGame) === saved, "the export differs from the project file")
        assert.strictEqual(disk.links.get(TEST_PROJECT)?.get(name)?.export?.hash, testHash(saved))
      }).pipe(Effect.provide(layerFor(disk)))
    }
  )

  it.effect("a name clash on import asks; Import as copy renames the map, Replace keeps the name", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const download = `/home/me/Downloads/${name}`
    const disk = makeTestDisk({ [download]: readSample(sample), [projectFile(name)]: "{}" })
    return Effect.gen(function*() {
      yield* reset
      yield* importFrom(disk, download)
      const clash = s().dialog
      assert.strictEqual(clash?.id === "importClash" && clash.fileName, name)
      assert.strictEqual(disk.files.get(projectFile(name)), "{}")

      yield* importAsCopyEffect
      const { levelDisplayName, creatorName } = s().doc.map.worldSettings.levelData
      const copy = `Map_LevelEditorMain&${levelDisplayName}_${creatorName}.balledit`
      assert.notStrictEqual(copy, name)
      assert.match(levelDisplayName, / 2$/)
      assert.deepStrictEqual(s().file, { name: copy, path: projectFile(copy) })
      // Imported from elsewhere: an origin, no export.
      assert.deepInclude(disk.links.get(TEST_PROJECT)?.get(copy), { export: null, lastSeenHash: null })
      assert.strictEqual(disk.links.get(TEST_PROJECT)?.get(copy)?.origin?.path, download)

      yield* importFrom(disk, download)
      assert.strictEqual(s().dialog?.id, "importClash")
      yield* replaceOnImportEffect
      assert.isTrue(disk.files.get(projectFile(name)) === readSample(sample))
      assert.strictEqual(s().file?.name, name)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect.each(ballmaps.slice(0, 3).map((sample) => [sample.name, sample] as const))(
    "imports the Workshop map %s as the .balledit the game would make of it",
    ([, sample]) => {
      const source = `/workshop/${fileNameOf(sample)}`
      const disk = makeTestDisk({ [source]: readSample(sample) })
      return Effect.gen(function*() {
        yield* reset
        yield* importFrom(disk, source)
        const name = s().file?.name ?? ""
        assert.match(name, /^Map_LevelEditorMain&.*\.balledit$/)
        const written = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(name))!))
        assert.isDefined(written.editorState)
        assert.strictEqual(written.items.length, s().doc.map.items.length)
      }).pipe(Effect.provide(layerFor(disk)))
    }
  )
})
