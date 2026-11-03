import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { linkStateOf } from "../../domain/linkState"
import { useEditor } from "../../editor/store"
import { projectFile, TEST_MAPS_FOLDER, type TestDisk } from "../../test/desktopBridge"
import { diskWithPlugin, edit, layerFor, playSample, reset, s, untilTrue } from "../../test/editorActions"
import { exportToGameEffect, playEffect } from "./exportPlay"
import { overwriteChangedEffect } from "./gameWrite"
import { openProjectMapFile } from "./maps"
import { checkExportsEffect, followPlaySessionsEffect, reimportFirstEffect, reimportMapEffect } from "./sync"

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

  it.effect("reports a map saved in the in-game editor once, and Re-import loads the game's version", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      const saved = savedInGame(text, 3.5)
      disk.files.set(inGame, saved)
      // two focuses in a row
      yield* checkExportsEffect
      yield* checkExportsEffect
      assert.lengthOf(reported(), 1)
      assert.deepInclude(reported()[0], {
        title: `${label} was changed in the game`,
        actions: [
          { label: "Re-import", command: { _tag: "ReimportMap", fileName: name } },
          { label: "Ignore", command: { _tag: "Dismiss" } }
        ]
      })
      assert.strictEqual(stateNow(), "changedInGame")
      edit()
      assert.strictEqual(stateNow(), "bothChanged")

      // Re-import asks about the unsaved edits first; Don't save drops them
      disk.promptAnswers.push("discard")
      yield* reimportMapEffect(name)
      assert.match(disk.prompts[0]?.message ?? "", /before re-importing it from the game\?$/)
      assert.strictEqual(disk.files.get(projectFile(name)), saved)
      assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 3.5)
      assert.isFalse(s().dirty)
      assert.strictEqual(stateNow(), "inSync")
      assert.deepInclude(disk.backups[0], { place: "project", fileName: name, text })
      assert.strictEqual(s().notifications[0]?.kind, "mapReimported")
      yield* checkExportsEffect
      assert.lengthOf(reported(), 1)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Export over a changed export asks: Back up and overwrite keeps the game's version, Re-import first takes it", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      const saved = savedInGame(text, 4)
      disk.files.set(inGame, saved)
      yield* exportToGameEffect
      assert.deepStrictEqual(s().dialog, { id: "overwriteChanged", name, from: "export", replacePublished: false })
      assert.strictEqual(disk.files.get(inGame), saved)
      // the dialog showed the change: the next focus doesn't report it again
      yield* checkExportsEffect
      assert.lengthOf(reported(), 0)

      yield* overwriteChangedEffect
      assert.isNull(s().dialog)
      assert.strictEqual(disk.files.get(inGame), text)
      assert.deepInclude(disk.backups[0], { place: "export", fileName: name, text: saved })
      assert.strictEqual(stateNow(), "inSync")

      const again = savedInGame(text, 5)
      disk.files.set(inGame, again)
      yield* exportToGameEffect
      yield* reimportFirstEffect
      assert.strictEqual(disk.files.get(projectFile(name)), again)
      assert.strictEqual(disk.files.get(inGame), again)
      assert.strictEqual(s().doc.map.worldSettings.directionalLight.timeOfDay, 5)
      assert.strictEqual(stateNow(), "inSync")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Play over a changed export asks the same, then goes on with Play", () => {
    const disk = diskWithPlugin({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* exported(disk)
      disk.files.set(inGame, savedInGame(text, 6))
      yield* playEffect
      assert.deepStrictEqual(s().dialog, { id: "overwriteChanged", name, from: "play", replacePublished: false })
      assert.deepStrictEqual(disk.game.races, [])
      yield* overwriteChangedEffect
      assert.deepStrictEqual(disk.game.races, [name])
      assert.strictEqual(disk.files.get(inGame), text)
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
      disk.playSessions.push({ fileName: name, endedAt: "2026-10-31T12:00:00.000Z" })
      yield* untilTrue(() => reported().length > 0)
      assert.strictEqual(disk.exportChecks, before + 1)
      assert.strictEqual(stateNow(), "changedInGame")
      yield* Fiber.interrupt(fiber)

      // the window's focus and the session's end at once: one look
      disk.files.set(inGame, savedInGame(text, 9))
      yield* Effect.all([checkExportsEffect, checkExportsEffect], { concurrency: "unbounded" })
      assert.strictEqual(disk.exportChecks, before + 2)
      assert.lengthOf(reported(), 2)
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
