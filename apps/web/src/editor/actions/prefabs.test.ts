import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach } from "vitest"
import { Catalog, indexCatalog } from "../../domain/Catalog"
import { placementTransform } from "../../domain/factory"
import { type Box, boxCentreOf, itemsBoxOf } from "../../domain/itemBounds"
import { MapSidecar } from "../../domain/MapSidecar"
import { PREFAB_NEEDS_PROJECT } from "../../domain/prefab"
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
import { createNewMap, layerFor, reset, s } from "../../test/editorActions"
import { objectAt, parseJson } from "../../test/json"
import { VIEW_DOWN } from "../../test/placementView"
import { changedPrefab, PREFAB_TEXT } from "../../test/prefabs"
import { repoRoot } from "../../test/samples"
import { sceneRegistry } from "../sceneRegistry"
import {
  isBlankTab,
  isUnsavedTab,
  NO_TAB_OPEN,
  noTabOpen,
  saveProblemOf,
  selectedIndices,
  tabLabelOf,
  tabStateOf,
  useEditor
} from "../store"
import { restorePrefabBackupEffect } from "./backups"
import { exportToGameEffect, playEffect } from "./exportPlay"
import { openProjectMapFile } from "./maps"
import { spreadPlacement } from "./placement"
import {
  checkPrefabs,
  deletePrefabEffect,
  newPrefabEffect,
  newPrefabProblem,
  openPrefabEffect,
  placePrefabEffect,
  projectMapsUsingPrefabEffect,
  renamePrefabEffect,
  saveNewPrefabEffect,
  savePrefabTab,
  saveSelectionAsPrefabEffect,
  selectInstances,
  selectionPrefabProblem,
  suggestNewPrefabName,
  suggestPrefabName,
  tabsUsingPrefab
} from "./prefabs"
import { saveMapFile } from "./save"
import { closeTabEffect, closeTabsBesideEffect } from "./unsaved"

const parsed = Schema.decodeUnknownSync(Catalog)(
  JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "catalog.json"), "utf8"))
)
const cube = parsed.pieces.find((p) => p.className === "BP_Prim_Cube")!
const USER = { tier: "user", name: "Bridge" } as const
const MAP = "Map_LevelEditorMain&Big Loop_Isaac.balledit"

/** Where the view puts a placement. */
const AIM = { x: 3000, y: 0, z: 9000 }

const decodeSidecar = Schema.decodeUnknownSync(Schema.fromJsonString(MapSidecar))
const notices = (kind: string) => s().notifications.filter((n) => n.kind === kind)
const toastsOf = (kind: string) => s().toasts.filter((n) => n.kind === kind)

