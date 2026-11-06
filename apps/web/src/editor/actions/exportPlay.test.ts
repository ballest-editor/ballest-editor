import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { PLUGIN_MANAGER_MISSING, PLUGIN_MISSING } from "../../domain/gameLink"
import { linkStateOf } from "../../domain/linkState"
import { lightingOf } from "../../domain/sunlight"
import { useEditor } from "../../editor/store"
import { MapCodec } from "../../services/MapCodec"
import { makeTestDisk, projectFile, TEST_MAPS_FOLDER, testHash } from "../../test/desktopBridge"
import {
  afterSaveOf,
  balledits,
  diskWithPlugin,
  edit,
  fileNameOf,
  layerFor,
  noticesWhile,
  playSample,
  reset,
  s,
  submitSaveMap
} from "../../test/editorActions"
import { readSample } from "../../test/samples"
import { exportToGameEffect, playEffect } from "./exportPlay"
import { installPluginEffect } from "./gameLink"
import { replacePublishedDraftEffect } from "./gameWrite"
import { openProjectMapFile } from "./maps"
import { duplicateMapEffect, saveMapFile } from "./save"

describe("Export to game", () => {
  it.effect("won't send the game an imported file it would refuse, though nothing went through Save", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const text = readSample(sample).replace(/"w": 1\b/, "\"w\": 2")
    assert.notStrictEqual(text, readSample(sample))
    const disk = makeTestDisk({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      assert.isFalse(s().dirty)
      const failed = yield* Effect.flip(exportToGameEffect)
      assert.match(String(failed), /non-normalized rotation/)
      assert.isFalse(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))
      const played = yield* Effect.flip(playEffect)
      assert.match(String(played), /non-normalized rotation/)
      assert.isFalse(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))
    }).pipe(Effect.provide(layerFor(disk)))
  })

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
      yield* exportToGameEffect
      assert.isFalse(s().dirty)
      assert.deepStrictEqual(s().dialog, { id: "replacePublished", name, publishedFileId: 3561234567, from: "export" })
      assert.strictEqual(disk.files.get(inGame), published)

      yield* replacePublishedDraftEffect
      assert.isNull(s().dialog)
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
      yield* exportToGameEffect
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
      yield* exportToGameEffect
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("Play", () => {
  it.effect("saves unsaved edits, exports the map and has the plugin race it, starting the game first if need be", () => {
    const { name, label, text } = playSample()
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        yield* reset
        yield* openProjectMapFile(name)
        edit()
        yield* playEffect
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
        yield* playEffect
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
      yield* playEffect
      assert.deepStrictEqual(disk.game.races, [])
      assert.strictEqual(disk.game.launches, 1)
      assert.isTrue(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))
      const [notice] = pinned()
      assert.strictEqual(notice?.kind, PLUGIN_MISSING)
      assert.include(notice?.title, `Exported ${label} and started the game`)
      assert.deepStrictEqual(notice?.actions.map((a) => a.command._tag), ["InstallPlugin"])
      // Again: the same notification, updated, not a second one.
      disk.game.running = true
      yield* playEffect
      assert.lengthOf(pinned(), 1)

      // Installing the plugin resolves it.
      s().setPluginStatus(disk.game.plugin)
      yield* installPluginEffect
      assert.lengthOf(pinned(), 0)

      // Without the plugin manager it is the Game link's own notice, with the install steps.
      disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager" }
      yield* playEffect
      assert.deepStrictEqual(pinned().map((n) => [n.kind, n.title, n.actions.map((a) => a.command._tag)]), [
        [
          PLUGIN_MANAGER_MISSING,
          `Exported ${label}. Play needs the Ballest plugin manager to race it`,
          ["OpenExternal"]
        ]
      ])

      // A Play that reaches the plugin resolves what was pinned.
      disk.game.plugin = { ...disk.game.plugin, status: "current", installedVersion: "0.2.0" }
      yield* playEffect
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
      yield* playEffect
      assert.deepStrictEqual(s().dialog, { id: "replacePublished", name, publishedFileId: 3561234567, from: "play" })
      assert.strictEqual(disk.files.get(inGame), draft)
      assert.deepStrictEqual(disk.game.races, [])

      yield* replacePublishedDraftEffect
      assert.isNull(s().dialog)
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
      yield* playEffect
      assert.strictEqual(s().dialog?.id, "newDraft")
      assert.isFalse(disk.files.has(`${TEST_MAPS_FOLDER}/${name}`))
      s().closeDialog()

      // The dialog's Save and play.
      const { creatorName } = s().doc.map.worldSettings.levelData
      yield* duplicateMapEffect("Draft of it", creatorName, false, true)
      yield* playEffect
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
      yield* playEffect
      assert.isDefined(afterSaveOf(s().dialog))
      assert.deepStrictEqual(disk.game.races, [])

      // Play goes on with the file the Save map dialog wrote
      const saved = yield* submitSaveMap("Big Loop")
      assert.isTrue(disk.files.has(projectFile(saved)))
      assert.deepStrictEqual(disk.game.races, [saved])
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Export of a map with no file yet names it first, then exports what was saved", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* exportToGameEffect
      assert.isDefined(afterSaveOf(s().dialog))
      const saved = yield* submitSaveMap("Big Loop")
      assert.isTrue(disk.files.has(projectFile(saved)))
      assert.strictEqual(disk.files.get(`${TEST_MAPS_FOLDER}/${saved}`), disk.files.get(projectFile(saved)))
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
