/** What the editor actions' tests share: the layers over a test disk, the store, samples and edits. */
import { DateTime, Effect, Layer } from "effect"
import { lightingOf } from "../domain/sunlight"
import { refreshProject } from "../editor/actions/shared"
import { useEditor } from "../editor/store"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { Platform } from "../services/Platform"
import { makeTestDisk, testBridge, type TestDisk } from "../test/desktopBridge"
import { listSamples, readSample } from "../test/samples"

export const s = () => useEditor.getState()

export const layerFor = (disk: TestDisk) =>
  Layer.mergeAll(
    Platform.layerDesktop(testBridge(disk)),
    MapPrefsStore.layerTest,
    MapExporter.layerNoDeps.pipe(Layer.provideMerge(Layer.mergeAll(MapCodec.layer, DateTime.layerCurrentZoneOffset(0))))
  )

export const balledits = listSamples().filter((sample) => sample.kind === "balledit")

export const fileNameOf = (sample: { readonly name: string }) => sample.name.split("/").pop()!

/** An edit to the open map, so it has unsaved changes: the time of day moves on an hour. */
export const edit = () => {
  const lighting = lightingOf(s().doc.map.worldSettings)
  s().setLighting({ ...lighting, timeOfDay: (lighting.timeOfDay + 1) % 24 })
}

/** A clean editor over the disk's project, as the app has after its startup load. */
export const reset = Effect.gen(function*() {
  s().loadMap(s().doc.map, null)
  s().setImportClash(null)
  s().setPublishedDraft(null)
  s().setChangedExport(null)
  s().closeDialog()
  yield* refreshProject
})

/** Collects what the store would toast, for the rest of the effect. */
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
    label: name.replace(/^Map_LevelEditorMain&/, "").replace(/\.balledit$/, ""),
    text: published ? text.replace("\"levelPublishedFileId\": -1", "\"levelPublishedFileId\": 3561234567") : text
  }
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
