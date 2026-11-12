/** What the editor actions' tests share: the layers over a test disk, the store, samples and edits. */
import { Effect, Layer } from "effect"
import type { CatalogIndex } from "../domain/Catalog"
import type { Vec3 } from "../domain/coords"
import { mapLabelOf } from "../domain/factory"
import { lightingOf } from "../domain/sunlight"
import { freshMapEffect, newMapEffect } from "../editor/actions/maps"
import { spreadPlacement } from "../editor/actions/placement"
import { checkPrefabs } from "../editor/actions/prefabs"
import { saveMapAsEffect } from "../editor/actions/save"
import { hasProject, refreshProject } from "../editor/actions/shared"
import { sceneRegistry } from "../editor/sceneRegistry"
import { type DialogState, isBlankTab, useEditor } from "../editor/store"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { Platform } from "../services/Platform"
import { makeTestDisk, projectFile, testBridge, type TestDisk } from "../test/desktopBridge"
import { VIEW_DOWN } from "../test/placementView"
import { listSamples, readSample } from "../test/samples"

export const s = () => useEditor.getState()

/** What the open `saveAs` dialog goes on to do once it has saved, as its Submit takes it. */
export const afterSaveOf = (dialog: DialogState | null) => dialog?.id === "saveAs" ? dialog.afterSave : undefined

export const layerFor = (disk: TestDisk) =>
  Layer.mergeAll(
    Platform.layerDesktop(testBridge(disk)),
    MapPrefsStore.layerTest,
    MapExporter.layerNoDeps.pipe(Layer.provideMerge(MapCodec.layer))
  )

export const balledits = listSamples().filter((sample) => sample.kind === "balledit")

export const fileNameOf = (sample: { readonly name: string }) => sample.name.split("/").pop()!

/** An edit to the open map, so it has unsaved changes: the time of day moves on an hour. */
export const edit = () => {
  const lighting = lightingOf(s().doc.map.worldSettings)
  s().setLighting({ ...lighting, timeOfDay: (lighting.timeOfDay + 1) % 24 })
}

/** A clean editor over the disk's project, as the app has after its startup load: one tab, with a fresh map. */
export const reset = Effect.gen(function*() {
  useEditor.setState({ tabIds: [s().tabId], parkedTabs: new Map() })
  yield* freshMapEffect
  s().closeDialog()
  yield* refreshProject
})

/**
 * A map called `displayName` the way a user gets one: New map (the blank tab serves as the first, so tests count only
 * the maps they make), its name, and in a project its first Save. In Untitled Project it stays unsaved, with its edit.
 */
export const createNewMap = Effect.fnUntraced(function*(displayName: string, creatorName: string) {
  if (!isBlankTab(s())) yield* newMapEffect
  s().renameLevel(displayName, creatorName)
  if (hasProject()) yield* saveMapAsEffect()
})

/**
 * The Save map dialog's Submit: it takes what comes next, closes itself, names the map and saves. Its file name after.
 */
export const submitSaveMap = (displayName: string) =>
  Effect.gen(function*() {
    const afterSave = afterSaveOf(s().dialog)
    s().closeDialog()
    s().renameLevel(displayName, "Isaac")
    yield* saveMapAsEffect(afterSave)
    return s().file?.name ?? ""
  })

/** Collects what is notified, toast or inbox, for the rest of the effect. */
export const noticesWhile = <A, E, R>(body: (notices: Array<string>) => Effect.Effect<A, E, R>) =>
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

/** A sample in the project, published to the Workshop as item 3561234567 when `published`. */
export const playSample = (published = false) => {
  const sample = balledits[0]!
  const name = fileNameOf(sample)
  const text = readSample(sample)
  return {
    name,
    label: mapLabelOf(name),
    text: published ? text.replace("\"levelPublishedFileId\": -1", "\"levelPublishedFileId\": 3561234567") : text
  }
}

/** A test disk whose project holds two sample maps, and their file names. */
export const twoMaps = () => {
  const first = fileNameOf(balledits[0]!)
  const second = fileNameOf(balledits[1]!)
  const disk = makeTestDisk({
    [projectFile(first)]: readSample(balledits[0]!),
    [projectFile(second)]: readSample(balledits[1]!)
  })
  return { first, second, disk }
}

/** A test disk holding `files`, with the editor's plugin installed in the game. */
export const diskWithPlugin = (files: Record<string, string> = {}) => {
  const disk = makeTestDisk(files)
  disk.game.plugin = { ...disk.game.plugin, status: "current", installedVersion: "0.2.0" }
  return disk
}

/** Waits, in real time, until `done()`: the bridge answers with promises, and pushes run in their own fiber. */
export const untilTrue = (done: () => boolean) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1))).pipe(
    Effect.repeat({ until: done, times: 100 })
  )

/**
 * A saved map called Big Loop and the catalog, with no notifications, for the prefabs' tests: placements land at `aim`,
 * and `setUp` puts the prefabs on the disk before the tiers are looked at.
 */
export const startPrefabMap = (catalogIndex: CatalogIndex, aim: Vec3, setUp: () => void) =>
  Effect.gen(function*() {
    yield* reset
    useEditor.setState({ notifications: [], toasts: [], prefabs: [], catalogIndex })
    sceneRegistry.placementPoint = (width, height) => spreadPlacement(aim, width, VIEW_DOWN, height)
    setUp()
    yield* createNewMap("Big Loop", "Isaac")
    yield* checkPrefabs
    return s().tabId
  })
