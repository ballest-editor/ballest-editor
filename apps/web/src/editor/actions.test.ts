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
  createNewMap,
  duplicateMapEffect,
  exportToGameEffect,
  findCreatorEffect,
  followUpdateState,
  importAsCopyEffect,
  importMapFile,
  installPluginEffect,
  launchGameEffect,
  openProjectMapFile,
  replaceOnImportEffect,
  saveMapAsEffect,
  saveMapFile
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
