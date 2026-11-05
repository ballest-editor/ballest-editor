import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { Catalog, indexCatalog } from "../../domain/Catalog"
import { placementTransform } from "../../domain/factory"
import { MapSidecar } from "../../domain/MapSidecar"
import { findGroup, treeKeys } from "../../domain/structure"
import { MapCodec } from "../../services/MapCodec"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { Platform } from "../../services/Platform"
import {
  makeTestDisk,
  projectFile,
  projectPrefabFile,
  sidecarFile,
  type TestDisk,
  userPrefabFile
} from "../../test/desktopBridge"
import { layerFor, reset, s } from "../../test/editorActions"
import { objectAt, parseJson } from "../../test/json"
import { changedPrefab, PREFAB_TEXT } from "../../test/prefabs"
import { repoRoot } from "../../test/samples"
import { sceneRegistry } from "../sceneRegistry"
import { tabStateOf, useEditor } from "../store"
import { exportToGameEffect, playEffect } from "./exportPlay"
import { createNewMap, openProjectMapFile } from "./maps"
import {
  checkPrefabs,
  deletePrefabEffect,
  openPrefabEffect,
  placePrefabEffect,
  renamePrefabEffect,
  savePrefabTab,
  saveSelectionAsPrefabEffect
} from "./prefabs"
import { saveMapFile } from "./save"
import { closeTabEffect } from "./unsaved"

const parsed = Schema.decodeUnknownSync(Catalog)(
  JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "catalog.json"), "utf8"))
)
const cube = parsed.pieces.find((p) => p.className === "BP_Prim_Cube")!
const USER = { tier: "user", name: "Bridge" } as const
const MAP = "Map_LevelEditorMain&Big Loop_Isaac.balledit"

const decodeSidecar = Schema.decodeUnknownSync(Schema.fromJsonString(MapSidecar))
const notices = (kind: string) => s().notifications.filter((n) => n.kind === kind)

/** A saved map and the catalog, with the fixture in the game's prefabs folder. */
const started = (disk: TestDisk) =>
  Effect.gen(function*() {
    yield* reset
    useEditor.setState({ notifications: [], prefabs: [], catalogIndex: indexCatalog(parsed) })
    sceneRegistry.viewRay = () => ({ origin: { x: 0, y: 0, z: 9000 }, direction: { x: 1, y: 0, z: 0 } })
    disk.files.set(userPrefabFile("Bridge"), PREFAB_TEXT)
    yield* createNewMap("Big Loop", "Isaac")
    yield* checkPrefabs
    return s().tabId
  })

const placed = Effect.gen(function*() {
  yield* placePrefabEffect(USER)
  return instanceId()
})

const instanceId = () => {
  const node = s().doc.structure.tree.find((n) => n.kind === "group" && n.prefab !== undefined)
  return node?.kind === "group" ? node.id : ""
}

const instance = (id: string, doc = s().doc) => findGroup(doc.structure.tree, id)
const hashOf = (ref: { readonly name: string }) => s().prefabs.find((p) => p.name === ref.name)?.hash
const xOf = (key: string) => s().doc.map.items[s().doc.ids.indexOf(key)]?.itemTransform.translation.x ?? NaN

/** The definition's file with its first item's location changed, as the game or a text editor would write it. */
const edited = (x: number) => changedPrefab((json) => void (json.items[0]!.transform.location = [x, 0, -250.5]))

/** A saved file's first item's `location` x and whether it has `paint`. */
const savedFirst = (text: string) => {
  const item = objectAt(parseJson(text), "items", 0)
  const location = objectAt(item, "transform")["location"]
  return { x: Array.isArray(location) ? Number(location[0]) : NaN, painted: "paint" in item }
}

const moveItem = (key: string, by: number) => {
  const item = s().doc.map.items[s().doc.ids.indexOf(key)]!
  const t = item.itemTransform
  s().transformItems(new Map([[key, { ...t, translation: { ...t.translation, x: t.translation.x + by } }]]))
}

