import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { Catalog, indexCatalog } from "../../domain/Catalog"
import { placementTransform } from "../../domain/factory"
import { RECOVERY_MAP_HASH } from "../../domain/recovery"
import { sidecarOf, structureOfMap } from "../../domain/sidecar"
import { MapCodec } from "../../services/MapCodec"
import { Platform, PlatformError } from "../../services/Platform"
import {
  makeTestDisk,
  projectFile,
  projectPrefabFile,
  TEST_PROJECT,
  type TestDisk,
  userPrefabFile
} from "../../test/desktopBridge"
import {
  balledits,
  createNewMap,
  edit,
  fileNameOf,
  layerFor,
  noticesWhile,
  reset,
  s,
  untilTrue
} from "../../test/editorActions"
import { PREFAB_TEXT } from "../../test/prefabs"
import { listSamples, readSample, repoRoot } from "../../test/samples"
import { isUnsavedTab, tabLabelOf, tabStateOf, useEditor } from "../store"
import { newMapEffect, openProjectMapFile } from "./maps"
import { checkPrefabs, newPrefabEffect, openPrefabEffect, saveNewPrefabEffect } from "./prefabs"
import { switchProjectEffect } from "./project"
import { discardUnsavedEffect, offerRecovery, restoreUnsavedEffect } from "./recovery"
import { followRecovery, syncRecovery } from "./recoverySnapshots"
import { saveMapFile } from "./save"
import { answerUnloadRequest, closeTabEffect } from "./unsaved"

const catalog = Schema.decodeUnknownSync(Catalog)(
  JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "catalog.json"), "utf8"))
)
const USER = { tier: "user", name: "Bridge" } as const
const MAP = "Map_LevelEditorMain&Big Loop_Isaac.balledit"

/** `layerFor`, with the page's close and reload left undone. */
const layerStaying = (disk: TestDisk) =>
  Layer.effect(
    Platform,
    Effect.gen(function*() {
      return Platform.of({ ...(yield* Platform), leave: () => Effect.void })
    })
  ).pipe(Layer.provideMerge(layerFor(disk)))

type Services = Layer.Success<ReturnType<typeof layerFor>>

/**
 * A session over a disk with a catalog and the Bridge prefab. `crash` ends it the way a killed window does, leaving its
 * snapshots on disk, and starts the next one on the same disk.
 */
const inSession = (
  body: (disk: TestDisk, crash: Effect.Effect<void, unknown, Services>) => Effect.Effect<void, unknown, Services>
) => {
  const disk = makeTestDisk()
  disk.files.set(userPrefabFile("Bridge"), PREFAB_TEXT)
  const started = Effect.gen(function*() {
    yield* reset
    useEditor.setState({ notifications: [], toasts: [], prefabs: [], catalogIndex: indexCatalog(catalog) })
    s().setCapabilities((yield* Platform).capabilities)
    yield* checkPrefabs
  })
  return Effect.gen(function*() {
    yield* started
    let stop = yield* followRecovery
    const crash = Effect.gen(function*() {
      stop()
      yield* started
      stop = yield* followRecovery
    })
    yield* body(disk, crash).pipe(Effect.ensuring(Effect.sync(() => stop())))
  }).pipe(Effect.provide(layerStaying(disk)))
}

const offered = () => {
  const { dialog } = s()
  return dialog?.id === "recoverUnsaved" ? dialog.tabs.map(({ snapshot }) => snapshot.label) : []
}

/** Moves the item at `index` by `by` along X: an edit that changes a transform. */
const moveItem = (index: number, by: number) => {
  const key = s().doc.ids[index]!
  const t = s().doc.map.items[index]!.itemTransform
  s().transformItems(new Map([[key, { ...t, translation: { ...t.translation, x: t.translation.x + by } }]]))
}