/** A saved map and the catalog, with the fixture in the game's prefabs folder. */
const started = (disk: TestDisk) =>
  Effect.gen(function*() {
    yield* reset
    useEditor.setState({ notifications: [], toasts: [], prefabs: [], catalogIndex: indexCatalog(parsed) })
    sceneRegistry.placementPoint = (width, height) => spreadPlacement(AIM, width, VIEW_DOWN, height)
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

/** The box around what is selected, which after a placement is the instance. */
const instanceBox = () => itemsBoxOf(selectedIndices(s()).map((index) => s().doc.map.items[index]!), s().catalogIndex)!
const boxesMeet = (a: Box, b: Box) =>
  (["x", "y", "z"] as const).every((axis) => a.min[axis] <= b.max[axis] && b.min[axis] <= a.max[axis])

const instance = (id: string, doc = s().doc) => findGroup(doc.structure.tree, id)
const xOf = (key: string) => s().doc.map.items[s().doc.ids.indexOf(key)]?.itemTransform.translation.x ?? NaN

/** A placed instance, its first item and where that stands. */
const placedFirst = Effect.gen(function*() {
  const id = yield* placed
  const [key = ""] = treeKeys([instance(id)!])
  return { id, key, was: xOf(key) }
})

const hashOf = (ref: { readonly name: string }) => s().prefabs.find((p) => p.name === ref.name)?.hash

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

/**
 * Edits an item's property, which isn't one of the overrides an instance keeps (docs/DESKTOP.md § Prefabs), so an
 * instance holding it no longer follows its definition.
 */
const editProperty = (key: string) => {
  s().select([key])
  s().setSelectionProperties([{ property: { list: "floatProperties", name: "Strength", type: "Float" }, value: 2 }])
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

const openDefinition = Effect.gen(function*() {
  yield* openPrefabEffect(USER)
  return s().tabId
})

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

  it.effect("stands the box around its items on the spot the view picks", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* placed
        const box = instanceBox()
        assert.closeTo(boxCentreOf(box).x, AIM.x, 0.01)
        assert.closeTo(boxCentreOf(box).y, AIM.y, 0.01)
        assert.closeTo(box.min.z, AIM.z, 0.01)
      })
    ))

  it.effect("keeps clear of an item on the spot, and of the instance placed before it", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        s().placePiece(cube, placementTransform(cube, AIM))
        const item = itemsBoxOf([s().doc.map.items.at(-1)!], s().catalogIndex)!
        yield* placed
        const first = instanceBox()
        assert.isFalse(boxesMeet(first, item))
        yield* placePrefabEffect(USER)
        assert.isFalse(boxesMeet(instanceBox(), first))
        assert.isFalse(boxesMeet(instanceBox(), item))
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

  it.effect("keeps a member's paint, move and hiding as overrides, in the sidecar too, and still follows", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const id = yield* placed
        const [a = "", b = ""] = treeKeys([instance(id)!])
        const materialOf = (key: string) =>
          s().doc.map.items[s().doc.ids.indexOf(key)]?.meshComponents[0]?.materials[0]?.material
        // as the Paint tool does it
        s().beginPaintStroke()
        s().paintSlots([{ id: b, component: 0, slot: 0, material: "/Game/A/MI_Red.MI_Red" }])
        s().endPaintStroke()
        const red = materialOf(b)
        moveItem(a, 250)
        const wasA = xOf(a)
        const wasB = xOf(b)
        s().setItemFlag([a], "hidden", true)
        const overrides = [{ member: 0, transform: true, hidden: true }, { member: 1, paint: true }] as const
        assert.deepStrictEqual(instance(id)?.prefab?.overrides, overrides)

        // the definition moves both items, the first of which this instance moved itself
        disk.files.set(
          userPrefabFile("Bridge"),
          changedPrefab((json) => {
            json.items[0]!.transform.location = [-1500, 0, -250.5]
            json.items[1]!.transform.location[0] = 1500.25
          })
        )
        yield* checkPrefabs

        assert.strictEqual(instance(id)?.prefab?.hash, hashOf(USER))
        assert.lengthOf(notices("prefabInstancesEdited"), 0)
        assert.closeTo(xOf(a), wasA, 1e-6)
        assert.closeTo(xOf(b), wasB + 500, 0.01)
        assert.strictEqual(materialOf(b), red)
        assert.isTrue(s().doc.structure.items.get(a)?.hidden)
        assert.deepStrictEqual(instance(id)?.prefab?.overrides, overrides)

        yield* saveMapFile
        const node = decodeSidecar(disk.files.get(sidecarFile(MAP))).tree.find((n) => n.kind === "group")
        assert.deepStrictEqual(node?.kind === "group" ? node.prefab?.overrides : undefined, overrides)
      })
    ))

  it.effect("is one undo step, which a later look doesn't take back", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const { key, was } = yield* placedFirst
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
        editProperty(key)
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
        s().relinkInstances(s().tabId, [[id, undefined]])
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
        // its name, the placing and the update
        assert.lengthOf(parked.past.filter((step) => !step.selectionOnly), 3)
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

  it.effect("restoring a version writes it back, keeps the file it replaces, and instances follow", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const { key, was } = yield* placedFirst
        const platform = yield* Platform
        yield* platform.writePrefab({ ...USER, text: edited(400), replace: true })
        yield* checkPrefabs
        assert.notStrictEqual(xOf(key), was)
        assert.lengthOf(disk.prefabBackups, 1)

        yield* restorePrefabBackupEffect(disk.prefabBackups[0]!)
        assert.strictEqual(disk.files.get(userPrefabFile("Bridge")), PREFAB_TEXT)
        assert.strictEqual(xOf(key), was)
        assert.deepStrictEqual(disk.prefabBackups.map((b) => b.text), [edited(400), PREFAB_TEXT])
      })
    ))

  it.effect("restoring a deleted prefab lists it again", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* deletePrefabEffect(USER)
        assert.isUndefined(hashOf(USER))
        yield* restorePrefabBackupEffect(disk.prefabBackups[0]!)
        assert.isDefined(hashOf(USER))
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

  it.effect("says in one toast that Save updated the instances, and keeps them out of the notification centre", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* placed
        yield* placed
        yield* placed
        yield* openDefinition
        moveItem(s().doc.ids[0] ?? "", 300)
        yield* saveMapFile
        const [toast, ...others] = toastsOf("prefabSaved")
        assert.strictEqual(toast?.title, "3 instances updated")
        assert.strictEqual(toast?.body, "Saved the prefab Bridge")
        assert.lengthOf(others, 0)
        assert.lengthOf(notices("prefabInstancesUpdated"), 0)
      })
    ))

  it.effect("says it saved when no instance had to follow, and leaves an edited one to the notification centre", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const { key } = yield* placedFirst
        editProperty(key)
        yield* openDefinition
        moveItem(s().doc.ids[0] ?? "", 300)
        yield* saveMapFile
        assert.strictEqual(toastsOf("prefabSaved")[0]?.title, "Saved the prefab Bridge")
        assert.lengthOf(notices("prefabInstancesEdited"), 1)
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
        assert.include(error.message, "at least 2 items")
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

describe("a new prefab", () => {
  /** `started`, in the desktop app, where the project tier is. */
  const startedWithProjects = (disk: TestDisk) =>
    Effect.gen(function*() {
      yield* started(disk)
      s().setCapabilities({ ...s().capabilities, projects: true })
    })
  afterEach(() => s().setCapabilities({ ...s().capabilities, projects: false }))
  const placeTwoCubes = () => {
    s().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 9000 }))
    s().placePiece(cube, placementTransform(cube, { x: 400, y: 0, z: 9000 }))
  }

  it.effect("opens an empty, blank tab in the project tier and writes nothing", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        yield* newPrefabEffect
        assert.strictEqual(tabLabelOf(s()), "Untitled prefab")
        assert.deepInclude(s().document, { kind: "prefab", tier: "project", name: "Untitled prefab" })
        assert.lengthOf(s().doc.map.items, 0)
        assert.lengthOf(s().tabIds, 2)
        assert.isTrue(isBlankTab(s()))
        assert.isFalse(isUnsavedTab(s()))
        assert.isFalse([...disk.files.keys()].some((name) => name.includes("Untitled")))

        yield* newPrefabEffect
        assert.strictEqual(tabLabelOf(s()), "Untitled prefab 2")
      })
    ))

  it.effect("holds Save back until it has 2 items, then asks for a name before it writes anything", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        yield* newPrefabEffect
        assert.include(saveProblemOf(s()), "at least 2 items")
        s().placePiece(cube, placementTransform(cube, { x: 0, y: 0, z: 9000 }))
        assert.isTrue(s().dirty)
        const error = yield* Effect.flip(saveMapFile)
        assert.include(error.message, "at least 2 items")
        assert.isNull(s().dialog)
        assert.isTrue(s().dirty)

        s().placePiece(cube, placementTransform(cube, { x: 400, y: 0, z: 9000 }))
        assert.isNull(saveProblemOf(s()))
        yield* saveMapFile
        assert.strictEqual(s().dialog?.id, "namePrefab")
        assert.isTrue(s().dirty)
        assert.isNull(s().file)
        assert.isFalse([...disk.files.keys()].some((name) => name.includes("/prefabs/Untitled")))
        assert.isFalse(disk.files.has(projectPrefabFile("Cube_pair")))
        assert.strictEqual(suggestNewPrefabName(s()), "Cube_pair")

        s().closeDialog()
        yield* saveNewPrefabEffect("Twin_cubes")
        assert.isFalse(s().dirty)
        assert.isNotNull(s().file)
        assert.strictEqual(tabLabelOf(s()), "Twin_cubes")
        assert.deepInclude(s().document, { name: "Twin_cubes" })
        assert.isTrue(disk.files.has(projectPrefabFile("Twin_cubes")))
        assert.deepInclude(s().prefabs.find((p) => p.tier === "project"), { name: "Twin_cubes", itemCount: 2 })

        s().placePiece(cube, placementTransform(cube, { x: 800, y: 0, z: 9000 }))
        yield* saveMapFile
        assert.isNull(s().dialog)
        assert.deepInclude(s().prefabs.find((p) => p.name === "Twin_cubes"), { itemCount: 3 })
      })
    ))

  it.effect("suggests a name clear of what the tier has", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        disk.files.set(projectPrefabFile("Cube_pair"), PREFAB_TEXT)
        yield* checkPrefabs
        yield* newPrefabEffect
        assert.strictEqual(suggestNewPrefabName(s()), "Prefab")
        placeTwoCubes()
        assert.strictEqual(suggestNewPrefabName(s()), "Cube_pair_2")
      })
    ))

  it.effect("the unsaved-changes prompt's Save names it first, then closes the tab", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        yield* newPrefabEffect
        const { tabId } = s()
        placeTwoCubes()
        disk.promptAnswers.push("save")
        yield* closeTabEffect(tabId)
        assert.include(s().tabIds, tabId)
        const dialog = s().dialog
        assert.strictEqual(dialog?.id, "namePrefab")
        s().closeDialog()
        yield* saveNewPrefabEffect("Twin_cubes", dialog?.id === "namePrefab" ? dialog.afterSave : undefined)
        assert.isTrue(disk.files.has(projectPrefabFile("Twin_cubes")))
        assert.notInclude(s().tabIds, tabId)
      })
    ))

  it.effect("Close others names it first, with its tab active, then closes it and goes back to the kept tab", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        const keep = s().tabId
        yield* newPrefabEffect
        const prefabTab = s().tabId
        placeTwoCubes()
        disk.promptAnswers.push("save")
        yield* closeTabsBesideEffect(keep, [prefabTab])
        const dialog = s().dialog
        assert.strictEqual(dialog?.id, "namePrefab")
        assert.strictEqual(s().tabId, prefabTab)
        s().closeDialog()
        yield* saveNewPrefabEffect("Twin_cubes", dialog?.id === "namePrefab" ? dialog.afterSave : undefined)
        assert.isTrue(disk.files.has(projectPrefabFile("Twin_cubes")))
        assert.deepStrictEqual(s().tabIds, [keep])
        assert.strictEqual(s().tabId, keep)
      })
    ))

  it.effect("needs a project: Untitled Project has no tier to put it in", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        assert.isUndefined(newPrefabProblem(s()))
        const { project } = s()
        useEditor.setState({ project: project === null ? null : { ...project, current: null } })
        assert.strictEqual(newPrefabProblem(s()), PREFAB_NEEDS_PROJECT)
        const tabs = s().tabIds
        yield* newPrefabEffect
        assert.deepStrictEqual(s().tabIds, tabs)
        useEditor.setState({ project })
      })
    ))

  it.effect("opens from the project overview, as the first tab", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* startedWithProjects(disk)
        yield* closeTabEffect(s().tabId)
        assert.isTrue(noTabOpen(s()))
        yield* newPrefabEffect
        assert.lengthOf(s().tabIds, 1)
        assert.strictEqual(s().document.kind, "prefab")
      })
    ))
})

