import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { creatorOf } from "../domain/creator"
import { defaultSettings } from "../domain/Settings"
import { lightingOf } from "../domain/sunlight"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { Platform } from "../services/Platform"
import {
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
  launchGameEffect,
  openProjectMapFile,
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
      assert.deepStrictEqual(s().publishedDraft, { name, publishedFileId: 3561234567 })
      assert.strictEqual(s().dialog, "replacePublished")
      assert.strictEqual(disk.files.get(inGame), published)

      s().setPublishedDraft(null)
      yield* exportToGameEffect(true)
      assert.strictEqual(disk.files.get(inGame), disk.files.get(projectFile(name)))
      const exported = yield* MapCodec.use((codec) => codec.decode(disk.files.get(inGame)!))
      assert.strictEqual(exported.worldSettings.directionalLight.timeOfDay, 5)
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
