import { assert, describe, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { setLevelData, setLevelNames } from "../../domain/edits"
import type { MapFile } from "../../domain/MapFile"
import { mapPrefsKeyOf } from "../../domain/MapPrefs"
import { type Difficulty, difficultyOf, withDifficulty } from "../../domain/mapTags"
import { MapCodec } from "../../services/MapCodec"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { makeTestDisk, projectFile, TEST_PROJECT } from "../../test/desktopBridge"
import { balledits, edit, fileNameOf, layerFor, noticesWhile, reset, s, twoMaps } from "../../test/editorActions"
import { readSample } from "../../test/samples"
import {
  followOpenMapEffect,
  freshMapEffect,
  newMapEffect,
  openProjectMapAtGap,
  openProjectMapBehind,
  openProjectMapFile,
  openStartingMap,
  patchProjectMapEffect
} from "./maps"
import { openProjectMap } from "./project"
import { refreshProject, saveTabPrefs } from "./shared"
import { followViewLayouts } from "./viewLayouts"

describe("view layouts", () => {
  const disk = () => {
    const first = fileNameOf(balledits[0]!)
    const second = fileNameOf(balledits[1]!)
    return {
      first,
      second,
      disk: makeTestDisk({
        [projectFile(first)]: readSample(balledits[0]!),
        [projectFile(second)]: readSample(balledits[1]!)
      })
    }
  }

  it.effect("a map opens on the layout it was left with, and another map on its own", () => {
    const { first, second, disk: files } = disk()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      assert.strictEqual(s().viewLayout.kind, "single")
      s().setViewLayoutKind("quad")
      s().setPaneProjection(0, "left")
      s().setPaneSplit({ x: 0.3, y: 0.6 })
      s().setPaneDisplay(1, "sky", true)
      s().togglePaneMaximised(1)
      yield* saveTabPrefs()
      const left = s().viewLayout

      yield* reset
      yield* openProjectMapFile(second)
      assert.strictEqual(s().viewLayout.kind, "single")

      yield* reset
      yield* openProjectMapFile(first)
      assert.deepStrictEqual(s().viewLayout, left)
      assert.strictEqual(s().activePane, 1)
    }).pipe(Effect.provide(layerFor(files)))
  })

  it.effect("a map back on the default layout keeps no entry for it", () => {
    const { first, disk: files } = disk()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      s().setViewLayoutKind("rows")
      yield* saveTabPrefs()
      s().setViewLayoutKind("single")
      yield* saveTabPrefs()
      const prefs = yield* MapPrefsStore.use((store) => store.load(mapPrefsKeyOf(s().doc.map)))
      assert.isUndefined(prefs.viewLayout)
    }).pipe(Effect.provide(layerFor(files)))
  })

  it("saves a changed layout once it settles, and nothing else", () => {
    vi.useFakeTimers()
    const saved: Array<string> = []
    const stop = followViewLayouts((tabId) => saved.push(tabId))
    try {
      // a map coming in brings its layout: not a change
      s().loadMap(s().doc.map, null, undefined, { viewLayout: { ...s().viewLayout, kind: "rows" } })
      vi.advanceTimersByTime(1000)
      assert.deepStrictEqual(saved, [])
      // a dragged divider writes once
      for (const x of [0.2, 0.3, 0.4]) {
        s().setPaneSplit({ x })
        vi.advanceTimersByTime(50)
      }
      assert.deepStrictEqual(saved, [])
      vi.advanceTimersByTime(1000)
      assert.deepStrictEqual(saved, [s().tabId])
      // hover moves the active pane all the time: not a change
      s().setActivePane(1)
      vi.advanceTimersByTime(1000)
      assert.strictEqual(saved.length, 1)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })
})