describe("with no tab open", () => {
  it.effect("opens a definition as the first tab, and places nothing", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* closeTabEffect(s().tabId)
        const error = yield* Effect.flip(placePrefabEffect(USER))
        assert.strictEqual(error.message, NO_TAB_OPEN)
        assert.lengthOf(s().tabIds, 0)

        yield* openPrefabEffect(USER)
        assert.lengthOf(s().tabIds, 1)
        assert.deepInclude(s().document, { kind: "prefab", name: "Bridge" })
      })
    ))

  it.effect("has no map to Export or Play", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* closeTabEffect(s().tabId)
        for (const effect of [exportToGameEffect, playEffect]) {
          const error = yield* Effect.flip(effect)
          assert.include(String(error), NO_TAB_OPEN)
        }
        assert.deepStrictEqual(disk.game.races, [])
      })
    ))
})

describe("the instances of a definition", () => {
  it.effect("selecting them takes in every instance a click could pick, whatever is entered, and nothing else", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        const first = yield* placed
        yield* placePrefabEffect(USER)
        const second = s().doc.structure.tree.flatMap((n) => n.kind === "group" && n.id !== first ? [n.id] : [])[0] ??
          ""
        s().placePiece(cube, placementTransform(cube, { x: 1000, y: 0, z: 5000 }))
        s().enterGroup(first)
        selectInstances(USER)
        assert.isNull(s().enteredGroupId)
        assert.sameMembers([...s().selectedIds], [...treeKeys([instance(first)!, instance(second)!])])
        // one with nothing a click could pick stays out, as from Select all
        s().setItemFlag(treeKeys([instance(second)!]), "locked", true)
        selectInstances(USER)
        assert.sameMembers([...s().selectedIds], [...treeKeys([instance(first)!])])
      })
    ))

  it.effect("are found in every open map, the ones behind other tabs too, and not in the definition's own tab", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        const mapTab = yield* started(disk)
        assert.deepStrictEqual(tabsUsingPrefab(s(), USER), [])
        yield* placed
        assert.deepStrictEqual(tabsUsingPrefab(s(), USER), [mapTab])
        yield* openDefinition
        assert.deepStrictEqual(tabsUsingPrefab(s(), USER), [mapTab])
        assert.deepStrictEqual(tabsUsingPrefab(s(), { tier: "project", name: "Bridge" }), [])
      })
    ))

  it.effect("are found in the project's maps by their sidecars, leaving out what won't read", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        yield* placed
        yield* saveMapFile
        const [map] = s().projectMaps
        assert.deepStrictEqual(yield* projectMapsUsingPrefabEffect(USER, s().projectMaps), [MAP])
        const arch = { tier: "user", name: "Arch" } as const
        assert.deepStrictEqual(yield* projectMapsUsingPrefabEffect(arch, s().projectMaps), [])
        const gone = { ...map!, fileName: "Map_LevelEditorMain&Gone_Isaac.balledit" }
        assert.deepStrictEqual(yield* projectMapsUsingPrefabEffect(USER, [gone]), [])
      })
    ))
})