const moveAll = (id: string, by: number) => {
  const { doc } = s()
  s().transformItems(
    new Map(
      treeKeys([instance(id)!]).map((key) => {
        const t = doc.map.items[doc.ids.indexOf(key)]!.itemTransform
        return [key, { ...t, translation: { ...t.translation, x: t.translation.x + by } }] as const
      })
    )
  )
}

const withDisk = (
  body: (disk: TestDisk) => Effect.Effect<void, unknown, Layer.Success<ReturnType<typeof layerFor>>>
) => {
  const disk = makeTestDisk()
  return body(disk).pipe(Effect.provide(layerFor(disk)))
}

describe("placing a prefab", () => {
  it.effect("adds its items as one selected instance, one undo step, with a link to the file", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const before = s().doc.map.items.length
        const id = yield* placed
        const group = instance(id)!
        assert.strictEqual(group.name, "Bridge")
        assert.strictEqual(group.prefab?.tier, "user")
        assert.strictEqual(group.prefab?.name, "Bridge")
        assert.strictEqual(group.prefab?.hash, hashOf(USER))
        assert.lengthOf(s().doc.map.items, before + 2)
        assert.deepStrictEqual([...s().selectedIds].sort(), [...treeKeys([group])].sort())
        s().undo()
        assert.lengthOf(s().doc.map.items, before)
        assert.isUndefined(instance(id))
        s().redo()
        assert.isDefined(instance(id)?.prefab)
      })
    ))

  it.effect("lands in front of the camera, as the game's spawn does", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        const nearest = Math.min(...treeKeys([instance(id)!]).map(xOf))
        assert.isAbove(nearest, 0)
        assert.isBelow(nearest, 5000)
      })
    ))

  it.effect("keeps the link in the sidecar, and none of it reaches the map file", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        yield* saveMapFile
        const sidecar = decodeSidecar(disk.files.get(sidecarFile(MAP)))
        const node = sidecar.tree.find((n) => n.kind === "group")
        assert.strictEqual(node?.kind === "group" ? node.prefab?.name : "", "Bridge")
        const text = disk.files.get(projectFile(MAP)) ?? ""
        assert.notInclude(text, "prefab")
        assert.notInclude(text, "BallestPrefab")
        const map = yield* MapCodec.use((codec) => codec.decode(text))
        const [gameGroup] = map.editorState?.groups ?? []
        assert.strictEqual(gameGroup?.name, "Bridge")
        assert.lengthOf(gameGroup?.members ?? [], 2)

        // reopened, it is still an instance
        yield* reset
        yield* openProjectMapFile(MAP)
        assert.isDefined(instance(id)?.prefab)
      })
    ))

  it.effect("names the game group after the prefab even when the instance was renamed", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        s().renameGroup(yield* placed, "Left side")
        yield* saveMapFile
        const text = disk.files.get(projectFile(MAP)) ?? ""
        const map = yield* MapCodec.use((codec) => codec.decode(text))
        assert.strictEqual(map.editorState?.groups[0]?.name, "Bridge")
      })
    ))

  it.effect("refuses a file the game would refuse, with its words", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        disk.files.set(userPrefabFile("Bridge"), changedPrefab((json) => void json.items.pop()))
        const before = s().doc.map.items.length
        const error = yield* Effect.flip(placePrefabEffect(USER))
        assert.include(error.message, "2 to 4096 items")
        assert.lengthOf(s().doc.map.items, before)
      })
    ))
})