describe("map actions", () => {
  /** A project with the first two sample maps in it. */
  it.effect("opening a map gives it a tab of its own, or makes its tab active; an untouched fresh map gives way", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      const fresh = s().tabId
      // the fresh map the app starts on is replaced, not kept beside it
      yield* openProjectMapFile(first)
      assert.deepStrictEqual(s().tabIds, [fresh])
      assert.strictEqual(s().file?.name, first)

      edit()
      yield* openProjectMapFile(second)
      assert.strictEqual(s().tabIds.length, 2)
      assert.strictEqual(s().file?.name, second)
      // the first keeps its edits and history, and nothing was asked
      const parked = s().parkedTabs.get(fresh)
      assert.isTrue(parked?.dirty)
      assert.strictEqual(parked.past.length, 1)
      assert.deepStrictEqual(disk.prompts, [])

      // opening it again goes back to its tab, as it was left
      yield* Effect.promise(() => openProjectMap(first))
      assert.strictEqual(s().tabId, fresh)
      assert.strictEqual(s().tabIds.length, 2)
      assert.isTrue(s().dirty)
      s().undo()
      assert.isFalse(s().past.length > 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a middle click opens a map behind the active tab, which stays active, and only once", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      const active = s().tabId
      yield* openProjectMapBehind(second)
      assert.strictEqual(s().tabId, active)
      assert.strictEqual(s().file?.name, first)
      assert.strictEqual(s().tabIds.length, 2)
      assert.strictEqual(s().tabIds[0], active)
      const behind = s().tabIds[1]!
      assert.strictEqual(s().parkedTabs.get(behind)?.file?.name, second)

      yield* openProjectMapBehind(second)
      yield* openProjectMapBehind(first)
      assert.strictEqual(s().tabIds.length, 2)
      assert.strictEqual(s().tabId, active)

      s().activateTab(behind)
      assert.strictEqual(s().file?.name, second)
      assert.isFalse(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a middle click leaves an untouched fresh map where it is", () => {
    const { first, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      const fresh = s().tabId
      yield* openProjectMapBehind(first)
      assert.strictEqual(s().tabId, fresh)
      assert.strictEqual(s().tabIds.length, 2)
      assert.isNull(s().file)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a row dropped on the strip opens the map in that gap, active; an open one's tab moves there", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      const a = s().tabId
      yield* newMapEffect
      const b = s().tabId
      edit()

      yield* openProjectMapAtGap(second, 0)
      const c = s().tabId
      assert.strictEqual(s().file?.name, second)
      assert.deepStrictEqual(s().tabIds, [c, a, b])

      yield* openProjectMapAtGap(first, 3)
      assert.strictEqual(s().tabId, a)
      assert.deepStrictEqual(s().tabIds, [c, b, a])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a row dropped on the strip takes an untouched fresh map's place, and lands in the gap", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      const a = s().tabId
      yield* newMapEffect
      const fresh = s().tabId
      yield* openProjectMapAtGap(second, 0)
      assert.deepStrictEqual(s().tabIds, [fresh, a])
      assert.strictEqual(s().tabId, fresh)
      assert.strictEqual(s().file?.name, second)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("opening a map tells nothing: no notification", () => {
    const { first, disk } = twoMaps()
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        yield* reset
        yield* openProjectMapFile(first)
        assert.deepStrictEqual(notices, [])
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("starts on the map last open, else the most recently edited one, else a fresh map, and keeps the open one", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* refreshProject
      // nothing kept: the first of the list (the most recently changed)
      yield* openStartingMap
      assert.strictEqual(s().file?.name, s().projectMaps[0]?.fileName)

      // the kept map wins
      disk.project.lastOpenMap = { [TEST_PROJECT]: second }
      yield* refreshProject
      yield* openStartingMap
      assert.strictEqual(s().file?.name, second)

      // a kept map that is gone from the project is passed over
      disk.project.lastOpenMap = { [TEST_PROJECT]: "Map_LevelEditorMain&Gone_me.balledit" }
      yield* refreshProject
      yield* openStartingMap
      assert.strictEqual(s().file?.name, s().projectMaps[0]?.fileName)

      // an empty project starts on a fresh unsaved map, named Untitled with the creator in use
      disk.files.clear()
      disk.project.lastOpenMap = {}
      yield* refreshProject
      yield* openStartingMap
      assert.include(s(), { file: null, dirty: false })
      assert.strictEqual(s().doc.map.worldSettings.levelData.levelDisplayName, "Untitled")

      // what is open is kept for the next launch, from the startup load on
      disk.files.set(projectFile(first), readSample(balledits[0]!))
      disk.files.set(projectFile(second), readSample(balledits[1]!))
      disk.project.lastOpenMap = { [TEST_PROJECT]: first }
      yield* refreshProject
      yield* openStartingMap
      const stop = yield* followOpenMapEffect
      assert.strictEqual(s().file?.name, first)
      yield* openProjectMapFile(second)
      yield* Effect.yieldNow
      assert.deepStrictEqual(disk.project.lastOpenMap, { [TEST_PROJECT]: second })
      yield* freshMapEffect
      yield* Effect.yieldNow
      assert.deepStrictEqual(disk.project.lastOpenMap, {})
      stop()
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Project settings edits a map no tab has open through the save path", () => {
    const { first, second, disk } = twoMaps()
    return Effect.gen(function*() {
      yield* reset
      yield* openProjectMapFile(first)
      const before = disk.files.get(projectFile(second))
      // another map: patched on disk, the editor untouched
      const harder = (difficulty: Difficulty) => (map: MapFile) =>
        setLevelData(map, withDifficulty(map.worldSettings.levelData, difficulty))
      const saved = yield* patchProjectMapEffect(second, harder("expert"))
      assert.strictEqual(saved.fileName, second)
      assert.notStrictEqual(disk.files.get(projectFile(second)), before)
      const patched = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(second))!))
      assert.strictEqual(difficultyOf(patched.worldSettings.levelData), "expert")
      assert.strictEqual(s().file?.name, first)
      assert.isFalse(s().dirty)

      // a rename moves the file, and the old one goes to the backups
      const renamed = yield* patchProjectMapEffect(second, (map) => setLevelNames(map, "Moved", "me"))
      assert.strictEqual(renamed.fileName, "Map_LevelEditorMain&Moved_me.balledit")
      assert.isFalse(disk.files.has(projectFile(second)))
      assert.strictEqual(disk.backups[0]?.fileName, second)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
