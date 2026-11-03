import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { lightingOf } from "../../domain/sunlight"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { makeTestDisk, projectFile, type TestDisk } from "../../test/desktopBridge"
import { afterSaveOf, edit, layerFor, reset, s } from "../../test/editorActions"
import { createNewMap } from "./maps"
import { saveMapAsEffect, saveMapFile } from "./save"
import { answerUnloadRequest, holdsUnload, startNewMapEffect, unlessCancelled } from "./unsaved"

/** `layerFor`, with the page's close and reload recorded in `left` instead of done. */
const layerLeavingInto = (disk: TestDisk, left: Array<string>) =>
  Layer.effect(
    Platform,
    Effect.gen(function*() {
      const platform = yield* Platform
      return Platform.of({ ...platform, leave: (kind) => Effect.sync(() => void left.push(kind)) })
    })
  ).pipe(Layer.provideMerge(layerFor(disk)))

describe("unsaved changes", () => {
  it.effect("New map asks first while the map has unsaved edits: Cancel stays, Don't save goes on", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* startNewMapEffect
      assert.strictEqual(s().dialog?.id, "new")
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
      assert.strictEqual(s().dialog?.id, "new")
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
      assert.strictEqual(s().dialog?.id, "saveAs")
      // the saveAs dialog's Cancel: a later save doesn't go on to the New map dialog
      s().closeDialog()
      yield* saveMapFile
      const later = afterSaveOf(s().dialog)
      s().closeDialog()
      s().renameLevel("Fresh", "Isaac")
      yield* saveMapAsEffect(later)
      assert.isNull(s().dialog)
      assert.isFalse(s().dirty)

      yield* reset
      edit()
      yield* startNewMapEffect
      // the dialog takes what comes next and closes itself, then saves
      const next = afterSaveOf(s().dialog)
      assert.isDefined(next)
      s().closeDialog()
      s().renameLevel("Fresh 2", "Isaac")
      yield* saveMapAsEffect(next)
      assert.isTrue(disk.files.has(projectFile("Map_LevelEditorMain&Fresh 2_Isaac.balledit")))
      assert.strictEqual(s().dialog?.id, "new")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("another dialog drops what Save was going on to do", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.promptAnswers.push("save")
      yield* startNewMapEffect
      assert.isDefined(afterSaveOf(s().dialog))
      s().openDialog({ id: "settings", category: "general" })
      assert.isUndefined(afterSaveOf(s().dialog))
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
