import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../../domain/bundledCatalog.json"
import { Catalog, indexCatalog } from "../../domain/Catalog"
import type { Vec3 } from "../../domain/coords"
import { placementTransform } from "../../domain/factory"
import { boxCentreOf, itemsBoxOf } from "../../domain/itemBounds"
import { isPlayerStart } from "../../domain/MapFile"
import { mapOfPrefab, PREFAB_TAB_FRAME, prefabOfItems } from "../../domain/prefab"
import { defaultSettings } from "../../domain/Settings"
import { vecSub } from "../../domain/ueMath"
import { sceneRegistry } from "../sceneRegistry"
import { initialMap, type PrefabDocument, selectedIndices, useEditor } from "../store"
import { pasteClipboard } from "./paste"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
const cube = catalog.pieces.find((p) => p.className === "BP_Prim_Cube")!

/** Where the active pane puts a placement. */
const AIM: Vec3 = { x: 3000, y: -2000, z: 500 }

const s = () => useEditor.getState()
const startOnlyMap = () => {
  const map = initialMap()
  return { ...map, items: map.items.filter(isPlayerStart) }
}
const place = (at: Vec3) => {
  s().placePiece(cube, placementTransform(cube, at))
  return s().doc.ids.at(-1)!
}
const translationOf = (id: string) => s().doc.map.items[s().doc.ids.indexOf(id)]!.itemTransform.translation
const pastedBox = () => itemsBoxOf(selectedIndices(s()).map((i) => s().doc.map.items[i]!), s().catalogIndex)!
const gridSize = () => s().settings.snapping.gridSize

/** Two cubes far from where the view looks, copied: their ids. */
const copiedCubes = () => {
  const ids = [place({ x: 40_000, y: 10_000, z: 2000 }), place({ x: 40_400, y: 10_000, z: 2000 })]
  s().select(ids)
  s().copySelection()
  return ids
}

const openMapTab = () => s().loadMap(startOnlyMap(), null, undefined, { into: "addedTab" })
const openPrefabTab = () => {
  const file = prefabOfItems([], s().catalogIndex)
  const document: PrefabDocument = { kind: "prefab", tier: "user", name: "Prefab", file, hash: "", sources: new Map() }
  s().loadMap(mapOfPrefab("Prefab", file, s().catalogIndex), null, undefined, {
    document,
    fresh: true,
    into: "addedTab"
  })
}

/** How far apart the pasted items are, first to each: a re-placed paste keeps its shape. */
const spacing = (ids: ReadonlyArray<string>) => ids.map((id) => vecSub(translationOf(id), translationOf(ids[0]!)))

describe("pasteClipboard", () => {
  beforeEach(() => {
    useEditor.setState({ catalogIndex: indexCatalog(catalog), settings: defaultSettings, clipboard: null })
    s().loadMap(startOnlyMap(), null)
    sceneRegistry.placementPoint = () => AIM
  })

  it("pastes where the items were copied in the tab they came from", () => {
    const ids = copiedCubes()
    pasteClipboard()
    assert.deepStrictEqual(s().selectedIds.map(translationOf), ids.map(translationOf))
  })

  it("pastes a cut back where it was, in the tab it was cut from", () => {
    const ids = copiedCubes()
    const before = ids.map(translationOf)
    s().cutSelection()
    pasteClipboard()
    assert.deepStrictEqual(s().selectedIds.map(translationOf), before)
  })

  it("re-places a paste into another map where the view puts a placement, keeping its shape and the grid", () => {
    const ids = copiedCubes()
    const shape = spacing(ids)
    openMapTab()
    pasteClipboard()
    const pasted = s().selectedIds
    assert.strictEqual(pasted.length, 2)
    assert.deepStrictEqual(spacing(pasted), shape)
    const box = pastedBox()
    const centre = boxCentreOf(box)
    // standing on the point, centred over it to within half a grid step, which keeps grid-aligned items on the grid
    assert.strictEqual(box.min.z, AIM.z)
    assert.isAtMost(Math.abs(centre.x - AIM.x), gridSize() / 2)
    assert.isAtMost(Math.abs(centre.y - AIM.y), gridSize() / 2)
    const moved = vecSub(translationOf(pasted[0]!), { x: 40_000, y: 10_000, z: 2000 })
    assert.strictEqual(moved.x % gridSize(), 0)
    assert.strictEqual(moved.y % gridSize(), 0)
  })

  it("centres a paste into a prefab's tab on the prefab's origin", () => {
    const ids = copiedCubes()
    const shape = spacing(ids)
    openPrefabTab()
    pasteClipboard()
    assert.deepStrictEqual(spacing(s().selectedIds), shape)
    const centre = boxCentreOf(pastedBox())
    for (const axis of ["x", "y", "z"] as const) {
      assert.isAtMost(Math.abs(centre[axis] - PREFAB_TAB_FRAME[axis]), gridSize() / 2)
    }
  })

  it("re-places a paste from a prefab's tab into a map", () => {
    openPrefabTab()
    const ids = [place(PREFAB_TAB_FRAME)]
    s().select(ids)
    s().copySelection()
    openMapTab()
    pasteClipboard()
    assert.strictEqual(pastedBox().min.z, AIM.z)
  })

  it("takes a group's Point pivot along with a re-placed paste", () => {
    const ids = copiedCubes()
    const group = s().groupItems(ids, "G")!
    s().setGroupPivot(group, { choice: "point", world: { x: 40_200, y: 10_000, z: 2500 } })
    s().select(ids)
    s().copySelection()
    const source = translationOf(ids[0]!)
    openMapTab()
    pasteClipboard()
    const [first] = s().selectedIds
    const offset = vecSub(translationOf(first!), source)
    const copy = s().doc.structure.tree.find((node) => node.kind === "group")
    assert.deepStrictEqual(copy?.pivot, {
      choice: "point",
      world: { x: 40_200 + offset.x, y: 10_000 + offset.y, z: 2500 + offset.z }
    })
  })
})
