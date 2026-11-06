import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Schema } from "effect"
import fixture from "../../domain/bundledCatalog.json"
import { Catalog } from "../../domain/Catalog"
import { placementTransform } from "../../domain/factory"
import { MapSidecar } from "../../domain/MapSidecar"
import { treeKeys } from "../../domain/structure"
import { initialMap, useEditor } from "../../editor/store"
import { MapCodec } from "../../services/MapCodec"
import { MapExporter } from "../../services/MapExporter"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { Platform } from "../../services/Platform"
import {
  makeTestDisk,
  projectFile,
  sidecarFile,
  TEST_MAPS_FOLDER,
  type TestDisk,
  testHash
} from "../../test/desktopBridge"
import { createNewMap, diskWithPlugin, edit, layerFor, playSample, reset, s } from "../../test/editorActions"
import { recoverBackupEffect } from "./backups"
import { exportToGameEffect, playEffect } from "./exportPlay"
import { openProjectMapFile } from "./maps"
import { importMapFile, replaceOnImportEffect } from "./project"
import { duplicateMapEffect, saveMapAsEffect, saveMapFile } from "./save"
import { checkExportsEffect, reimportMapEffect } from "./sync"

const cube = Schema.decodeUnknownSync(Catalog)(fixture).pieces.find((p) => p.className === "BP_Prim_Cube")!

const NAME = "Map_LevelEditorMain&Big Loop_Isaac.balledit"
const decodeSidecar = Schema.decodeUnknownSync(Schema.fromJsonString(MapSidecar))

const sidecarOn = (disk: TestDisk, fileName = NAME) => decodeSidecar(disk.files.get(sidecarFile(fileName)))
const notices = (kind: string) => s().notifications.filter((n) => n.kind === kind)
const closeAndOpen = (fileName: string) =>
  Effect.gen(function*() {
    yield* reset
    useEditor.setState({ notifications: [] })
    yield* openProjectMapFile(fileName)
  })

const place = (...xs: ReadonlyArray<number>) => {
  for (const x of xs) s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))
}

/** A saved map: its player start, its goal and three cubes; the first two cubes are a named group. */
const authored = Effect.gen(function*() {
  yield* reset
  useEditor.setState({ notifications: [] })
  yield* createNewMap("Big Loop", "Isaac")
  place(1000, 2000, 3000)
  const [, , a = "", b = "", c = ""] = s().doc.ids
  const group = s().groupItems([a, b], "Bridge 1")!
  s().renameItem(a, "Left ramp")
  s().setTags(group, ["start"])
  yield* saveMapFile
  return { a, b, c, group }
})

/** The tree as nested lists: an item's key, or a group's name and children. */
const shapeOf = (nodes = s().doc.structure.tree): ReadonlyArray<unknown> =>
  nodes.map((node) => node.kind === "item" ? node.key : [node.name, shapeOf(node.children)])

