import {
  CHARACTERS_PER_FILE,
  ExportChecks,
  ExportMapResult,
  GameMaps,
  ImportMapResult,
  InvokeChannels,
  MapBackupFile,
  MapBackups,
  MAX_FILE_BYTES,
  OpenedMapFile,
  ProjectMapFile,
  ProjectMaps
} from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, FileSystem, Option, Path, Schema } from "effect"
import { sha256 } from "../project/files"
import { LinkFile } from "../project/MapLinks"
import { expectTag, withHandlers } from "./handlersHarness"

/** The newest version main kept of a file it wrote over in the game's maps folder. */
const exportBackupIn = (fake: Parameters<Parameters<typeof withHandlers>[0]>[0]["fake"]) =>
  Effect.gen(function*() {
    const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
    const { id, place } = backups.find((backup) => backup.place === "export")!
    return yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, { place, id })
  })

describe("MapExports over IPC", () => {
  it.effect("a Re-import leaves the sidecar for the page to re-match, and the game's copies get the map's", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const fileName = "Map_LevelEditorMain&Track_me.balledit"
        const payload = { fileName, replacePublished: false, overwriteChanged: false }
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fake.invoke(InvokeChannels.createMap, { fileName, text: "{\"v\":1}" })
        yield* fake.invoke(InvokeChannels.writeSidecar, { fileName, text: "sidecar" })
        yield* fake.invoke(InvokeChannels.exportMap, payload)
        assert.isFalse(yield* fs.exists(path.join(steam.maps, "Map_LevelEditorMain&Track_me.editor.json")))

        yield* fs.writeFileString(path.join(steam.maps, fileName), "{\"v\":2}")
        assert.deepInclude(yield* fake.invokeAs(ProjectMapFile, InvokeChannels.reimportMap, { fileName }), {
          text: "{\"v\":2}",
          sidecar: "sidecar"
        })

        yield* fake.invoke(InvokeChannels.saveMap, { fileName, text: "{\"v\":3}" })
        yield* fs.writeFileString(path.join(steam.maps, fileName), "{\"v\":4}")
        yield* fake.invoke(InvokeChannels.exportMap, { ...payload, overwriteChanged: true })
        assert.deepInclude(yield* exportBackupIn(fake), { text: "{\"v\":4}", sidecar: "sidecar" })
      })
    ))

  it.effect("imports a map from the game's maps folder linked to it, and exports it back with its hash", () =>
    withHandlers(({ fake, dialogs, dir, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const inGame = path.join(steam.maps, name)
        const original = "{\r\n\t\"items\": []\r\n}"
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fs.writeFileString(inGame, original)

        // Not picked: the page can't name a file to import.
        const unpicked = { source: inGame, fileName: name, text: original, replace: false }
        assert.match(String((yield* Effect.flip(fake.invoke(InvokeChannels.importMap, unpicked))).cause), /picked/)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(InvokeChannels.pickImport))
        dialogs.answers.push(inGame)
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.pickImport), { path: inGame, name, text: original })
        assert.strictEqual(Option.getOrNull(dialogs.asked[0]!.defaultPath), steam.maps)

        const imported = expectTag(
          yield* fake.invokeAs(ImportMapResult, InvokeChannels.importMap, unpicked),
          "Imported"
        )
        const hash = sha256(new TextEncoder().encode(original))
        assert.deepInclude(imported.map.link?.origin, { path: inGame, hash })
        assert.deepInclude(imported.map.link?.export, { path: inGame, hash })
        assert.strictEqual(imported.map.link?.lastSeenHash, hash)
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), original)
        const links = yield* fs.readFileString(path.join(project, ".ballest", "link.json")).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(LinkFile)))
        )
        assert.deepStrictEqual(Object.keys(links.maps), [name])

        // The same name again: reported, then replaced on request with the old copy in backups.
        const again = { ...unpicked, text: "{\"v\":2}" }
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.importMap, again), {
          _tag: "Clash",
          fileName: name
        })
        yield* fake.invoke(InvokeChannels.importMap, { ...again, replace: true })
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), "{\"v\":2}")
        assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 1)

        // A file from elsewhere has an origin but no export.
        const download = path.join(dir, "Downloads", "Map_LevelEditorMain&Other_me.balledit")
        yield* fs.makeDirectory(path.dirname(download), { recursive: true })
        yield* fs.writeFileString(download, "{}")
        dialogs.answers.push(download)
        yield* fake.invoke(InvokeChannels.pickImport)
        const other = expectTag(
          yield* fake.invokeAs(ImportMapResult, InvokeChannels.importMap, {
            source: download,
            fileName: path.basename(download),
            text: "{}",
            replace: false
          }),
          "Imported"
        )
        assert.deepInclude(other.map.link, { export: null, lastSeenHash: null })

        expectTag(
          yield* fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          }),
          "Exported"
        )
        const exportedHash = sha256(new TextEncoder().encode("{\"v\":2}"))
        const maps = yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)
        const link = maps.find((m) => m.fileName === name)?.link
        assert.deepInclude(link?.export, { path: inGame, hash: exportedHash })
        assert.strictEqual(link?.lastSeenHash, exportedHash)
        assert.deepInclude(link?.origin, { path: inGame, hash })
        assert.strictEqual(yield* fs.readFileString(inGame), "{\"v\":2}")
      })
    ))

  it.effect("lists the game's maps with the project map each already is, and imports one picked from the list", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const mapText = (name: string, items: number, publishedId = -1) =>
          JSON.stringify({
            worldSettings: {
              levelData: { levelDisplayName: name, creatorName: "me", levelPublishedFileId: publishedId }
            },
            items: Array.from({ length: items }, () => ({}))
          })
        // No maps folder yet: nothing to list.
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listGameMaps), [])

        const started = "Map_LevelEditorMain&Started_me.balledit"
        const published = "Map_LevelEditorMain&Shared_me.balledit"
        const broken = "Map_LevelEditorMain&Broken_me.balledit"
        yield* fs.makeDirectory(path.join(steam.maps, "Sub"), { recursive: true })
        yield* fs.writeFileString(path.join(steam.maps, started), mapText("Started", 3))
        yield* fs.writeFileString(path.join(steam.maps, published), mapText("Shared", 1, 42))
        yield* fs.writeFileString(path.join(steam.maps, broken), "{")
        yield* fs.writeFileString(path.join(steam.maps, "notes.txt"), "not a map")
        yield* fs.writeFileString(path.join(steam.maps, "Sub", "Map_LevelEditorMain&Deep_me.balledit"), "{}")

        const listed = yield* fake.invokeAs(GameMaps, InvokeChannels.listGameMaps)
        const byName = new Map(listed.map((map) => [map.fileName, map]))
        assert.sameMembers([...byName.keys()], [started, published, broken])
        assert.deepInclude(byName.get(started), {
          displayName: "Started",
          creatorName: "me",
          itemCount: 3,
          publishedFileId: -1,
          inProject: null
        })
        assert.deepInclude(byName.get(published), { publishedFileId: 42, itemCount: 1 })
        assert.deepInclude(byName.get(broken), { displayName: null, itemCount: null, publishedFileId: -1 })

        // Picked from the list, it imports linked to the game's file, and the list says so.
        const picked = yield* fake.invokeAs(OpenedMapFile, InvokeChannels.pickGameMap, { fileName: started })
        assert.strictEqual(picked.path, path.join(steam.maps, started))
        const imported = expectTag(
          yield* fake.invokeAs(ImportMapResult, InvokeChannels.importMap, {
            source: picked.path,
            fileName: started,
            text: picked.text,
            replace: false
          }),
          "Imported"
        )
        assert.strictEqual(imported.map.link?.export?.path, picked.path)
        const after = yield* fake.invokeAs(GameMaps, InvokeChannels.listGameMaps)
        assert.strictEqual(after.find((map) => map.fileName === started)?.inProject, started)

        // A name that leaves the folder is refused before main looks.
        const escape = { fileName: "../Map_LevelEditorMain&Started_me.balledit" }
        yield* Effect.flip(fake.invoke(InvokeChannels.pickGameMap, escape))
        const gone = { fileName: "Map_LevelEditorMain&Gone_me.balledit" }
        yield* Effect.flip(fake.invoke(InvokeChannels.pickGameMap, gone))
      })
    ))

  it.effect("asks before exporting over the draft of a published map", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Published_me.balledit"
        const target = path.join(steam.maps, name)
        const published = JSON.stringify({
          worldSettings: { levelData: { levelPublishedFileId: 3561234567 } },
          items: []
        })
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fs.writeFileString(target, published)
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" })

        assert.deepStrictEqual(
          yield* fake.invoke(InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          }),
          { _tag: "Published", file: { path: target, name }, publishedFileId: 3561234567 }
        )
        assert.strictEqual(yield* fs.readFileString(target), published)
        const replaced = yield* fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: true,
          overwriteChanged: false
        })
        assert.strictEqual(replaced._tag, "Exported")
        assert.strictEqual(yield* fs.readFileString(target), "{}")

        // A never-published draft (-1) is replaced without the published question (the game changed the export, so
        // only that is asked).
        yield* fs.writeFileString(
          target,
          JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: -1 } } })
        )
        const again = yield* fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: false,
          overwriteChanged: true
        })
        assert.strictEqual(again._tag, "Exported")
      })
    ))

  it.effect("a Re-import given what to keep writes it to the project and over the game's copy, in sync", () =>
    withHandlers(({ fake, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const fileName = "Map_LevelEditorMain&Keep_me.balledit"
        const inGame = path.join(steam.maps, fileName)
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fake.invoke(InvokeChannels.createMap, { fileName, text: "{\"v\":1}" })
        yield* fake.invoke(InvokeChannels.exportMap, { fileName, replacePublished: false, overwriteChanged: false })
        yield* fs.writeFileString(inGame, "{\"v\":2}")
        const text = "{\"v\":2,\"editorState\":{}}"
        const kept = text
        // the game saved again after the page read it: that save isn't written over
        const stale = { text, gameHash: sha256(new TextEncoder().encode("{\"v\":1}")) }
        const refused = yield* Effect.flip(fake.invoke(InvokeChannels.reimportMap, { fileName, kept: stale }))
        assert.match(String(refused.cause), /changed in the game/)
        assert.strictEqual(yield* fs.readFileString(inGame), "{\"v\":2}")
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", fileName)), "{\"v\":1}")

        const read = yield* fake.invokeAs(ProjectMapFile, InvokeChannels.readExport, { fileName })
        assert.strictEqual(read.hash, sha256(new TextEncoder().encode("{\"v\":2}")))
        const file = yield* fake.invokeAs(ProjectMapFile, InvokeChannels.reimportMap, {
          fileName,
          kept: { text, gameHash: read.hash }
        })
        assert.strictEqual(file.text, kept)
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", fileName)), kept)
        assert.strictEqual(yield* fs.readFileString(inGame), kept)
        const hash = sha256(new TextEncoder().encode(kept))
        assert.deepInclude(file, { hash })
        assert.strictEqual(file.link?.export?.hash, hash)
        assert.strictEqual(file.link?.lastSeenHash, hash)
        // the game's own version is kept
        assert.deepInclude(yield* exportBackupIn(fake), { text: "{\"v\":2}" })
      })
    ))

  it.live(
    "never takes the app's own export for a change in the game",
    () =>
      withHandlers(({ fake }) =>
        Effect.gen(function*() {
          const name = "Map_LevelEditorMain&Race_me.balledit"
          const check = fake.invokeAs(ExportChecks, InvokeChannels.checkExports)
          const exportIt = fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          })
          yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{\"v\":0}" })
          expectTag(yield* exportIt, "Exported")
          // The window can take the focus at any moment of an Export, so a check runs at every one of them.
          const reported: Array<string> = []
          const checking = yield* Effect.forkChild(Effect.forever(
            check.pipe(Effect.tap(({ changed }) => Effect.sync(() => reported.push(...changed))))
          ))
          for (let version = 1; version <= 40; version++) {
            yield* fake.invoke(InvokeChannels.saveMap, { fileName: name, text: `{"v":${version}}` })
            expectTag(yield* exportIt, "Exported")
          }
          yield* Fiber.interrupt(checking)
          assert.deepStrictEqual(reported, [])
        })
      ),
    30_000
  )

  it.effect("reports an export the game changed once, asks before exporting over it, and re-imports it", () =>
    withHandlers(({ fake, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Sync_me.balledit"
        const inGame = path.join(steam.maps, name)
        const inProject = path.join(project, "maps", name)
        const hashOf = (text: string) => sha256(new TextEncoder().encode(text))
        const check = fake.invokeAs(ExportChecks, InvokeChannels.checkExports)
        const exportIt = (overwriteChanged: boolean) =>
          fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged
          })
        const linkOf = Effect.gen(function*() {
          const maps = yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)
          return maps.find((m) => m.fileName === name)?.link
        })
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{\"v\":1}" })
        expectTag(yield* exportIt(false), "Exported")
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })

        // The in-game editor saves it: reported once, however often it is looked at.
        const saved = "{\"v\":1,\"editorState\":{}}"
        yield* fs.writeFileString(inGame, saved)
        const [first, second] = yield* Effect.all([check, check], { concurrency: "unbounded" })
        assert.deepStrictEqual([first, second].flatMap((c) => c.changed), [name])
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })
        assert.deepInclude(yield* linkOf, { lastSeenHash: hashOf(saved) })
        assert.strictEqual((yield* linkOf)?.export?.hash, hashOf("{\"v\":1}"))

        // Export asks first; overwriting keeps the game's version in the backups.
        assert.deepStrictEqual(yield* exportIt(false), { _tag: "ChangedInGame", file: { path: inGame, name } })
        assert.strictEqual(yield* fs.readFileString(inGame), saved)
        expectTag(yield* exportIt(true), "Exported")
        assert.strictEqual(yield* fs.readFileString(inGame), "{\"v\":1}")
        const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        const [kept] = backups
        assert.deepInclude(kept, { place: "export", fileName: name })
        assert.strictEqual((yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, kept)).text, saved)

        // Saved in the game again, and seen by an Export first: the check doesn't report it again.
        const again = "{\"v\":1,\"editorState\":{\"again\":1}}"
        yield* fs.writeFileString(inGame, again)
        expectTag(yield* exportIt(false), "ChangedInGame")
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })

        // Re-import: the game's version replaces the project's, which goes to the project's backups.
        const reimported = yield* fake.invokeAs(ProjectMapFile, InvokeChannels.reimportMap, { fileName: name })
        assert.strictEqual(reimported.text, again)
        assert.strictEqual(yield* fs.readFileString(inProject), again)
        assert.deepInclude(reimported.link?.export, { path: inGame, hash: hashOf(again) })
        assert.strictEqual(reimported.link?.lastSeenHash, hashOf(again))
        const projectBackup = (yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)).find((b) =>
          b.place === "project"
        )
        assert.strictEqual(
          (yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, projectBackup)).text,
          "{\"v\":1}"
        )
        expectTag(yield* exportIt(false), "Exported")

        // Deleted in the game: the link's export is dropped, once.
        yield* fs.remove(inGame)
        assert.deepStrictEqual(yield* check, { changed: [], missing: [name] })
        assert.deepInclude(yield* linkOf, { export: null, lastSeenHash: null })
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })
        const refused = yield* Effect.flip(fake.invoke(InvokeChannels.reimportMap, { fileName: name }))
        assert.match(String(refused.cause), /no export/)
      })
    ))

  // `truncate` grows a file with holes, so these write nothing to disk until Export copies one.
  it.effect("refuses a file past the game's character limit, as the file is now, and writes nothing", () =>
    withHandlers(({ fake, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Long_me.balledit"
        const inGame = path.join(steam.maps, name)
        const exportIt = fake.invoke(InvokeChannels.exportMap, {
          fileName: name,
          // nothing it could ask about gets it past this
          replacePublished: true,
          overwriteChanged: true
        })
        const linkOf = fake.invokeAs(ProjectMaps, InvokeChannels.listMaps).pipe(
          Effect.map((maps) => maps.find((m) => m.fileName === name)?.link)
        )
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" })
        yield* exportIt
        const linked = yield* linkOf

        // Grown by hand after the app read it: the open tab still shows a clean map, so nothing goes through Save.
        yield* fs.truncate(path.join(project, "maps", name), CHARACTERS_PER_FILE + 1)
        const refused = yield* Effect.flip(exportIt)
        assert.match(
          String(refused.cause),
          /^MapRefusedError: The map's file has 67108865 characters \(maximum 67108864\)/
        )
        assert.strictEqual(yield* fs.readFileString(inGame), "{}")
        assert.deepStrictEqual((yield* linkOf)?.export, linked?.export)
        // Nor could it be opened again: only a tab from before it grew gets as far as Export.
        // Counted once read, and by its size first when no count could bring it under.
        for (const bytes of [CHARACTERS_PER_FILE + 1, MAX_FILE_BYTES + 1]) {
          yield* fs.truncate(path.join(project, "maps", name), bytes)
          const unread = yield* Effect.flip(fake.invoke(InvokeChannels.readMap, { fileName: name }))
          assert.match(String(unread.cause), /more characters than the game loads \(67108864\)/)
        }
      })
    ))

  it.effect(
    "counts characters, not bytes: a file at the limit in characters but past it in bytes goes everywhere",
    () =>
      withHandlers(({ fake, project, steam }) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          // `é` is two bytes and one character, and a BOM isn't a character of the text the game reads.
          const files = [
            { name: "Map_LevelEditorMain&Wide_me.balledit", text: "é", bytes: CHARACTERS_PER_FILE + 1 },
            { name: "Map_LevelEditorMain&Marked_me.balledit", text: "\uFEFFé", bytes: CHARACTERS_PER_FILE + 4 }
          ]
          for (const { bytes, name, text } of files) {
            yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text })
            yield* fs.truncate(path.join(project, "maps", name), bytes)
            const opened = yield* fake.invokeAs(ProjectMapFile, InvokeChannels.readMap, { fileName: name })
            assert.strictEqual(opened.text.length, CHARACTERS_PER_FILE)

            yield* fake.invoke(InvokeChannels.exportMap, {
              fileName: name,
              replacePublished: false,
              overwriteChanged: false
            })
            const inGame = path.join(steam.maps, name)
            assert.strictEqual(Number((yield* fs.stat(inGame)).size), bytes)
            // The in-game editor's sync reads it back, and File › Import map lists it and picks it.
            yield* fake.invokeAs(ProjectMapFile, InvokeChannels.readExport, { fileName: name })
            const listed = yield* fake.invokeAs(GameMaps, InvokeChannels.listGameMaps)
            assert.include(listed.map((map) => map.fileName), name)
            const picked = yield* fake.invokeAs(OpenedMapFile, InvokeChannels.pickGameMap, { fileName: name })
            assert.strictEqual(picked.text.length, CHARACTERS_PER_FILE)
          }
        })
      ),
    30_000
  )

  it.effect("drops no link while the game's maps folder isn't there", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const name = "Map_LevelEditorMain&Away_me.balledit"
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" })
        yield* fake.invoke(InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: false,
          overwriteChanged: false
        })
        yield* fs.remove(steam.maps, { recursive: true })
        assert.deepStrictEqual(yield* fake.invokeAs(ExportChecks, InvokeChannels.checkExports), {
          changed: [],
          missing: []
        })
        const [map] = yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)
        assert.isNotNull(map?.link?.export)
      })
    ))

  it.effect("Export keeps the game's copy it writes over in userData's backups, once per change", () =>
    withHandlers(({ fake, dir, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fs.writeFileString(path.join(steam.maps, name), "{\"edited\":\"in game\"}")
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{\"v\":1}" })

        const exportIt = fake.invoke(InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: false,
          overwriteChanged: false
        })
        yield* exportIt
        // The same bytes again: nothing to keep.
        yield* exportIt
        const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["export", name]])
        const [backup] = backups
        const read = yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, backup)
        assert.strictEqual(read.text, "{\"edited\":\"in game\"}")
        assert.lengthOf(yield* fs.readDirectory(path.join(dir, "userData", "backups")), 1)

        // Only names main wrote in its own folders.
        for (const id of ["../desktop-settings.json", `../../${name}`, name, "notes.txt"]) {
          const error = yield* Effect.flip(fake.invoke(InvokeChannels.readBackup, { place: "export", id }))
          assert.match(String(error.cause), /doesn't exist/, id)
        }
        const unknown = { place: "project", id: `2026-10-31T12-00-00-000Z ${name}` }
        assert.match(String((yield* Effect.flip(fake.invoke(InvokeChannels.readBackup, unknown))).cause), /exist/)
      })
    ))
})
