import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { creatorOf } from "../domain/creator"
import { allFound, GAME_NOT_FOUND, gameLinkRows, PLUGIN_MANAGER_MISSING, PLUGIN_MISSING } from "../domain/gameLink"
import { linkStateOf } from "../domain/linkState"
import { defaultSettings } from "../domain/Settings"
import { lightingOf } from "../domain/sunlight"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { Platform } from "../services/Platform"
import {
  GAME_EXE,
  makeTestDisk,
  projectFile,
  TEST_MAPS_FOLDER,
  TEST_PROJECT,
  testBridge,
  type TestDisk,
  testHash
} from "../test/desktopBridge"
import { listSamples, readSample } from "../test/samples"
import {
  answerUnloadRequest,
  checkGameLinkEffect,
  chooseGameLinkFolderEffect,
  closeMapTabEffect,
  createNewMap,
  describeBackupEffect,
  duplicateMapEffect,
  exportToGameEffect,
  findCreatorEffect,
  followUpdateState,
  holdsUnload,
  importAsCopyEffect,
  importMapFile,
  installPluginEffect,
  keepNotifications,
  launchGameEffect,
  muteNotificationKindEffect,
  openProjectMap,
  openProjectMapFile,
  playEffect,
  recoverBackupEffect,
  replaceOnImportEffect,
  saveMapAsEffect,
  saveMapFile,
  startNewMapEffect,
  unlessCancelled
} from "./actions"
import { useEditor } from "./store"

const s = () => useEditor.getState()

const layerFor = (disk: TestDisk) =>
  Layer.mergeAll(
    Platform.layerDesktop(testBridge(disk)),
    MapPrefsStore.layerTest,
    MapExporter.layerNoDeps.pipe(Layer.provideMerge(Layer.mergeAll(MapCodec.layer, DateTime.layerCurrentZoneOffset(0))))
  )

/** The time a save stamps into `createdAt` ("2026.10.06-17.49.47"), so a test can make it write the same one. */
const createdAtTime = (createdAt: string) => {
  const [y, mo, d, h, mi, sec] = createdAt.split(/[.-]/).map(Number)
  return Date.UTC(y!, mo! - 1, d, h, mi, sec)
}

const balledits = listSamples().filter((sample) => sample.kind === "balledit")
const ballmaps = listSamples().filter((sample) => sample.kind === "ballmap")
const fileNameOf = (sample: { readonly name: string }) => sample.name.split("/").pop()!

/** `layerFor`, with the page's close and reload recorded in `left` instead of done. */
const layerLeavingInto = (disk: TestDisk, left: Array<string>) =>
  Layer.effect(
    Platform,
    Effect.gen(function*() {
      const platform = yield* Platform
      return Platform.of({ ...platform, leave: (kind) => Effect.sync(() => void left.push(kind)) })
    })
  ).pipe(Layer.provideMerge(layerFor(disk)))

/** An edit to the open map, so it has unsaved changes: the time of day moves on an hour. */
const edit = () => {
  const lighting = lightingOf(s().doc.map.worldSettings)
  s().setLighting({ ...lighting, timeOfDay: (lighting.timeOfDay + 1) % 24 })
}

/** A fresh editor for each test: the store outlives the layers. */
const reset = Effect.sync(() => {
  s().loadMap(s().doc.map, null)
  s().setImportClash(null)
  s().setPublishedDraft(null)
  s().closeDialog()
})

/** Imports `path` through the dialog. */
const importFrom = (disk: TestDisk, path: string) =>
  Effect.gen(function*() {
    disk.answers.push(path)
    yield* importMapFile
  })