describe("a snapshot's text", () => {
  it.effect("holds every sample map as it was", () =>
    Effect.gen(function*() {
      const codec = yield* MapCodec
      for (const sample of listSamples()) {
        const map = yield* codec.decode(readSample(sample))
        const { ids, structure } = structureOfMap(map)
        const text = yield* codec.encodeRecovery({
          formatVersion: 1,
          editedAt: "2026-11-06T17:00:00.000Z",
          project: null,
          label: sample.name,
          file: null,
          fresh: false,
          backup: false,
          map,
          sidecar: sidecarOf(map, ids, structure, RECOVERY_MAP_HASH),
          prefab: null
        })
        const decoded = yield* codec.decodeRecovery(text)
        assert.strictEqual(JSON.stringify(decoded.map), JSON.stringify(map), sample.name)
      }
    }).pipe(Effect.provide(MapCodec.layer)))
})

describe("what a crash leaves", () => {
  it.effect("a saved map's edits come back with its groups and names, and Save writes them over its file", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        const fileName = fileNameOf(balledits[0]!)
        disk.files.set(projectFile(fileName), readSample(balledits[0]!))
        yield* openProjectMapFile(fileName)
        const keys = s().doc.ids.slice(0, 2)
        s().groupItems(keys, "Kept together")
        moveItem(0, 123)
        const { ids, map, structure } = s().doc
        yield* syncRecovery

        yield* crash
        assert.isFalse(s().dirty)
        yield* offerRecovery
        assert.lengthOf(offered(), 1)
        yield* restoreUnsavedEffect

        assert.isNull(s().dialog)
        assert.strictEqual(JSON.stringify(s().doc.map), JSON.stringify(map))
        assert.deepStrictEqual(s().doc.ids, ids)
        assert.deepStrictEqual(s().doc.structure.tree, structure.tree)
        assert.isTrue(s().dirty)
        assert.strictEqual(s().file?.name, fileName)

        const before = disk.files.get(projectFile(fileName))
        yield* saveMapFile
        assert.notStrictEqual(disk.files.get(projectFile(fileName)), before)
        assert.isFalse(s().dirty)
      })
    ))

  it.effect("the old snapshot goes only once the restored tab has its own", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        const [left] = disk.recovery.keys()

        yield* crash
        yield* offerRecovery
        yield* restoreUnsavedEffect
        assert.deepStrictEqual(offered(), [])
        assert.lengthOf([...disk.recovery.keys()], 1)
        assert.isFalse(disk.recovery.has(left!))
      })
    ))

  it.effect("a map with no file comes back as one, and the first Save names it", () =>
    inSession((_disk, crash) =>
      Effect.gen(function*() {
        yield* newMapEffect
        s().renameLevel("Never saved", "Isaac")
        yield* syncRecovery

        yield* crash
        yield* offerRecovery
        assert.deepStrictEqual(offered(), ["Never saved"])
        yield* restoreUnsavedEffect
        assert.strictEqual(tabLabelOf(s()), "Never saved")
        assert.isNull(s().file)
        assert.isTrue(isUnsavedTab(s()))

        yield* saveMapFile
        assert.strictEqual(s().dialog?.id, "saveAs")
      })
    ))

  it.effect("a map whose file has gone comes back with no file", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        disk.files.delete(projectFile(MAP))

        yield* crash
        yield* offerRecovery
        yield* restoreUnsavedEffect
        assert.isNull(s().file)
        assert.isTrue(s().dirty)
      })
    ))

  it.effect("a definition's edits come back as its tab, and Save writes its file", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* openPrefabEffect(USER)
        moveItem(0, 50)
        const { ids, map } = s().doc
        yield* syncRecovery

        yield* crash
        yield* offerRecovery
        assert.deepStrictEqual(offered(), ["Bridge"])
        yield* restoreUnsavedEffect
        assert.deepInclude(s().document, { kind: "prefab", tier: "user", name: "Bridge" })
        assert.strictEqual(JSON.stringify(s().doc.map.items), JSON.stringify(map.items))
        assert.deepStrictEqual(s().doc.ids, ids)
        assert.isTrue(s().dirty)

        yield* saveMapFile
        const saved = disk.files.get(userPrefabFile("Bridge"))!
        assert.notStrictEqual(saved, PREFAB_TEXT)
        assert.isFalse(s().dirty)
        const edited = yield* MapCodec.use((codec) => codec.decodePrefab(saved, s().catalogIndex))
        const fixture = yield* MapCodec.use((codec) => codec.decodePrefab(PREFAB_TEXT, s().catalogIndex))
        assert.lengthOf(edited.items, fixture.items.length)
        // what the editor doesn't model stays, and an untouched item comes back as it went
        assert.deepStrictEqual(edited.items[1]?.paint, fixture.items[1]?.paint)
        assert.deepStrictEqual(edited.items[0]?.paint, fixture.items[0]?.paint)
      })
    ))

  it.effect("a new prefab too short to save comes back, and its first Save asks for a name", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* newPrefabEffect
        const cube = catalog.pieces.find((p) => p.className === "BP_Prim_Cube")!
        s().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 0 }))
        yield* syncRecovery

        yield* crash
        yield* offerRecovery
        assert.deepStrictEqual(offered(), ["Untitled prefab"])
        yield* restoreUnsavedEffect
        assert.lengthOf(s().doc.map.items, 1)

        s().placePiece(cube, placementTransform(cube, { x: 500, y: 0, z: 0 }))
        yield* saveMapFile
        assert.strictEqual(s().dialog?.id, "namePrefab")
        s().closeDialog()
        yield* saveNewPrefabEffect("Twin_cubes")
        assert.isTrue(disk.files.has(projectPrefabFile("Twin_cubes")))
      })
    ))

  it.effect("two definitions of one name, one in each tier, come back as two tabs", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        disk.files.set(projectPrefabFile("Bridge"), PREFAB_TEXT)
        yield* checkPrefabs
        yield* openPrefabEffect(USER)
        moveItem(0, 50)
        yield* openPrefabEffect({ ...USER, tier: "project" })
        moveItem(0, 60)
        yield* syncRecovery

        yield* crash
        yield* offerRecovery
        yield* restoreUnsavedEffect
        const tiers = s().tabIds.flatMap((id) => {
          const { document } = tabStateOf(s(), id)!
          return document.kind === "prefab" ? [document.tier] : []
        })
        assert.sameMembers(tiers, ["user", "project"])
      })
    ))

  it.effect("a tab that has a recovered map open already takes the edits, and no second tab opens", () =>
    inSession((_disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        moveItem(0, 77)
        const { map } = s().doc
        yield* syncRecovery

        yield* crash
        yield* openProjectMapFile(MAP)
        const tabs = s().tabIds.length
        yield* offerRecovery
        yield* restoreUnsavedEffect
        assert.lengthOf(s().tabIds, tabs)
        assert.strictEqual(JSON.stringify(s().doc.map.items), JSON.stringify(map.items))
        assert.isTrue(s().dirty)
      })
    ))
})