describe("the sidecar", () => {
  it.effect("is written with the map's hash, and reopening gives back the keys and structure", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a, b, c } = yield* authored
      const ids = s().doc.ids
      const written = sidecarOn(disk)
      assert.strictEqual(written.mapHash, testHash(disk.files.get(projectFile(NAME))!))
      assert.deepStrictEqual(written.items[a]?.name, "Left ramp")
      assert.strictEqual(written.items[c]?.index, 4)
      assert.include(written.items[c]?.fingerprint ?? "", "BP_Prim_Cube|3000,")

      yield* closeAndOpen(NAME)
      assert.deepStrictEqual(s().doc.ids, ids)
      assert.deepStrictEqual(shapeOf(), [ids[0], ids[1], ["Bridge 1", [a, b]], c])
      assert.deepStrictEqual(s().doc.structure.items.get(a), { name: "Left ramp" })
      assert.isFalse(s().dirty)
      assert.lengthOf(notices("sidecarUnmatched"), 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a Save puts the projected groups in the .balledit, and the outermost group only", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { c, group } = yield* authored
      const outer = s().groupItems([c], "Outer")!
      s().moveNodes([group], outer, 0)
      yield* saveMapFile
      const saved = yield* MapCodec.use((codec) => codec.decode(disk.files.get(projectFile(NAME))!))
      assert.deepStrictEqual(saved.editorState?.groups.map((g) => [g.members, g.name]), [[[2, 3, 4], "Outer"]])
      assert.isDefined(saved.editorState?.groups[0]?.frame)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Rename carries the sidecar to the new name, with the new file's hash", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a } = yield* authored
      s().renameLevel("Hairpin", "Isaac")
      yield* saveMapAsEffect()
      const renamed = "Map_LevelEditorMain&Hairpin_Isaac.balledit"
      assert.isFalse(disk.files.has(sidecarFile(NAME)))
      assert.strictEqual(sidecarOn(disk, renamed).mapHash, testHash(disk.files.get(projectFile(renamed))!))
      assert.deepStrictEqual(sidecarOn(disk, renamed).items[a]?.name, "Left ramp")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Duplicate writes a sidecar for the copy and leaves the original's", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a } = yield* authored
      const original = disk.files.get(sidecarFile(NAME))
      yield* duplicateMapEffect("Big Loop 2", "Isaac")
      const copy = "Map_LevelEditorMain&Big Loop 2_Isaac.balledit"
      assert.strictEqual(disk.files.get(sidecarFile(NAME)), original)
      assert.strictEqual(sidecarOn(disk, copy).mapHash, testHash(disk.files.get(projectFile(copy))!))
      assert.deepStrictEqual(sidecarOn(disk, copy).items[a]?.name, "Left ramp")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Export and Play write the .balledit with its groups, and no sidecar", () => {
    const disk = diskWithPlugin()
    return Effect.gen(function*() {
      yield* authored
      yield* exportToGameEffect
      const exported = disk.files.get(`${TEST_MAPS_FOLDER}/${NAME}`)
      assert.strictEqual(exported, disk.files.get(projectFile(NAME)))
      const inGame = yield* MapCodec.use((codec) => codec.decode(exported!))
      assert.deepStrictEqual(inGame.editorState?.groups.map((g) => g.name), ["Bridge1"])
      yield* playEffect
      const written = [...disk.files.keys()].filter((file) => file.startsWith(TEST_MAPS_FOLDER))
      assert.deepStrictEqual(written, [`${TEST_MAPS_FOLDER}/${NAME}`])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("re-matches when the .balledit changed, reports what's gone, and writes the sidecar back", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a, b, c } = yield* authored
      // something else rewrote the file: the third cube moved, and the rest stayed
      const text = disk.files.get(projectFile(NAME))!
      const moved = text.replace(/"x": 3000/, "\"x\": 7000")
      assert.notStrictEqual(moved, text)
      disk.files.set(projectFile(NAME), moved)

      yield* closeAndOpen(NAME)
      assert.lengthOf(notices("sidecarUnmatched"), 1)
      assert.include(notices("sidecarUnmatched")[0]?.title, "1 piece lost")
      assert.strictEqual(s().doc.ids[2], a)
      assert.strictEqual(s().doc.ids[3], b)
      assert.notStrictEqual(s().doc.ids[4], c)
      assert.deepStrictEqual(s().doc.structure.items.get(a), { name: "Left ramp" })
      assert.isFalse(s().dirty)
      assert.strictEqual(sidecarOn(disk).mapHash, testHash(moved))

      // written back, so the next open has nothing to say
      yield* closeAndOpen(NAME)
      assert.lengthOf(notices("sidecarUnmatched"), 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Re-import goes through the same path, in a tab or not", () => {
    const disk = diskWithPlugin()
    return Effect.gen(function*() {
      const { a, b } = yield* authored
      yield* exportToGameEffect
      const inGame = `${TEST_MAPS_FOLDER}/${NAME}`
      const saved = disk.files.get(inGame)!
      // 0.4.1 drops editorState on a save (docs/qa/save-roundtrip.md); the game also moved the third cube
      const codec = yield* MapCodec
      const { editorState: _dropped, ...kept } = yield* codec.decode(saved)
      const stripped = (yield* codec.encode(kept)).replace(/"x": 3000/, "\"x\": 7000")
      assert.notInclude(stripped, "editorState")
      disk.files.set(inGame, stripped)
      yield* checkExportsEffect

      yield* reimportMapEffect(NAME)
      assert.strictEqual(s().doc.ids[2], a)
      assert.deepStrictEqual(shapeOf()[2], ["Bridge 1", [a, b]])
      // the game keeps items in order, so the cube it moved is still that cube
      assert.lengthOf(notices("sidecarUnmatched"), 0)
      assert.strictEqual(sidecarOn(disk).mapHash, testHash(stripped))

      // a map that isn't open: the sidecar on disk is matched all the same
      yield* reset
      disk.files.set(inGame, stripped.replace(/"x": 7000/, "\"x\": 7100"))
      useEditor.setState({ notifications: [] })
      yield* checkExportsEffect
      yield* reimportMapEffect(NAME)
      assert.strictEqual(sidecarOn(disk).mapHash, testHash(disk.files.get(inGame)!))
      assert.lengthOf(notices("sidecarUnmatched"), 0)
      assert.isNull(s().file)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a map with no sidecar opens on its own, and its first Save writes one", () => {
    const { text } = playSample()
    const name = playSample().name
    const disk = makeTestDisk({ [projectFile(name)]: text })
    return Effect.gen(function*() {
      yield* closeAndOpen(name)
      assert.lengthOf(s().doc.ids, s().doc.map.items.length)
      assert.sameMembers([...treeKeys(s().doc.structure.tree)], [...s().doc.ids])
      assert.isFalse(disk.files.has(sidecarFile(name)))
      assert.lengthOf(notices("sidecarUnmatched"), 0)
      edit()
      yield* saveMapFile
      assert.strictEqual(sidecarOn(disk, name).mapHash, testHash(disk.files.get(projectFile(name))!))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a sidecar that doesn't decode leaves the map opening, and says so", () => {
    const { name, text } = playSample()
    const disk = makeTestDisk({ [projectFile(name)]: text, [sidecarFile(name)]: "{ not json" })
    return Effect.gen(function*() {
      yield* closeAndOpen(name)
      assert.strictEqual(s().file?.name, name)
      assert.lengthOf(notices("sidecarUnreadable"), 1)
      assert.strictEqual(disk.files.get(sidecarFile(name)), "{ not json")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Recover brings back the version's structure with it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a, b } = yield* authored
      const ids = s().doc.ids
      s().select([a, b])
      s().ungroupSelection()
      s().renameItem(a, "Renamed")
      edit()
      yield* saveMapFile
      const kept = disk.backups.find((backup) => backup.fileName === NAME)!
      assert.isNotNull(kept.sidecar)

      yield* recoverBackupEffect(kept, true)
      assert.deepStrictEqual(s().doc.ids, ids)
      assert.deepStrictEqual(shapeOf()[2], ["Bridge 1", [a, b]])
      assert.deepStrictEqual(s().doc.structure.items.get(a), { name: "Left ramp" })
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Recover of a version that isn't the sidecar's re-matches it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a, c } = yield* authored
      const text = disk.files.get(projectFile(NAME))!.replace(/"x": 3000/, "\"x\": 7000")
      const backup = {
        place: "export",
        id: `0 ${NAME}`,
        fileName: NAME,
        at: "2026-10-31T12:00:00.000Z",
        text,
        hash: testHash(text),
        sidecar: disk.files.get(sidecarFile(NAME)) ?? null
      } as const
      disk.backups.push(backup)
      yield* recoverBackupEffect(backup, true)
      assert.deepStrictEqual(s().doc.structure.items.get(a), { name: "Left ramp" })
      assert.isFalse(s().doc.ids.includes(c))
      assert.lengthOf(notices("sidecarUnmatched"), 1)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Importing a map of the project itself keeps its sidecar's structure", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const { a } = yield* authored
      const ids = s().doc.ids
      yield* reset
      disk.answers.push(projectFile(NAME))
      yield* importMapFile
      assert.strictEqual(s().file?.name, NAME)
      assert.deepStrictEqual(s().doc.ids, ids)
      assert.deepStrictEqual(s().doc.structure.items.get(a), { name: "Left ramp" })
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Import makes a tree group of each game group, and Replace leaves the old sidecar behind", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* authored
      const elsewhere = "/somewhere/Map_LevelEditorMain&Big Loop_Isaac.balledit"
      disk.files.set(elsewhere, disk.files.get(projectFile(NAME))!)
      disk.answers.push(elsewhere)
      yield* importMapFile
      assert.strictEqual(s().dialog?.id, "importClash")
      yield* replaceOnImportEffect
      assert.isFalse(disk.files.has(sidecarFile(NAME)))
      assert.deepStrictEqual(shapeOf().filter((node) => typeof node !== "string"), [["Bridge1", [
        s().doc.ids[2],
        s().doc.ids[3]
      ]]])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("the sidecar in a browser", () => {
  const downloads: Array<{ readonly name: string; readonly text: string }> = []
  const browser = Layer.mergeAll(
    Layer.effect(
      Platform,
      Effect.gen(function*() {
        const platform = yield* Platform
        return {
          ...platform,
          download: (file: { readonly name: string; readonly text: string }) =>
            Effect.sync(() => void downloads.push(file))
        }
      })
    ).pipe(Layer.provide(Platform.layerBrowser)),
    MapPrefsStore.layerTest,
    MapExporter.layerNoDeps.pipe(Layer.provideMerge(Layer.mergeAll(MapCodec.layer, DateTime.layerCurrentZoneOffset(0))))
  )

  it.effect("stays in the tab, and Save downloads the .balledit with its groups", () =>
    Effect.gen(function*() {
      useEditor.setState({ tabIds: [s().tabId], parkedTabs: new Map() })
      s().loadMap(initialMap(), null, undefined, { fresh: true })
      s().renameLevel("Big Loop", "Isaac")
      place(1000, 2000)
      const [, , a = "", b = ""] = s().doc.ids
      s().groupItems([a, b], "Pair")
      yield* saveMapAsEffect()
      assert.deepStrictEqual(shapeOf()[2], ["Pair", [a, b]])
      assert.isFalse(s().dirty)
      assert.lengthOf(downloads, 1)
      const saved = yield* MapCodec.use((codec) => codec.decode(downloads[0]!.text))
      assert.deepStrictEqual(saved.editorState?.groups.map((g) => [g.members, g.name]), [[[2, 3], "Pair"]])
    }).pipe(Effect.provide(browser)))
})