describe("saving a selection as a prefab", () => {
  const placeCubes = () => {
    for (const x of [1000, 3000]) s().placePiece(cube, placementTransform(cube, { x, y: 0, z: 5000 }))
    s().select(s().doc.ids.slice(-2))
  }

  it.effect("suggests what the pieces read as, within the rule and clear of the names in use", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        placeCubes()
        const suggested = suggestPrefabName(s())
        assert.match(suggested, /^[A-Za-z0-9_-]+_pair$/)
        yield* saveSelectionAsPrefabEffect({ tier: "user", name: suggested }, false)
        assert.strictEqual(suggestPrefabName(s()), `${suggested}_2`)
      })
    ))

  it.effect("suggests the name of the group it is exactly, unless that was never given", () =>
    withDisk((disk) =>
      Effect.gen(function*() {
        yield* started(disk)
        placeCubes()
        const unnamed = suggestPrefabName(s())
        s().groupItems(s().selectedIds)
        assert.strictEqual(suggestPrefabName(s()), unnamed)
        s().renameGroup(s().doc.structure.tree.flatMap((n) => n.kind === "group" ? [n.id] : [])[0] ?? "", "Left pair")
        assert.strictEqual(suggestPrefabName(s()), "Left_pair")
      })
    ))

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
        assert.strictEqual(selectionPrefabProblem(s()), lone.message)
        s().select(s().doc.ids.slice(0, 2))
        const start = yield* Effect.flip(saveSelectionAsPrefabEffect({ tier: "user", name: "Pair" }, false))
        assert.strictEqual(start.message, "Player Start can't go in a prefab.")
        assert.strictEqual(selectionPrefabProblem(s()), start.message)
        s().select(s().doc.ids.slice(-2))
        assert.isUndefined(selectionPrefabProblem(s()))
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
