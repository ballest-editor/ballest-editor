import { MapBackupFile, MapBackups, ProjectMaps } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import * as Fs from "node:fs"
import { vi } from "vitest"
import { sha256 } from "../project/files"
import * as channels from "./channels"
import { samplesDir, withHandlers } from "./handlersHarness"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

describe("MapFiles over IPC", () => {
  it.effect("New map makes the project on disk, and New map, Save, Rename and list keep to its maps folder", () =>
    withHandlers(({ fake, project }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const text = "{\r\n\t\"items\": [ \"é\" ]\r\n}"

        // The project in use isn't on disk yet: the first New map makes it, named after its folder.
        assert.isFalse(yield* fs.exists(project))
        const created = yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text })
        assert.deepInclude(created, {
          fileName: name,
          path: path.join(project, "maps", name),
          hash: sha256(new TextEncoder().encode(text)),
          publishedFileId: -1,
          link: null
        })
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), text)
        assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(path.join(project, "ballest-project.json"))), {
          formatVersion: 1,
          name: "My maps",
          exportTarget: "game"
        })
        // A second New map of the same name is refused.
        const clash = yield* Effect.flip(fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text: "{}" }))
        assert.match(String(clash.cause), /already has a map called/)

        yield* fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName: name, text: `${text}\r\n` })
        assert.deepInclude(yield* fake.invoke(channels.READ_MAP_CHANNEL, { fileName: name }), {
          text: `${text}\r\n`
        })

        const renamed = "Map_LevelEditorMain&Loop_me.balledit"
        yield* fake.invoke(channels.RENAME_MAP_CHANNEL, { from: name, to: renamed, text: "{\"renamed\":1}" })
        assert.deepStrictEqual(
          (yield* fake.invokeAs(ProjectMaps, channels.LIST_MAPS_CHANNEL)).map((m) => m.fileName),
          [
            renamed
          ]
        )
        // The Save kept the file it wrote over, the Rename the file it moved away from: newest first.
        const backups = yield* fake.invokeAs(MapBackups, channels.LIST_BACKUPS_CHANNEL)
        assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["project", name], ["project", name]])
        const texts = yield* Effect.forEach(
          backups,
          ({ place, id }) =>
            fake.invokeAs(MapBackupFile, channels.READ_BACKUP_CHANNEL, { place, id }).pipe(
              Effect.map((b) => b.text)
            )
        )
        assert.deepStrictEqual(texts, [`${text}\r\n`, text])
        assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 2)

        // Names only: nothing reaches outside maps/.
        for (const bad of ["../x.balledit", "a/b.balledit", "x.json", ".balledit", "con:.balledit"]) {
          const error = yield* Effect.flip(fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName: bad, text }))
          assert.match(String(error.cause), /isn't a map file name/, bad)
        }
        assert.isFalse(yield* fs.exists(path.join(project, "x.balledit")))

        // The hash follows the bytes, and the published id is read from them.
        const published = "{\"worldSettings\":{\"levelData\":{\"levelPublishedFileId\":3456}}}"
        assert.deepInclude(yield* fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName: renamed, text: published }), {
          hash: sha256(new TextEncoder().encode(published)),
          publishedFileId: 3456
        })
      })
    ))

  it.effect(
    "every sample goes into the backups and comes back byte for byte",
    () =>
      withHandlers(({ fake }) =>
        Effect.gen(function*() {
          const samples = Fs.readdirSync(samplesDir, { recursive: true, encoding: "utf8" })
            .filter((file) => /\.(balledit|ballmap)$/.test(file))
          assert.isAbove(samples.length, 0)
          for (const [i, sample] of samples.entries()) {
            const text = Fs.readFileSync(`${samplesDir}/${sample}`, "utf8")
            const fileName = `Map_LevelEditorMain&Sample ${i}_me.balledit`
            yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName, text })
            yield* fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName, text: "{}" })
            const backups = yield* fake.invokeAs(MapBackups, channels.LIST_BACKUPS_CHANNEL)
            const backup = backups.find((b) => b.fileName === fileName)
            assert.isDefined(backup, sample)
            const read = yield* fake.invokeAs(MapBackupFile, channels.READ_BACKUP_CHANNEL, backup)
            assert.isTrue(read.text === text, `${sample} differs after the backup`)
          }
        })
      ),
    // every sample is written, hashed and read back: tens of MB, slow on a CI runner
    60_000
  )
})