describe("instances following their definition", () => {
  it.effect("updates every unmodified instance in place when the game writes the file", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const a = yield* placed
        yield* placePrefabEffect(USER)
        const b = s().doc.structure.tree.flatMap((n) => n.kind === "group" && n.id !== a ? [n.id] : [])[0] ?? ""
        moveAll(b, 8000)
        const [firstKey = ""] = treeKeys([instance(a)!])
        const [otherKey = ""] = treeKeys([instance(b)!])
        const [wasA, wasB] = [xOf(firstKey), xOf(otherKey)]

        disk.files.set(userPrefabFile("Bridge"), edited(-1500))
        yield* checkPrefabs

        assert.closeTo(xOf(firstKey), wasA - 500, 0.01)
        assert.closeTo(xOf(otherKey), wasB - 500, 0.01)
        assert.strictEqual(instance(a)?.prefab?.hash, hashOf(USER))
        assert.strictEqual(instance(b)?.prefab?.hash, hashOf(USER))
        assert.lengthOf(notices("prefabInstancesUpdated"), 1)
        assert.lengthOf(notices("prefabInstancesEdited"), 0)
        assert.isTrue(s().dirty)
      })
    ))

  it.effect("is one undo step, which a later look doesn't take back", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        const [key = ""] = treeKeys([instance(id)!])
        const was = xOf(key)
        disk.files.set(userPrefabFile("Bridge"), edited(-1500))
        yield* checkPrefabs
        s().undo()
        assert.closeTo(xOf(key), was, 1e-6)
        yield* checkPrefabs
        assert.closeTo(xOf(key), was, 1e-6)
        s().redo()
        assert.closeTo(xOf(key), was - 500, 0.01)
      })
    ))

  it.effect("reports a modified instance and leaves it alone, with Update and Detach", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        const [key = ""] = treeKeys([instance(id)!])
        moveItem(key, 250)
        const was = xOf(key)
        const oldHash = instance(id)?.prefab?.hash
        disk.files.set(userPrefabFile("Bridge"), edited(-1500))
        yield* checkPrefabs
        assert.closeTo(xOf(key), was, 1e-9)
        assert.strictEqual(instance(id)?.prefab?.hash, oldHash)
        const [report] = notices("prefabInstancesEdited")
        assert.deepStrictEqual(report?.actions.map((a) => a.label), ["Update", "Detach"])
        assert.deepInclude(report?.actions[0]?.command, { _tag: "UpdatePrefabInstances", tier: "user", name: "Bridge" })
        // reported once
        yield* checkPrefabs
        assert.lengthOf(notices("prefabInstancesEdited"), 1)
      })
    ))

  it.effect("detach keeps the group and drops the link, as one undo step", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        s().detachInstances(s().tabId, [id])
        assert.isDefined(instance(id))
        assert.isUndefined(instance(id)?.prefab)
        s().undo()
        assert.isDefined(instance(id)?.prefab)
      })
    ))

  it.effect("updates instances in a tab that isn't the active one", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        const mapTab = yield* started(disk)
        const id = yield* placed
        yield* createNewMap("Second", "Isaac")
        assert.notStrictEqual(s().tabId, mapTab)
        disk.files.set(userPrefabFile("Bridge"), edited(-1500))
        yield* checkPrefabs
        const parked = tabStateOf(s(), mapTab)!
        assert.strictEqual(instance(id, parked.doc)?.prefab?.hash, hashOf(USER))
        assert.isTrue(parked.dirty)
        assert.lengthOf(parked.past.filter((step) => !step.selectionOnly), 2)
      })
    ))

  it.effect("catches up when a map opens after its definition changed", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        yield* saveMapFile
        yield* reset
        disk.files.set(userPrefabFile("Bridge"), edited(-1500))
        yield* checkPrefabs
        yield* openProjectMapFile(MAP)
        assert.strictEqual(instance(id)?.prefab?.hash, hashOf(USER))
        assert.isTrue(s().dirty)
      })
    ))
})

