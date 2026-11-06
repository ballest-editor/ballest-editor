import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Schema } from "effect"
import { defaultEditorState } from "../../domain/factory"
import { linkStateOf } from "../../domain/linkState"
import { MapFile } from "../../domain/MapFile"
import { useEditor } from "../../editor/store"
import { projectFile, TEST_MAPS_FOLDER, type TestDisk } from "../../test/desktopBridge"
import { diskWithPlugin, edit, layerFor, playSample, reset, s, untilTrue } from "../../test/editorActions"
import { exportToGameEffect, openInGameEffect, playEffect } from "./exportPlay"
import { replaceInGameEffect } from "./gameWrite"
import { openProjectMapFile } from "./maps"
import { saveMapFile } from "./save"
import { checkExportsEffect, followPlaySessionsEffect, keepProjectVersionEffect, takeGameVersionEffect } from "./sync"

/** The in-game editor saving `text` again: it rewrites the file, here with another time of day (the sample has one). */
const savedInGame = (text: string, timeOfDay: number) => {
  const saved = text.replace(/"timeOfDay": [-+.\deE]+/, `"timeOfDay": ${timeOfDay}`)
  assert.notStrictEqual(saved, text)
  return saved
}

describe("sync", () => {
  const { name, label, text } = playSample()
  const inGame = `${TEST_MAPS_FOLDER}/${name}`
  const stateNow = () => linkStateOf(s().projectMaps.find((m) => m.fileName === name)!, { unsaved: s().dirty })
  const reported = () => s().notifications.filter((n) => n.kind === "changedInGame" && n.title.startsWith(label))
  /** The sample, open and exported. */
  const exported = (disk: TestDisk) =>
    Effect.gen(function*() {
      yield* reset
      useEditor.setState({ notifications: [] })
      yield* openProjectMapFile(name)
      yield* exportToGameEffect
      yield* checkExportsEffect
      assert.strictEqual(stateNow(), "inSync")
      assert.lengthOf(reported(), 0)
      return disk
    })

  /** The sample exported, then edited here without saving and saved in the game: answers what the game saved. */
  const changedInBoth = (disk: TestDisk) =>
    Effect.gen(function*() {
      yield* exported(disk)
      edit()
      const saved = savedInGame(text, 3.5)
      disk.files.set(inGame, saved)
      yield* checkExportsEffect
      return saved
    })

  it.effect("brings a map saved in the in-game editor across by itself when the project has nothing to lose", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      const saved = savedInGame(text, 3.5)
      disk.files.set(inGame, saved)
      // two focuses in a row
      yield* checkExportsEffect
      yield* checkExportsEffect
      assert.lengthOf(disk.prompts, 0)
      assert.isNull(s().dialog)
      assert.strictEqual(disk.files.get(projectFile(name)), saved)
      assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 3.5)
      assert.isFalse(s().dirty)
      assert.strictEqual(stateNow(), "inSync")
      assert.deepInclude(disk.backups[0], { place: "project", fileName: name, text })
      assert.strictEqual(s().toasts.filter((t) => t.kind === "mapReimported").length, 1)
      assert.lengthOf(reported(), 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("asks about a map with unsaved edits, and Use game version keeps them in the backups", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      const saved = yield* changedInBoth(disk)
      assert.strictEqual(s().dialog?.id, "syncConflict")
      assert.deepInclude(s().dialog, { name, from: "check" })
      assert.strictEqual(stateNow(), "bothChanged")
      assert.isTrue(s().dirty)
      assert.strictEqual(disk.files.get(projectFile(name)), text)

      yield* takeGameVersionEffect
      assert.isNull(s().dialog)
      assert.lengthOf(disk.prompts, 0)
      assert.strictEqual(disk.files.get(projectFile(name)), saved)
      assert.isFalse(s().dirty)
      assert.strictEqual(stateNow(), "inSync")
      // what was unsaved, saved on the way out
      assert.notStrictEqual(disk.backups[0]?.text, text)
      assert.deepInclude(disk.backups[0], { place: "project", fileName: name })
      assert.deepInclude(disk.backups[1], { place: "project", fileName: name, text })
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Keep project version saves the edits and exports them over the game's version", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      const saved = yield* changedInBoth(disk)
      yield* keepProjectVersionEffect
      assert.isFalse(s().dirty)
      assert.strictEqual(disk.files.get(inGame), disk.files.get(projectFile(name)))
      assert.notStrictEqual(disk.files.get(inGame), saved)
      assert.deepInclude(disk.backups.find((b) => b.place === "export"), { fileName: name, text: saved })
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Cancel leaves both versions alone", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      edit()
      disk.files.set(inGame, savedInGame(text, 3.5))
      yield* checkExportsEffect
      s().closeDialog()
      yield* checkExportsEffect
      assert.isNull(s().dialog)
      assert.strictEqual(stateNow(), "bothChanged")
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("asks about a saved map not yet exported, as about unsaved edits", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      edit()
      yield* saveMapFile
      disk.files.set(inGame, savedInGame(text, 3.5))
      yield* checkExportsEffect
      assert.strictEqual(s().dialog?.id, "syncConflict")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("doesn't let the game's older copy undo an export written under it", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* reset
      useEditor.setState({ notifications: [] })
      yield* openProjectMapFile(name)
      disk.game.running = true
      yield* exportToGameEffect
      assert.strictEqual(stateNow(), "inSync")
      // the in-game editor, open since before that export, saves what it holds
      disk.files.set(inGame, savedInGame(text, 3.5))
      yield* checkExportsEffect
      assert.strictEqual(stateNow(), "changedInGame")
      assert.strictEqual(s().dialog?.id, "syncConflict")
      assert.strictEqual(disk.files.get(projectFile(name)), text)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a save of the same content needs no asking, even under a running game", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      disk.game.running = true
      yield* exportToGameEffect
      // what every save rewrites, and nothing the player did
      const saved = text.replace(/"createdAt": "[^"]*"/, "\"createdAt\": \"2026.11.06-20.12.41\"")
      assert.notStrictEqual(saved, text)
      disk.files.set(inGame, saved)
      yield* checkExportsEffect
      assert.isNull(s().dialog)
      assert.strictEqual(disk.files.get(projectFile(name)), saved)
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  describe("pivots, which every save in the game drops", () => {
    const pivot = { itemIndex: 0, pivot: { choice: "Center", localPosition: { x: 0, y: 0, z: 50 } } }
    const withPivot = JSON.stringify({
      ...JSON.parse(text),
      editorState: { ...defaultEditorState(), pivots: [pivot] }
    })
    const decodeMap = Schema.decodeUnknownSync(Schema.fromJsonString(MapFile))
    const pivotsIn = (file: string | undefined) => decodeMap(file).editorState?.pivots
    /** `saved` as the game writes it: every save there leaves `editorState` out. */
    const withoutEditorState = (saved: string) => {
      const { editorState: _dropped, ...map } = decodeMap(saved)
      return JSON.stringify(map)
    }
    const { items } = decodeMap(text)

    it.effect("come through a save in the game, into the project and back into the game's file", () => {
      const disk = diskWithPlugin({ [projectFile(name)]: withPivot })
      return Effect.gen(function*() {
        yield* exported(disk)
        disk.files.set(inGame, withoutEditorState(savedInGame(text, 3.5)))
        yield* checkExportsEffect
        assert.isNull(s().dialog)
        assert.deepStrictEqual(pivotsIn(disk.files.get(projectFile(name))), [pivot])
        assert.deepStrictEqual(pivotsIn(disk.files.get(inGame)), [pivot])
        assert.deepStrictEqual(s().doc.map.editorState?.pivots, [pivot])
        assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 3.5)
        assert.strictEqual(stateNow(), "inSync")

        // and again: the map stays in sync, so a second save in the game comes across the same way
        disk.files.set(inGame, withoutEditorState(savedInGame(text, 4.5)))
        yield* checkExportsEffect
        assert.isNull(s().dialog)
        assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 4.5)
        assert.deepStrictEqual(pivotsIn(disk.files.get(projectFile(name))), [pivot])
      }).pipe(Effect.provide(layerFor(disk)))
    })

    it.effect("ask first when one has no item left to go on", () => {
      const disk = diskWithPlugin({ [projectFile(name)]: withPivot })
      return Effect.gen(function*() {
        yield* exported(disk)
        disk.files.set(inGame, JSON.stringify({ ...JSON.parse(withoutEditorState(text)), items: items.slice(1) }))
        yield* checkExportsEffect
        assert.strictEqual(s().dialog?.id, "syncConflict")
        assert.strictEqual(disk.files.get(projectFile(name)), withPivot)
      }).pipe(Effect.provide(layerFor(disk)))
    })
  })

  it.effect("a change that doesn't read is left alone, with a notification to resolve it later", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      disk.files.set(inGame, "half written")
      yield* checkExportsEffect
      assert.strictEqual(disk.files.get(projectFile(name)), text)
      assert.deepInclude(reported()[0], {
        title: `${label} was changed in the game`,
        actions: [
          { label: "Resolve", command: { _tag: "ResolveConflict", fileName: name } },
          { label: "Ignore", command: { _tag: "Dismiss" } }
        ]
      })
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Export over a changed export asks: Keep project version backs the game's up, Use game version takes it", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      const saved = savedInGame(text, 4)
      disk.files.set(inGame, saved)
      yield* exportToGameEffect
      assert.deepInclude(s().dialog, { id: "syncConflict", name, from: "export", replacePublished: false })
      assert.strictEqual(disk.files.get(inGame), saved)
      // the dialog showed the change: the next focus doesn't report it again
      s().closeDialog()
      yield* checkExportsEffect
      assert.lengthOf(reported(), 0)

      yield* exportToGameEffect
      yield* keepProjectVersionEffect
      assert.isNull(s().dialog)
      assert.strictEqual(disk.files.get(inGame), text)
      assert.deepInclude(disk.backups[0], { place: "export", fileName: name, text: saved })
      assert.strictEqual(stateNow(), "inSync")

      const again = savedInGame(text, 5)
      disk.files.set(inGame, again)
      yield* exportToGameEffect
      yield* takeGameVersionEffect
      assert.strictEqual(disk.files.get(projectFile(name)), again)
      assert.strictEqual(disk.files.get(inGame), again)
      assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 5)
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Play and Open in game over a changed export ask the same, then go on", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      disk.files.set(inGame, savedInGame(text, 6))
      yield* playEffect
      assert.deepInclude(s().dialog, { id: "syncConflict", name, from: "play", replacePublished: false })
      assert.deepStrictEqual(disk.game.races, [])
      yield* keepProjectVersionEffect
      assert.deepStrictEqual(disk.game.races, [name])
      assert.strictEqual(disk.files.get(inGame), text)

      disk.files.set(inGame, savedInGame(text, 7))
      yield* openInGameEffect
      assert.deepInclude(s().dialog, { id: "syncConflict", name, from: "edit" })
      assert.deepStrictEqual(disk.game.opens, [])
      yield* keepProjectVersionEffect
      assert.deepStrictEqual(disk.game.opens, [name])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open in game becomes Update in game, and asks before replacing changed pieces in the game", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      s().setOpenedInGame(null)
      disk.game.running = true
      yield* openInGameEffect
      assert.strictEqual(s().openedInGame, name)
      assert.match(s().toasts[0]?.title ?? "", /^Opened /)
      assert.deepStrictEqual(disk.game.opens, [name])

      // the player moved a piece in the game: the plugin refuses, and the dialog asks
      disk.game.editOutcome = "unsaved"
      disk.game.inGame = label
      yield* openInGameEffect
      assert.deepInclude(s().dialog, { id: "replaceInGame", name, inGame: label })
      assert.deepStrictEqual(disk.game.opens, [name])
      s().closeDialog()
      assert.deepStrictEqual(disk.game.opens, [name])

      yield* openInGameEffect
      yield* replaceInGameEffect
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.game.opens, [name, name])
      assert.match(s().toasts[0]?.title ?? "", /^Updated /)

      // the game closed: nothing is open there any more
      disk.game.editOutcome = "opened"
      disk.playSessions.push({ fileName: name })
      const fiber = yield* Effect.forkChild(followPlaySessionsEffect)
      yield* untilTrue(() => disk.playSessions.listeners.size > 0)
      disk.playSessions.push({ fileName: name })
      yield* untilTrue(() => s().openedInGame === null)
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("asks for the update an old plugin needs", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      disk.game.running = true
      disk.game.plugin = { ...disk.game.plugin, status: "outdated", installedVersion: "0.1.0" }
      yield* openInGameEffect
      assert.deepStrictEqual(disk.game.opens, [])
      const update = s().notifications.find((n) => n.kind === "pluginUpdate")
      assert.deepInclude(update?.actions[0], { label: "Update plugin" })
      // the press itself answers, not only the bell
      assert.strictEqual(
        s().toasts[0]?.title,
        `Can't open ${label} in the in-game editor: update the editor's plugin to 0.2.0 first`
      )

      disk.game.plugin = { ...disk.game.plugin, hostTooOld: true, hostVersion: "0.33.2" }
      yield* openInGameEffect
      assert.match(s().notifications.find((n) => n.kind === "pluginUpdate")?.title ?? "", /Update the plugin manager/)
      assert.match(s().toasts[0]?.title ?? "", /: needs plugin manager 0\.34\.0 \(the game has 0\.33\.2\)$/)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("the end of a Play's game session checks; a check asked for while one runs joins it", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      const fiber = yield* Effect.forkChild(followPlaySessionsEffect)
      yield* untilTrue(() => disk.playSessions.listeners.size > 0)
      disk.files.set(inGame, savedInGame(text, 8))
      const before = disk.exportChecks
      disk.playSessions.push({ fileName: name })
      yield* untilTrue(() => s().doc.map.worldSettings.directionalLight.timeOfDay === 8)
      assert.strictEqual(disk.exportChecks, before + 1)
      assert.strictEqual(stateNow(), "inSync")
      yield* Fiber.interrupt(fiber)

      // the window's focus and the session's end at once: one look
      disk.files.set(inGame, savedInGame(text, 9))
      yield* Effect.all([checkExportsEffect, checkExportsEffect], { concurrency: "unbounded" })
      assert.strictEqual(disk.exportChecks, before + 2)
      assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 9)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("an export deleted in the game shows the map as not exported, without a notification", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      disk.files.delete(inGame)
      yield* checkExportsEffect
      assert.strictEqual(stateNow(), "notExported")
      assert.lengthOf(reported(), 0)
      // the next Export writes it again, asking nothing
      yield* exportToGameEffect
      assert.strictEqual(disk.files.get(inGame), text)
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