describe("the offer", () => {
  it.effect("keeps a snapshot whose restored tab couldn't be written, so its only copy isn't in memory", () => {
    const disk = makeTestDisk()
    const failing = { now: false }
    const layer = Layer.effect(
      Platform,
      Effect.gen(function*() {
        const platform = yield* Platform
        return Platform.of({
          ...platform,
          writeRecovery: (entry) =>
            failing.now ? Effect.fail(new PlatformError({ message: "disk full" })) : platform.writeRecovery(entry)
        })
      })
    ).pipe(Layer.provideMerge(layerFor(disk)))
    return Effect.gen(function*() {
      yield* reset
      let stop = yield* followRecovery
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      yield* syncRecovery
      const [left] = disk.recovery.keys()
      stop()
      yield* reset
      stop = yield* followRecovery
      yield* offerRecovery

      failing.now = true
      yield* Effect.exit(restoreUnsavedEffect)
      stop()
      assert.isTrue(disk.recovery.has(left!))
    }).pipe(Effect.provide(layer))
  })

  it.effect("waits for a tab's project, and Untitled Project's goes to any", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        const other = `${TEST_PROJECT} 2`
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        disk.project.recent = [TEST_PROJECT]
        disk.project.current = other

        yield* crash
        yield* offerRecovery
        assert.deepStrictEqual(offered(), [])

        yield* switchProjectEffect(TEST_PROJECT)
        assert.deepStrictEqual(offered(), ["Big Loop"])
      })
    ))

  it.effect("leaves out this page's own snapshots", () =>
    inSession((disk) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        assert.lengthOf([...disk.recovery.keys()], 1)
        yield* offerRecovery
        assert.isNull(s().dialog)
      })
    ))

  it.effect("keeps a snapshot it can't read, and offers the rest", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        const unreadable = "00000000-0000-4000-8000-000000000000"
        disk.recovery.set(unreadable, "{\"formatVersion\": 99}")

        yield* crash
        yield* offerRecovery
        assert.deepStrictEqual(offered(), ["Big Loop"])
        yield* restoreUnsavedEffect
        assert.isTrue(disk.recovery.has(unreadable))
      })
    ))

  it.effect("Decide later keeps the snapshots for the next launch", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery

        yield* crash
        yield* offerRecovery
        s().closeDialog()
        assert.lengthOf([...disk.recovery.keys()], 1)

        yield* crash
        yield* offerRecovery
        assert.deepStrictEqual(offered(), ["Big Loop"])
      })
    ))

  it.effect("Discard lets them go and opens nothing", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery

        yield* crash
        yield* offerRecovery
        const tabs = s().tabIds.length
        yield* discardUnsavedEffect
        assert.isNull(s().dialog)
        assert.lengthOf([...disk.recovery.keys()], 0)
        assert.lengthOf(s().tabIds, tabs)
      })
    ))

  it.effect("says what came back", () =>
    inSession((_disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        yield* crash
        yield* offerRecovery
        yield* noticesWhile((notices) =>
          restoreUnsavedEffect.pipe(
            Effect.tap(() => Effect.sync(() => assert.deepStrictEqual(notices, ["Restored 1 tab with unsaved edits"])))
          )
        )
      })
    ))
})