describe("a definition's tab", () => {
  const openDefinition = Effect.gen(function*() {
    yield* openPrefabEffect(USER)
    return s().tabId
  })

  it.effect("is a tab like a map's that knows what it holds", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        const mapTab = yield* started(disk)
        const tabId = yield* openDefinition
        assert.notStrictEqual(tabId, mapTab)
        assert.deepInclude(s().document, { kind: "prefab", tier: "user", name: "Bridge" })
        assert.lengthOf(s().doc.map.items, 2)
        assert.isFalse(s().dirty)
        yield* openDefinition
        assert.strictEqual(s().tabId, tabId)
        assert.lengthOf(s().tabIds, 2)
      })
    ))

  it.effect("saves the file byte for byte when nothing changed", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* openDefinition
        yield* saveMapFile
        assert.strictEqual(disk.files.get(userPrefabFile("Bridge")), PREFAB_TEXT)
        assert.deepStrictEqual(disk.prefabBackups, [])
      })
    ))

  it.effect("saves edits into the file, the old one to the backups, and instances follow", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        const mapTab = yield* started(disk)
        const id = yield* placed
        const [key = ""] = treeKeys([instance(id)!])
        const was = xOf(key)
        yield* openDefinition
        moveItem(s().doc.ids[0] ?? "", 300)
        assert.isTrue(s().dirty)
        yield* saveMapFile
        assert.isFalse(s().dirty)
        assert.lengthOf(disk.prefabBackups, 1)
        const saved = savedFirst(disk.files.get(userPrefabFile("Bridge")) ?? "")
        assert.closeTo(saved.x, -700, 1e-6)
        assert.isTrue(saved.painted)
        const map = tabStateOf(s(), mapTab)!
        const after = map.doc.map.items[map.doc.ids.indexOf(key)]?.itemTransform.translation.x
        assert.closeTo(after ?? NaN, was + 300, 0.01)
      })
    ))

  it.effect("has its unsaved edits asked about like a map's, and Save goes to the file", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const tabId = yield* openDefinition
        moveItem(s().doc.ids[0] ?? "", 300)
        disk.promptAnswers.push("save")
        yield* closeTabEffect(tabId)
        assert.lengthOf(disk.prompts, 1)
        assert.include(disk.prompts[0]?.message ?? "", "Bridge")
        assert.notInclude(s().tabIds, tabId)
        assert.notStrictEqual(disk.files.get(userPrefabFile("Bridge")), PREFAB_TEXT)
      })
    ))

  it.effect("won't save what the game would refuse, and keeps the edits", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* openDefinition
        s().select([s().doc.ids[0] ?? ""])
        s().deleteSelection()
        const error = yield* Effect.flip(savePrefabTab)
        assert.include(error.message, "2 to 4096 items")
        assert.isTrue(s().dirty)
        assert.strictEqual(disk.files.get(userPrefabFile("Bridge")), PREFAB_TEXT)
      })
    ))

  it.effect("can't Export or Play", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* openDefinition
        for (const effect of [exportToGameEffect, playEffect]) {
          const error = yield* Effect.flip(effect)
          assert.include(String(error), "isn't a map")
        }
        assert.deepStrictEqual(disk.game.races, [])
      })
    ))

  it.effect("reads the file again when the game wrote it and it has no edits, and warns when it has", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const tabId = yield* openDefinition
        disk.files.set(userPrefabFile("Bridge"), edited(-1500))
        yield* checkPrefabs
        const location = s().doc.map.items[0]?.itemTransform.translation.x ?? NaN
        assert.strictEqual(s().tabId, tabId)
        assert.closeTo(location, -3955 - 1500, 1e-6)
        moveItem(s().doc.ids[0] ?? "", 300)
        disk.files.set(userPrefabFile("Bridge"), edited(-1600))
        yield* checkPrefabs
        assert.lengthOf(notices("prefabChangedOnDisk"), 1)
        assert.isTrue(s().dirty)
      })
    ))

  it.effect("places a plain group in a definition's tab, which has no place for a link", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* openDefinition
        yield* placePrefabEffect(USER)
        const [group] = s().doc.structure.tree.flatMap((n) => n.kind === "group" ? [n] : [])
        assert.isDefined(group)
        assert.isUndefined(group.prefab)
      })
    ))
})