describe("project actions", () => {
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
        assert.isTrue(disk.files.get(projectFile(name)) === text, "the saved file differs from the game's")

        disk.files.set(inGame, "changed in the game")
        yield* exportToGameEffect(false)
        assert.isTrue(disk.files.get(inGame) === text, "the export differs from the project file")
        assert.strictEqual(disk.links.get(TEST_PROJECT)?.get(name)?.export?.hash, testHash(text))
      }).pipe(Effect.provide(layerFor(disk)))
    }
  )

  it.effect("New map saves into the project at once; Save, Rename and Duplicate ask nothing more", () => {
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
      yield* saveMapAsEffect
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
      assert.match(error.message, /already has a map called/)
      assert.strictEqual(disk.files.get(projectFile(renamed)), before)

      yield* openProjectMapFile(renamed)
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, "Hairpin")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save names a map that has no file yet first, then writes it into the project", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* saveMapFile
      assert.strictEqual(s().dialog, "saveAs")
      assert.strictEqual(disk.files.size, 0)
      s().closeDialog()

      s().renameLevel("Fresh", "Isaac")
      yield* saveMapAsEffect
      const name = "Map_LevelEditorMain&Fresh_Isaac.balledit"
      assert.deepStrictEqual(s().file, { name, path: projectFile(name) })
      assert.isTrue(disk.files.has(projectFile(name)))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a name clash on import asks; Import as copy renames the map, Replace keeps the name", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const download = `/home/me/Downloads/${name}`
    const disk = makeTestDisk({ [download]: readSample(sample), [projectFile(name)]: "{}" })
    return Effect.gen(function*() {
      yield* reset
      yield* importFrom(disk, download)
      assert.strictEqual(s().dialog, "importClash")
      assert.strictEqual(s().importClash?.fileName, name)
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
      assert.strictEqual(s().dialog, "importClash")
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

  it.effect("Export saves unsaved edits first, and asks before replacing a published map's draft", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const inGame = `${TEST_MAPS_FOLDER}/${name}`
    const published = JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: 3561234567 } } })
    const disk = makeTestDisk({ [projectFile(name)]: readSample(sample), [inGame]: published })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 5 })
      yield* exportToGameEffect(false)
      assert.isFalse(s().dirty)
      assert.deepStrictEqual(s().publishedDraft, { name, publishedFileId: 3561234567, from: "export" })
      assert.strictEqual(s().dialog, "replacePublished")
      assert.strictEqual(disk.files.get(inGame), published)

      s().setPublishedDraft(null)
      yield* exportToGameEffect(true)
      assert.strictEqual(disk.files.get(inGame), disk.files.get(projectFile(name)))
      const exported = yield* MapCodec.use((codec) => codec.decode(disk.files.get(inGame)!))
      assert.strictEqual(exported.worldSettings.directionalLight.timeOfDay, 5)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("the open map's link state follows exports and saves, and each export is a notification with Reveal", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const disk = makeTestDisk({ [projectFile(name)]: readSample(sample) })
    const stateNow = () => {
      const map = s().projectMaps.find((m) => m.fileName === name)!
      return linkStateOf(map, { unsaved: s().dirty })
    }
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      // a save lists the project's maps again
      yield* saveMapFile
      assert.strictEqual(stateNow(), "notExported")
      yield* exportToGameEffect(false)
      assert.strictEqual(stateNow(), "inSync")
      assert.deepInclude(s().notifications[0], {
        kind: "mapExported",
        level: "info",
        actions: [{ label: "Reveal", command: { _tag: "RevealGamePath", which: "mapsFolder" } }]
      })

      s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay: 7 })
      assert.strictEqual(stateNow(), "editedSinceExport")
      yield* saveMapFile
      assert.isFalse(s().dirty)
      assert.strictEqual(stateNow(), "editedSinceExport")
      assert.strictEqual(s().notifications[0]?.kind, "mapSaved")
      yield* exportToGameEffect(false)
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("closing a map's tab asks about unsaved edits with the shared prompt, then shows Start", () => {
    const name = fileNameOf(balledits[0]!)
    const disk = makeTestDisk({ [projectFile(name)]: readSample(balledits[0]!) })
    const editTo = (timeOfDay: number) => s().setLighting({ ...lightingOf(s().doc.map.worldSettings), timeOfDay })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      // opening the map that is open only brings its tab forward
      s().showStart()
      openProjectMap(name)
      assert.strictEqual(s().activeTab, "map")

      editTo(9)
      disk.promptAnswers.push("cancel", "save")
      yield* closeMapTabEffect
      assert.include(s(), { mapOpen: true, dirty: true })
      assert.match(disk.prompts[0]?.message ?? "", /before closing the map\?$/)
      // Save: written first, then the tab closes and Start shows
      yield* closeMapTabEffect
      assert.include(s(), { mapOpen: false, activeTab: "start", dirty: false })
      const saved = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(name))!))
      assert.strictEqual(saved.worldSettings.directionalLight.timeOfDay, 9)

      // Don't save: the file keeps its last save
      yield* openProjectMapFile(name)
      editTo(2)
      const before = disk.files.get(projectFile(name))
      disk.promptAnswers.push("discard")
      yield* closeMapTabEffect
      assert.include(s(), { mapOpen: false, dirty: false })
      assert.strictEqual(disk.files.get(projectFile(name)), before)

      // a clean map closes without asking
      yield* openProjectMapFile(name)
      const asked = disk.prompts.length
      yield* closeMapTabEffect
      assert.include(s(), { mapOpen: false })
      assert.strictEqual(disk.prompts.length, asked)
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

      s().setExportOnSave(true)
      yield* saveMapFile
      assert.strictEqual(disk.files.get(`${TEST_MAPS_FOLDER}/${name}`), disk.files.get(projectFile(name)))
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
      yield* unlessCancelled("openMap", recoverBackupEffect(first!))
      assert.strictEqual(disk.prompts.length, 1)
      assert.strictEqual(disk.files.get(projectFile(name)), saved)
      assert.strictEqual(disk.backups.length, 1)
      assert.strictEqual(lightingOf(s().doc.map.worldSettings).timeOfDay, 9)

      // Save: the edits are written over the file, which goes to the backups, then the version opens.
      disk.promptAnswers.push("save")
      yield* unlessCancelled("openMap", recoverBackupEffect(first!))
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
      yield* exportToGameEffect(false)
      assert.deepStrictEqual(disk.backups.map((b) => [b.place, b.text]), [["export", "edited in the game"]])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("creator actions", () => {
  it.effect("puts the creator found on the machine in the store, until the user types one", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      s().setSettings(defaultSettings)
      yield* findCreatorEffect
      assert.isTrue(Option.isNone(s().foundCreator))

      disk.game.creator = { name: "Speedy Marble", source: "steam" }
      yield* findCreatorEffect
      assert.deepStrictEqual(creatorOf(s().settings.general.creatorName, s().foundCreator), {
        name: "Speedy Marble",
        source: "steam",
        valid: true
      })
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

/** Collects what the store would toast, for the rest of the effect. */
const noticesWhile = <A, E, R>(body: (notices: Array<string>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const notify = s().notify
      const notices: Array<string> = []
      useEditor.setState({ notify: (_kind, text) => void notices.push(text) })
      return { notify, notices }
    }),
    ({ notices }) => body(notices),
    ({ notify }) => Effect.sync(() => useEditor.setState({ notify }))
  )

describe("plugin actions", () => {
  it.effect("Install puts the plugin in, and says when the game must restart to load it", () => {
    const disk = makeTestDisk()
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        s().setPluginStatus(disk.game.plugin)
        yield* installPluginEffect
        assert.strictEqual(disk.game.pluginInstalls, 1)
        assert.deepInclude(s().pluginStatus, { status: "current", installedVersion: "0.2.0" })
        assert.deepStrictEqual(notices, ["Installed the editor's plugin"])

        disk.game.plugin = { ...disk.game.plugin, status: "outdated", installedVersion: "0.1.0" }
        disk.game.running = true
        s().setPluginStatus(disk.game.plugin)
        yield* installPluginEffect
        assert.strictEqual(notices[1], "Updated the editor's plugin to 0.2.0. Restart the game to use Play.")
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Install fails without the plugin manager, and installs nothing", () => {
    const disk = makeTestDisk()
    disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager" }
    return Effect.gen(function*() {
      const error = yield* Effect.flip(installPluginEffect)
      assert.match(error.message, /plugin manager isn't installed/)
      assert.strictEqual(disk.game.pluginInstalls, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("game link actions", () => {
  const found = { game: true, pluginManager: true }
  const installed = (disk: TestDisk) => {
    disk.game.paths = {
      ...disk.game.paths,
      pluginsFolder: { status: "found", path: "/game/Ballest/Binaries/Win64/plugins" }
    }
    disk.game.plugin = { ...disk.game.plugin, status: "current", installedVersion: "0.2.0" }
  }
  /** What a restart forgets: the store's lookups and notifications (the disk keeps its own). */
  const restart = Effect.sync(() =>
    useEditor.setState({
      notifications: [],
      mutedNotificationKinds: new Set(),
      gameLink: { firstRun: true, last: null },
      gamePathProblem: null,
      gamePaths: null,
      pluginStatus: null
    })
  )
  const kinds = () => s().notifications.map((n) => n.kind)
  const pinned = () => s().notifications.filter((n) => n.persistent && n.resolvedAt === null).map((n) => n.kind)

  it.effect("the first launch shows every row found and notifies nothing; the next one starts collapsed", () => {
    const disk = makeTestDisk()
    installed(disk)
    s().setSettings({ ...defaultSettings, general: { ...defaultSettings.general, creatorName: "Isaac" } })
    return Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.isTrue(s().gameLink.firstRun)
      assert.isTrue(allFound(gameLinkRows(s().gamePaths, s().pluginStatus, creatorOf("Isaac", Option.none()))))
      assert.deepStrictEqual(kinds(), [])
      assert.deepStrictEqual(disk.gameLink.last, found)

      yield* restart
      yield* checkGameLinkEffect
      assert.isFalse(s().gameLink.firstRun)
      assert.deepStrictEqual(kinds(), [])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a lost game is pinned; a folder without the exe is refused with the reason, the game's resolves it", () => {
    const disk = makeTestDisk({ [`/games/Ballest of Them All/${GAME_EXE}`]: "" })
    disk.gameLink.last = found
    disk.game.paths = {
      install: { status: "missing", path: null },
      mapsFolder: { status: "missing", path: null },
      pluginsFolder: { status: "missing", path: null }
    }
    disk.game.plugin = { ...disk.game.plugin, status: "noGame", folder: null }
    return Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(pinned(), [GAME_NOT_FOUND])
      assert.deepStrictEqual(disk.gameLink.last, { game: false, pluginManager: false })

      disk.answers.push("/home/me/Downloads")
      yield* chooseGameLinkFolderEffect("install")
      assert.deepInclude(s().gamePathProblem, { which: "install" })
      assert.match(s().gamePathProblem!.message, /^\/home\/me\/Downloads isn't Ballest of Them All's folder/)
      assert.strictEqual(disk.game.paths.install.status, "missing")
      assert.deepStrictEqual(pinned(), [GAME_NOT_FOUND])

      disk.answers.push("/games/Ballest of Them All")
      yield* chooseGameLinkFolderEffect("install")
      assert.isNull(s().gamePathProblem)
      assert.deepStrictEqual(s().gamePaths?.install, { status: "overridden", path: "/games/Ballest of Them All" })
      assert.deepStrictEqual(pinned(), [])
      assert.strictEqual(disk.gameLink.last?.game, true)

      // found again by the next launch: no news, since this session already kept it
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(kinds(), [])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  /** A launch that finds the plugin manager gone since the last one, which found everything. */
  const pluginManagerLost = () => {
    const disk = makeTestDisk()
    disk.gameLink.last = found
    disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager" }
    const launch = Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(pinned(), [PLUGIN_MANAGER_MISSING])
    })
    return { disk, launch }
  }

  it.effect("Don't show again keeps the plugin manager's notification hidden across restarts", () => {
    const { disk, launch } = pluginManagerLost()
    return Effect.gen(function*() {
      yield* launch
      assert.strictEqual(s().notifications[0]?.actions[0]?.command._tag, "OpenExternal")

      yield* muteNotificationKindEffect(PLUGIN_MANAGER_MISSING)
      assert.deepStrictEqual(kinds(), [])
      assert.deepStrictEqual(disk.gameLink.muted, [PLUGIN_MANAGER_MISSING])

      // it comes back, then goes again: muted, so nothing shows
      disk.gameLink.last = found
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(kinds(), [])
      assert.isTrue(s().mutedNotificationKinds.has(PLUGIN_MANAGER_MISSING))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("installing the plugin manager resolves its pinned notification on the next look", () => {
    const { disk, launch } = pluginManagerLost()
    return Effect.gen(function*() {
      yield* launch
      disk.game.plugin = { ...disk.game.plugin, status: "missing" }
      yield* chooseGameLinkFolderEffect("mapsFolder")
      // cancelled: nothing looked up again
      assert.deepStrictEqual(pinned(), [PLUGIN_MANAGER_MISSING])
      disk.answers.push("/elsewhere/UserSavedMaps")
      yield* chooseGameLinkFolderEffect("mapsFolder")
      assert.deepStrictEqual(pinned(), [])
      assert.deepStrictEqual(disk.gameLink.last, found)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

/** A sample in the project, published to the Workshop as item 3561234567 when `published`. */
const playSample = (published = false) => {
  const sample = balledits[0]!
  const name = fileNameOf(sample)
  const text = readSample(sample)
  return {
    name,
    label: name.replace(/^Map_LevelEditorMain&/, "").replace(/\.balledit$/, ""),
    text: published ? text.replace("\"levelPublishedFileId\": -1", "\"levelPublishedFileId\": 3561234567") : text
  }
}

/** A test disk holding `files`, with the editor's plugin installed in the game. */
const diskWithPlugin = (files: Record<string, string> = {}) => {
  const disk = makeTestDisk(files)
  disk.game.plugin = { ...disk.game.plugin, status: "current", installedVersion: "0.2.0" }
  return disk
}

describe("Play", () => {
  it.effect("saves unsaved edits, exports the map and has the plugin race it, starting the game first if need be", () => {
    const { name, label, text } = playSample()
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        yield* reset
        yield* openProjectMapFile(name)
        edit()
        yield* playEffect(false)
        assert.isFalse(s().dirty)
        assert.strictEqual(disk.files.get(`${TEST_MAPS_FOLDER}/${name}`), disk.files.get(projectFile(name)))
        assert.notStrictEqual(disk.files.get(projectFile(name)), text)
        assert.deepStrictEqual(disk.game.races, [name])
        assert.strictEqual(disk.game.launches, 1)
        assert.strictEqual(notices.at(-1), `Starting the game to race ${label}`)
        // the export is recorded like Export's
        assert.strictEqual(
          s().projectMaps.find((m) => m.fileName === name)?.link?.export?.hash,
          testHash(disk.files.get(projectFile(name))!)
        )

        disk.game.running = true
        yield* playEffect(false)
        assert.deepStrictEqual(disk.game.races, [name, name])
        assert.strictEqual(disk.game.launches, 1)
        assert.strictEqual(notices.at(-1), `Racing ${label} in the game`)
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("without the plugin, exports and starts the game, and one pinned notification per cause says why", () => {
    const { name, label, text } = playSample()
    const disk = makeTestDisk({ [projectFile(name)]: text })
    const pinned = () => s().notifications.filter((n) => n.persistent && n.resolvedAt === null)
    return Effect.gen(function*() {
      yield* reset
      useEditor.setState({ notifications: [], mutedNotificationKinds: new Set() })
      yield* openProjectMapFile(name)
      yield* playEffect(false)
      assert.deepStrictEqual(disk.game.races, [])
      assert.strictEqual(disk.game.launches, 1)
      assert.isTrue(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))
      const [notice] = pinned()
      assert.strictEqual(notice?.kind, PLUGIN_MISSING)
      assert.include(notice?.title, `Exported ${label} and started the game`)
      assert.deepStrictEqual(notice?.actions.map((a) => a.command._tag), ["InstallPlugin"])
      // Again: the same notification, updated, not a second one.
      disk.game.running = true
      yield* playEffect(false)
      assert.lengthOf(pinned(), 1)

      // Installing the plugin resolves it.
      s().setPluginStatus(disk.game.plugin)
      yield* installPluginEffect
      assert.lengthOf(pinned(), 0)

      // Without the plugin manager it is the Game link's own notice, with the install steps.
      disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager" }
      yield* playEffect(false)
      assert.deepStrictEqual(pinned().map((n) => [n.kind, n.title, n.actions.map((a) => a.command._tag)]), [
        [
          PLUGIN_MANAGER_MISSING,
          `Exported ${label}. Play needs the Ballest plugin manager to race it`,
          ["OpenExternal"]
        ]
      ])

      // A Play that reaches the plugin resolves what was pinned.
      disk.game.plugin = { ...disk.game.plugin, status: "current", installedVersion: "0.2.0" }
      yield* playEffect(false)
      assert.lengthOf(pinned(), 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("asks before replacing a published map's draft in the maps folder, then goes on with Play", () => {
    const { name, text } = playSample()
    const inGame = `${TEST_MAPS_FOLDER}/${name}`
    const draft = playSample(true).text
    const disk = diskWithPlugin({ [projectFile(name)]: text, [inGame]: draft })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      yield* playEffect(false)
      assert.deepStrictEqual(s().publishedDraft, { name, publishedFileId: 3561234567, from: "play" })
      assert.strictEqual(s().dialog, "replacePublished")
      assert.strictEqual(disk.files.get(inGame), draft)
      assert.deepStrictEqual(disk.game.races, [])

      s().setPublishedDraft(null)
      yield* playEffect(true)
      assert.strictEqual(disk.files.get(inGame), text)
      assert.deepStrictEqual(disk.game.races, [name])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a published map's draft can't be raced: Play offers a new draft of it, and races that", () => {
    const { name, text } = playSample(true)
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      yield* playEffect(false)
      assert.strictEqual(s().dialog, "newDraft")
      assert.isFalse(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))
      s().closeDialog()

      // The dialog's Save and play.
      const { creatorName } = s().doc.map.worldSettings.levelData
      yield* duplicateMapEffect("Draft of it", creatorName, false, true)
      yield* playEffect(false)
      const copy = s().file?.name ?? ""
      assert.notStrictEqual(copy, name)
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelPublishedFileId, -1)
      assert.deepStrictEqual(disk.game.races, [copy])
      assert.strictEqual(disk.files.get(projectFile(name)), text)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a map with no file yet is named first, then raced", () => {
    const disk = diskWithPlugin()
    return Effect.gen(function*() {
      yield* reset
      yield* playEffect(false)
      assert.strictEqual(s().dialog, "saveAs")
      assert.isNotNull(s().afterSave)
      assert.deepStrictEqual(disk.game.races, [])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

/** Waits, in real time, for the store's update state to reach `status`: the bridge answers with promises. */
const untilUpdate = (status: string) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1))).pipe(
    Effect.repeat({ until: () => s().update?.status === status, times: 100 })
  )

describe("update actions", () => {
  it.effect("follow the desktop updater's state into the store, and stop when interrupted", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(followUpdateState)
      yield* untilUpdate("idle")
      assert.deepInclude(s().update, { status: "idle", currentVersion: "0.2.0" })
      disk.updater.push({
        ...disk.updater.state,
        status: "downloading",
        availableVersion: "0.2.1",
        downloadPercent: 40
      })
      yield* untilUpdate("downloading")
      assert.deepInclude(s().update, { status: "downloading", downloadPercent: 40 })
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(disk.updater.listeners.size, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("unsaved changes", () => {
  it.effect("New map asks first while the map has unsaved edits: Cancel stays, Don't save goes on", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* startNewMapEffect
      assert.strictEqual(s().dialog, "new")
      assert.deepStrictEqual(disk.prompts, [])
      s().closeDialog()

      edit()
      s().renameLevel("Big Loop", "Isaac")
      disk.promptAnswers.push("cancel", "discard")
      yield* startNewMapEffect
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.prompts[0], {
        message: "Save the changes to Big Loop before starting a new map?",
        detail: "If you don't save, the changes are lost."
      })
      yield* startNewMapEffect
      assert.strictEqual(s().dialog, "new")
      assert.isTrue(s().dirty)
      assert.strictEqual(disk.files.size, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save writes the map's file, then goes on", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      const name = "Map_LevelEditorMain&Big Loop_Isaac.balledit"
      edit()
      const timeOfDay = lightingOf(s().doc.map.worldSettings).timeOfDay
      disk.promptAnswers.push("save")
      const steps: Array<string> = []
      yield* unlessCancelled("openMap", Effect.sync(() => void steps.push(disk.files.get(projectFile(name))!)))
      assert.isFalse(s().dirty)
      const saved = yield* MapCodec.use((codec) => codec.decode(steps[0]!))
      assert.strictEqual(saved.worldSettings.directionalLight.timeOfDay, timeOfDay)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Save names a map that has no file first; it goes on once saved, and not after Cancel", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.promptAnswers.push("save", "save")
      yield* startNewMapEffect
      assert.strictEqual(s().dialog, "saveAs")
      // the saveAs dialog's Cancel: a later save doesn't go on to the New map dialog
      s().takeAfterSave()
      s().closeDialog()
      yield* saveMapFile
      s().closeDialog()
      s().renameLevel("Fresh", "Isaac")
      yield* saveMapAsEffect
      assert.isNull(s().dialog)
      assert.isFalse(s().dirty)

      yield* reset
      edit()
      yield* startNewMapEffect
      assert.strictEqual(s().dialog, "saveAs")
      // the dialog closes itself, then saves
      s().closeDialog()
      s().renameLevel("Fresh 2", "Isaac")
      yield* saveMapAsEffect
      assert.isTrue(disk.files.has(projectFile("Map_LevelEditorMain&Fresh 2_Isaac.balledit")))
      assert.strictEqual(s().dialog, "new")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("another dialog drops what Save was going on to do", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.promptAnswers.push("save")
      yield* startNewMapEffect
      s().openDialog("settings", "general")
      assert.isNull(s().afterSave)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a held close asks, then closes; Cancel keeps the window open", () => {
    const disk = makeTestDisk()
    const left: Array<string> = []
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      assert.isFalse(holdsUnload())
      edit()
      assert.isTrue(holdsUnload())

      disk.promptAnswers.push("cancel", "save")
      yield* answerUnloadRequest("close")
      assert.deepStrictEqual(left, [])
      assert.isTrue(holdsUnload())
      yield* answerUnloadRequest("close")
      assert.deepStrictEqual(left, ["close"])
      assert.isFalse(s().dirty)
      assert.strictEqual(disk.prompts[0]?.message, "Save the changes to Big Loop before closing?")

      // closing after all: the page stops holding it, even with edits since
      edit()
      assert.isFalse(holdsUnload())
    }).pipe(Effect.provide(layerLeavingInto(disk, left)))
  })
})

describe("notification actions", () => {
  it.effect("keeps the notifications across a restart: the kept ones under this session's, then every change", () => {
    const disk = makeTestDisk()
    const kept = {
      id: "kept-1",
      kind: "mapExported",
      level: "info" as const,
      title: "Exported Big Loop to the game's maps folder",
      body: null,
      at: "2026-10-30T12:00:00.000Z",
      read: true,
      persistent: false,
      resolvedAt: null,
      actions: [{ label: "Reveal", command: { _tag: "RevealGamePath" as const, which: "mapsFolder" as const } }]
    }
    disk.notifications = [kept]
    const until = (done: () => boolean) =>
      Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1))).pipe(
        Effect.repeat({ until: done, times: 100 })
      )
    return Effect.gen(function*() {
      s().clearNotifications()
      s().notify("error", "Before the kept ones were read")
      const fiber = yield* Effect.forkChild(keepNotifications)
      yield* until(() => disk.notifications.length === 2)
      assert.deepStrictEqual(s().notifications.map((n) => n.title), [
        "Before the kept ones were read",
        kept.title
      ])
      assert.deepStrictEqual(disk.notifications, s().notifications)

      s().notify("info", "Saved Big Loop", { kind: "mapSaved" })
      yield* until(() => disk.notifications.length === 3)
      s().markNotificationsRead()
      yield* until(() => disk.notifications.every((n) => n.read))
      yield* Fiber.interrupt(fiber)
      s().clearNotifications()
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)))
      // stopped: the clear isn't written
      assert.strictEqual(disk.notifications.length, 3)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
