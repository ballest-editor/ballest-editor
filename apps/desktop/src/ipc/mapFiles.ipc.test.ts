import { InvokeChannels, MapBackupFile, MapBackups, ProjectMaps } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import * as Fs from "node:fs"
import { vi } from "vitest"
import { sha256 } from "../project/files"
import { type fakeIpcMain, samplesDir, withHandlers } from "./handlersHarness"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

const sidecarOf = (hash: string) => JSON.stringify({ mapHash: hash })

describe("sidecars over IPC", () => {
  const map = "Map_LevelEditorMain&Track_me.balledit"
  const sidecar = "Map_LevelEditorMain&Track_me.editor.json"

  /** Runs `body` over a project holding `map` and its sidecar `sidecarOf("one")`. */
  const withSidecar = <A, E>(
    body: (
      env: {
        readonly fake: ReturnType<typeof fakeIpcMain>
        readonly files: FileSystem.FileSystem
        readonly maps: string
        readonly project: string
      }
    ) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
  ) =>
    withHandlers(({ fake, project }) =>
      Effect.gen(function*() {
        const files = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        yield* fake.invoke(InvokeChannels.createMap, { fileName: map, text: "{\"v\":1}" })
        yield* fake.invoke(InvokeChannels.writeSidecar, { fileName: map, text: sidecarOf("one") })
        return yield* body({ fake, files, maps: path.join(project, "maps"), project })
      })
    )

  it.effect("keeps the sidecar beside the map, reads it with the map and leaves it out of the list", () =>
    withSidecar(({ fake, files, maps }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        assert.strictEqual(yield* files.readFileString(path.join(maps, sidecar)), sidecarOf("one"))
        assert.deepInclude(yield* fake.invoke(InvokeChannels.readMap, { fileName: map }), {
          text: "{\"v\":1}",
          sidecar: sidecarOf("one")
        })
        assert.deepStrictEqual(
          (yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)).map((m) => m.fileName),
          [map]
        )
        const refused = yield* Effect.flip(
          fake.invoke(InvokeChannels.writeSidecar, { fileName: "../outside.balledit", text: "{}" })
        )
        assert.match(String(refused.cause), /map file name/)
      })
    ))

  it.effect("reads no sidecar for a map that has none", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(InvokeChannels.createMap, { fileName: map, text: "{}" })
        assert.deepInclude(yield* fake.invoke(InvokeChannels.readMap, { fileName: map }), { sidecar: null })
      })
    ))

  it.effect("Rename moves the sidecar and backs up the old one; a Save keeps the sidecar it writes over", () =>
    withSidecar(({ fake, files, maps }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const renamed = "Map_LevelEditorMain&Loop_me.balledit"
        yield* fake.invoke(InvokeChannels.saveMap, { fileName: map, text: "{\"v\":2}" })
        yield* fake.invoke(InvokeChannels.writeSidecar, { fileName: map, text: sidecarOf("two") })
        yield* fake.invoke(InvokeChannels.renameMap, { from: map, to: renamed, text: "{\"v\":3}" })

        assert.isFalse(yield* files.exists(path.join(maps, sidecar)))
        assert.strictEqual(
          yield* files.readFileString(path.join(maps, "Map_LevelEditorMain&Loop_me.editor.json")),
          sidecarOf("two")
        )

        // Recover lists only maps, and each version comes with the sidecar kept when it was
        const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        assert.deepStrictEqual(backups.map((b) => b.fileName), [map, map])
        const reads = yield* Effect.forEach(
          backups,
          ({ id, place }) => fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, { place, id })
        )
        assert.deepStrictEqual(reads.map((b) => [b.text, b.sidecar]), [
          ["{\"v\":2}", sidecarOf("two")],
          ["{\"v\":1}", sidecarOf("one")]
        ])
        assert.strictEqual(reads[0]?.hash, sha256(new TextEncoder().encode("{\"v\":2}")))
      })
    ))

  it.effect("gives a version from before the map had a sidecar the sidecar it has now", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(InvokeChannels.createMap, { fileName: map, text: "{\"v\":1}" })
        yield* fake.invoke(InvokeChannels.saveMap, { fileName: map, text: "{\"v\":2}" })
        yield* fake.invoke(InvokeChannels.writeSidecar, { fileName: map, text: sidecarOf("now") })
        const [backup] = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        const { id, place } = backup!
        assert.deepInclude(yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, { place, id }), {
          text: "{\"v\":1}",
          sidecar: sidecarOf("now")
        })
      })
    ))

  it.effect("won't read a sidecar's backup as a map's", () =>
    withSidecar(({ fake, files, project }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        yield* fake.invoke(InvokeChannels.writeSidecar, { fileName: map, text: sidecarOf("two") })
        const [id = ""] = yield* files.readDirectory(path.join(project, ".ballest", "backups"))
        assert.include(id, sidecar)
        const refused = yield* Effect.flip(fake.invoke(InvokeChannels.readBackup, { place: "project", id }))
        assert.match(String(refused.cause), /doesn't exist any more/)
      })
    ))

  it.effect("a new map doesn't take over a sidecar left behind", () =>
    withSidecar(({ fake, files, maps }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        yield* files.remove(path.join(maps, map))
        yield* fake.invoke(InvokeChannels.createMap, { fileName: map, text: "{\"new\":1}" })
        assert.deepInclude(yield* fake.invoke(InvokeChannels.readMap, { fileName: map }), { sidecar: null })
      })
    ))
})

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
        const created = yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text })
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
        const clash = yield* Effect.flip(fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" }))
        assert.match(String(clash.cause), /already has a map called/)

        yield* fake.invoke(InvokeChannels.saveMap, { fileName: name, text: `${text}\r\n` })
        assert.deepInclude(yield* fake.invoke(InvokeChannels.readMap, { fileName: name }), {
          text: `${text}\r\n`
        })

        const renamed = "Map_LevelEditorMain&Loop_me.balledit"
        yield* fake.invoke(InvokeChannels.renameMap, { from: name, to: renamed, text: "{\"renamed\":1}" })
        assert.deepStrictEqual(
          (yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)).map((m) => m.fileName),
          [
            renamed
          ]
        )
        // The Save kept the file it wrote over, the Rename the file it moved away from: newest first.
        const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["project", name], ["project", name]])
        const texts = yield* Effect.forEach(
          backups,
          ({ place, id }) =>
            fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, { place, id }).pipe(
              Effect.map((b) => b.text)
            )
        )
        assert.deepStrictEqual(texts, [`${text}\r\n`, text])
        assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 2)

        // Names only: nothing reaches outside maps/.
        for (const bad of ["../x.balledit", "a/b.balledit", "x.json", ".balledit", "con:.balledit"]) {
          const error = yield* Effect.flip(fake.invoke(InvokeChannels.saveMap, { fileName: bad, text }))
          assert.match(String(error.cause), /isn't a map file name/, bad)
        }
        assert.isFalse(yield* fs.exists(path.join(project, "x.balledit")))

        // The hash follows the bytes, and the published id is read from them.
        const published = "{\"worldSettings\":{\"levelData\":{\"levelPublishedFileId\":3456}}}"
        assert.deepInclude(yield* fake.invoke(InvokeChannels.saveMap, { fileName: renamed, text: published }), {
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
            yield* fake.invoke(InvokeChannels.createMap, { fileName, text })
            yield* fake.invoke(InvokeChannels.saveMap, { fileName, text: "{}" })
            const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
            const backup = backups.find((b) => b.fileName === fileName)
            assert.isDefined(backup, sample)
            const read = yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, backup)
            assert.isTrue(read.text === text, `${sample} differs after the backup`)
          }
        })
      ),
    // every sample is written, hashed and read back: tens of MB, slow on a CI runner
    60_000
  )
})