describe("saving a selection as a prefab", () => {
  const placeCubes = () => {
    for (const x of [1000, 3000]) s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 5000 }))
    s().select(s().doc.ids.slice(-2))
  }

  it.effect("writes the game's format to the tier asked, changing nothing in the map", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        placeCubes()
        const { doc } = s()
        yield* saveSelectionAsPrefabEffect({ tier: "project", name: "Pair" }, false)
        const text = disk.files.get(projectPrefabFile("Pair")) ?? ""
        assert.include(text, "\r\n\t\"format\": \"BallestPrefab\"")
        assert.strictEqual(s().doc, doc)
        assert.deepInclude(s().prefabs.find((p) => p.name === "Pair"), { tier: "project", itemCount: 2 })
      })
    ))

  it.effect("takes the name of the group it is exactly", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        placeCubes()
        s().groupItems(s().selectedIds, "Left pair")
        yield* saveSelectionAsPrefabEffect({ tier: "user", name: "Pair" }, false)
        assert.strictEqual(
          objectAt(parseJson(disk.files.get(userPrefabFile("Pair")) ?? ""), "group")["name"],
          "Leftpair"
        )
      })
    ))

  it.effect("refuses what the game refuses, and a taken name without replace", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        placeCubes()
        s().select(s().doc.ids.slice(-1))
        const lone = yield* Effect.flip(saveSelectionAsPrefabEffect({ tier: "user", name: "Pair" }, false))
        assert.include(lone.message, "Select 2 to 4096 items")
        s().select(s().doc.ids.slice(0, 2))
        const start = yield* Effect.flip(saveSelectionAsPrefabEffect({ tier: "user", name: "Pair" }, false))
        assert.include(start.message, "MP_PlayerStart")
        s().select(s().doc.ids.slice(-2))
        const taken = yield* Effect.flip(saveSelectionAsPrefabEffect(USER, false))
        assert.include(taken.message, "already a prefab")
      })
    ))
})

describe("managing definitions", () => {
  it.effect("a rename carries the open tab and the instances in open maps along", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        const mapTab = yield* started(disk)
        const id = yield* placed
        yield* openPrefabEffect(USER)
        yield* renamePrefabEffect(USER, "Span")
        assert.deepInclude(s().document, { name: "Span" })
        assert.strictEqual(s().file?.name, "Span.json")
        const map = tabStateOf(s(), mapTab)!
        assert.strictEqual(instance(id, map.doc)?.prefab?.name, "Span")
        assert.isFalse(disk.files.has(userPrefabFile("Bridge")))
      })
    ))

  it.effect("a map opened after a rename finds the definition by its hash", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        yield* saveMapFile
        yield* reset
        yield* renamePrefabEffect(USER, "Span")
        yield* openProjectMapFile(MAP)
        assert.strictEqual(instance(id)?.prefab?.name, "Span")
      })
    ))

  it.effect("a delete leaves instances and the tab standing", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        yield* openPrefabEffect(USER)
        yield* deletePrefabEffect(USER)
        assert.isNull(s().file)
        assert.lengthOf(disk.prefabBackups, 1)
        assert.deepStrictEqual(s().prefabs, [])
        assert.isDefined(instance(id, tabStateOf(s(), s().tabIds[0] ?? "")?.doc)?.prefab)
      })
    ))
})

describe("in a browser", () => {
  const browser = Layer.mergeAll(Platform.layerBrowser, MapCodec.layer, MapPrefsStore.layerTest)

  it.effect("keeps one tier in memory, and the project tier takes nothing", () =>
    Effect.gen(function*() {
      const platform = yield* Platform
      assert.deepStrictEqual(yield* platform.listPrefabs("user"), [])
      const info = yield* platform.writePrefab({ tier: "user", name: "Bridge", text: PREFAB_TEXT, replace: false })
      assert.deepInclude(info, { itemCount: 2, path: null })
      assert.match(info.hash, /^[0-9a-f]{64}$/)
      assert.deepStrictEqual(yield* platform.listPrefabs("project"), [])
      yield* Effect.flip(platform.writePrefab({ tier: "project", name: "Bridge", text: "{}", replace: false }))
      const taken = yield* Effect.flip(
        platform.writePrefab({ tier: "user", name: "Bridge", text: "{}", replace: false })
      )
      assert.include(taken.message, "already a prefab")
      const renamed = yield* platform.renamePrefab({ tier: "user", from: "Bridge", to: "Span" })
      assert.strictEqual(renamed.hash, info.hash)
      assert.strictEqual((yield* platform.readPrefab({ tier: "user", name: "Span" })).text, PREFAB_TEXT)
      yield* platform.deletePrefab({ tier: "user", name: "Span" })
      assert.deepStrictEqual(yield* platform.listPrefabs("user"), [])
    }).pipe(Effect.provide(browser)))
})