describe("keeping snapshots", () => {
  it.effect(
    "a tab with no edits has none, and one follows the first edit a moment later",
    () =>
      inSession((disk) =>
        Effect.gen(function*() {
          yield* createNewMap("Big Loop", "Isaac")
          yield* syncRecovery
          assert.lengthOf([...disk.recovery.keys()], 0)

          edit()
          assert.lengthOf([...disk.recovery.keys()], 0)
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1200)))
          assert.lengthOf([...disk.recovery.keys()], 1)
        })
      ),
    5000
  )

  it.effect("a later edit rewrites the tab's one snapshot", () =>
    inSession((disk) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        const [first] = disk.recovery.values()
        edit()
        yield* syncRecovery
        assert.lengthOf([...disk.recovery.keys()], 1)
        assert.notStrictEqual([...disk.recovery.values()][0], first)
      })
    ))

  it.effect("goes at once when the tab is saved, undone back or closed", () =>
    inSession((disk) =>
      Effect.gen(function*() {
        const none = () => disk.recovery.size === 0
        yield* createNewMap("Big Loop", "Isaac")

        edit()
        yield* syncRecovery
        yield* saveMapFile
        yield* untilTrue(none)
        assert.isTrue(none())

        edit()
        yield* syncRecovery
        s().undo()
        yield* untilTrue(none)
        assert.isTrue(none())

        yield* newMapEffect
        edit()
        yield* syncRecovery
        disk.promptAnswers.push("discard")
        yield* closeTabEffect(s().tabId)
        yield* untilTrue(none)
        assert.isTrue(none())
      })
    ))

  it.effect("every tab with edits has its own", () =>
    inSession((disk) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* newMapEffect
        s().renameLevel("Second", "Isaac")
        yield* syncRecovery
        assert.lengthOf([...disk.recovery.keys()], 2)
      })
    ))

  it.effect("Don't save at the window's close leaves nothing for the next launch", () =>
    inSession((disk, crash) =>
      Effect.gen(function*() {
        yield* createNewMap("Big Loop", "Isaac")
        edit()
        yield* syncRecovery
        disk.promptAnswers.push("discard")
        yield* answerUnloadRequest("close")
        assert.lengthOf([...disk.recovery.keys()], 0)

        // nothing comes back while the window finishes closing, either
        edit()
        yield* syncRecovery
        assert.lengthOf([...disk.recovery.keys()], 0)

        yield* crash
        yield* offerRecovery
        assert.isNull(s().dialog)
      })
    ))
})
