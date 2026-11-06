import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { lightingOf } from "../../domain/sunlight"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { makeTestDisk, projectFile, type TestDisk } from "../../test/desktopBridge"
import { afterSaveOf, balledits, createNewMap, edit, fileNameOf, layerFor, reset, s } from "../../test/editorActions"
import { readSample } from "../../test/samples"
import { dirtyTabs, isBlankTab, isUnsavedTab, noTabOpen, tabLabelOf } from "../store"
import { newMapEffect, openProjectMapFile } from "./maps"
import { saveMapAsEffect, saveMapFile } from "./save"
import { answerUnloadRequest, closeTabEffect, holdsUnload, unlessCancelled } from "./unsaved"

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
const thenNewProjectDialog = unlessCancelled("closeTab", Effect.sync(() => s().openDialog({ id: "newProject" })))

describe("a map nobody has edited", () => {
  it.effect("a new map is clean: nothing shows it as unsaved and nothing holds the window", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      assert.isFalse(s().dirty)
      assert.isFalse(isUnsavedTab(s()))
      assert.isTrue(isBlankTab(s()))
      assert.deepStrictEqual(dirtyTabs(s()), [])
      assert.isFalse(holdsUnload())
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("selecting isn't an edit; the first edit dirties it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      s().select([s().doc.ids[0]!])
      assert.isFalse(s().dirty)
      assert.isFalse(isUnsavedTab(s()))
      assert.isTrue(isBlankTab(s()))

      edit()
      assert.isTrue(s().dirty)
      assert.isTrue(isUnsavedTab(s()))
      assert.isFalse(isBlankTab(s()))
      assert.isTrue(holdsUnload())
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("closing Untitled Project's last tab leaves a clean Untitled, and that closes without asking", () => {
    const disk = makeTestDisk()
    disk.project.current = null
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.promptAnswers.push("discard")
      yield* closeTabEffect(s().tabId)
      assert.lengthOf(disk.prompts, 1)
      assert.lengthOf(s().tabIds, 1)
      assert.strictEqual(tabLabelOf(s()), "Untitled")
      assert.isFalse(s().dirty)
      assert.isFalse(isUnsavedTab(s()))

      yield* closeTabEffect(s().tabId)
      assert.lengthOf(disk.prompts, 1)
      assert.isFalse(isUnsavedTab(s()))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a saved map opened over it takes its place without asking; an edited one keeps its tab", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const disk = makeTestDisk({ [projectFile(name)]: readSample(sample) })
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(name)
      assert.deepStrictEqual(disk.prompts, [])
      assert.lengthOf(s().tabIds, 1)
      assert.strictEqual(s().file?.name, name)

      yield* reset
      edit()
      yield* openProjectMapFile(name)
      assert.deepStrictEqual(disk.prompts, [])
      assert.lengthOf(s().tabIds, 2)
      assert.deepStrictEqual(dirtyTabs(s()), [s().tabIds[0]!])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("unsaved changes", () => {
  it.effect("New map asks nothing: the new map opens in a tab of its own and the edited one stays", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      s().renameLevel("Big Loop", "Isaac")
      yield* newMapEffect
      assert.isNull(s().dialog)
      s().renameLevel("Second", "Isaac")
      yield* saveMapAsEffect()
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

      // a clean tab closes without asking; the last one leaves the project overview
      yield* closeTabEffect(second)
      assert.strictEqual(disk.prompts.length, 2)
      assert.isTrue(noTabOpen(s()))
      assert.include(s(), { file: null, dirty: false })
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("asks about the last tab before leaving the project overview, and a Cancel keeps it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      disk.promptAnswers.push("cancel", "discard")
      yield* closeTabEffect(s().tabId)
      assert.isFalse(noTabOpen(s()))
      yield* closeTabEffect(s().tabId)
      assert.isTrue(noTabOpen(s()))
      assert.isFalse(holdsUnload())
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("the overview's maps open in the first tab, and a blank tab's close goes there too", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      const fileName = s().file?.name ?? ""
      yield* closeTabEffect(s().tabId)
      yield* openProjectMapFile(fileName)
      assert.lengthOf(s().tabIds, 1)
      assert.strictEqual(s().file?.name, fileName)

      yield* closeTabEffect(s().tabId)
      yield* newMapEffect
      assert.lengthOf(s().tabIds, 1)
      assert.isTrue(isBlankTab(s()))
      yield* closeTabEffect(s().tabId)
      assert.isTrue(noTabOpen(s()))
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
      yield* thenNewProjectDialog
      assert.strictEqual(s().dialog?.id, "saveAs")
      // the saveAs dialog's Cancel: a later save doesn't go on to what was next
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
      yield* thenNewProjectDialog
      // the dialog takes what comes next and closes itself, then saves
      const next = afterSaveOf(s().dialog)
      assert.isDefined(next)
      s().closeDialog()
      s().renameLevel("Fresh 2", "Isaac")
      yield* saveMapAsEffect(next)
      assert.isTrue(disk.files.has(projectFile("Map_LevelEditorMain&Fresh 2_Isaac.balledit")))
      assert.strictEqual(s().dialog?.id, "newProject")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("another dialog drops what Save was going on to do", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.promptAnswers.push("save")
      yield* thenNewProjectDialog
      assert.isDefined(afterSaveOf(s().dialog))
      s().openDialog({ id: "gameLink" })
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
