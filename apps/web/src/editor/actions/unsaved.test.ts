import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { lightingOf } from "../../domain/sunlight"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { makeTestDisk, projectFile, type TestDisk } from "../../test/desktopBridge"
import { afterSaveOf, edit, layerFor, reset, s } from "../../test/editorActions"
import { dirtyTabs } from "../store"
import { createNewMap } from "./maps"
import { saveMapAsEffect, saveMapFile } from "./save"
import { answerUnloadRequest, closeTabEffect, holdsUnload, startNewMap, unlessCancelled } from "./unsaved"

/** `layerFor`, with the page's close and reload recorded in `left` instead of done. */
const layerLeavingInto = (disk: TestDisk, left: Array<string>) =>
  Layer.effect(
    Platform,
    Effect.gen(function*() {
      const platform = yield* Platform
      return Platform.of({ ...platform, leave: (kind) => Effect.sync(() => void left.push(kind)) })
    })
  ).pipe(Layer.provideMerge(layerFor(disk)))

/** What the prompt guards in these tests: the New map dialog, once the open map's edits are dealt with. */
const startNewMapEffect = unlessCancelled("closeTab", Effect.sync(startNewMap))

describe("unsaved changes", () => {
  it.effect("New map asks nothing: the new map opens in a tab of its own and the edited one stays", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      s().renameLevel("Big Loop", "Isaac")
      startNewMap()
      assert.strictEqual(s().dialog?.id, "new")
      s().closeDialog()
      yield* createNewMap("Second", "Isaac")
      assert.deepStrictEqual(disk.prompts, [])
      assert.strictEqual(s().tabIds.length, 2)
      assert.strictEqual(s().file?.name, "Map_LevelEditorMain&Second_Isaac.balledit")
      const [first] = s().tabIds
      assert.isTrue(s().parkedTabs.get(first!)?.dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("closing a tab asks first while its map has unsaved edits: Cancel stays, Don't save closes it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      yield* createNewMap("Second", "Isaac")
      const first = s().tabIds[0]!
      const second = s().tabIds[1]!
      s().activateTab(first)
      edit()
      // closing it from the other tab makes it the active one to ask
      s().activateTab(second)
      disk.promptAnswers.push("cancel", "discard")
      yield* closeTabEffect(first)
      assert.deepStrictEqual(s().tabIds, [first, second])
      assert.strictEqual(s().tabId, first)
      assert.deepStrictEqual(disk.prompts[0], {
        message: "Save the changes to Big Loop before closing it?",
        detail: "If you don't save, the changes are lost."
      })
      yield* closeTabEffect(first)
      assert.deepStrictEqual(s().tabIds, [second])
      assert.strictEqual(s().file?.name, "Map_LevelEditorMain&Second_Isaac.balledit")

      // a clean tab closes without asking; the last one leaves a fresh map
      yield* closeTabEffect(second)
      assert.strictEqual(disk.prompts.length, 2)
      assert.strictEqual(s().tabIds.length, 1)
      assert.include(s(), { file: null, dirty: false })
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
      yield* unlessCancelled("closeTab", Effect.sync(() => void steps.push(disk.files.get(projectFile(name))!)))
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

  it.effect("a held close asks about every tab with unsaved edits, in turn; Cancel stops there", () => {
    const disk = makeTestDisk()
    const left: Array<string> = []
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      yield* createNewMap("Clean", "Isaac")
      yield* createNewMap("Second", "Isaac")
      edit()
      const first = s().tabIds[0]!
      const third = s().tabIds[2]!
      // a map with unsaved edits in a tab that isn't active counts too
      s().activateTab(s().tabIds[1]!)
      assert.deepStrictEqual(dirtyTabs(s()), [first, third])

      disk.promptAnswers.push("discard", "cancel")
      yield* answerUnloadRequest("close")
      assert.deepStrictEqual(left, [])
      assert.deepStrictEqual(disk.prompts.map((p) => p.message), [
        "Save the changes to Big Loop before closing?",
        "Save the changes to Second before closing?"
      ])
      // Cancel leaves the tab it asked about active
      assert.strictEqual(s().tabId, third)

      disk.promptAnswers.push("save", "discard")
      yield* answerUnloadRequest("close")
      assert.deepStrictEqual(left, ["close"])
      assert.isFalse(s().parkedTabs.get(first)?.dirty)
    }).pipe(Effect.provide(layerLeavingInto(disk, left)))
  })
})
