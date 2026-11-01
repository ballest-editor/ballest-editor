import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import {
  addItem,
  asNewDraft,
  copyItems,
  duplicateItems,
  isNeverPublished,
  pasteItems,
  removeItems,
  setLevelNames,
  setSlotMaterials,
  setTransforms,
  validateItem
} from "./edits"
import { identityTransform, newMapFile, playerStartItem } from "./factory"
import type { MapFile } from "./MapFile"

const withItems = (n: number): MapFile => {
  // item i sits at x = i
  let map: MapFile = { ...newMapFile({ displayName: "A", creatorName: "B", createdAt: "" }), items: [] }
  for (let i = 0; i < n; i++) {
    map = addItem(map, { ...playerStartItem(), itemTransform: identityTransform({ x: i, y: 0, z: 0 }) })
  }
  return {
    ...map,
    editorState: {
      ...map.editorState!,
      pivots: [1, 3, 4].map((itemIndex) => ({
        itemIndex,
        pivot: { choice: "Bottom", localPosition: { x: itemIndex, y: 0, z: 0 } }
      }))
    }
  }
}

describe("edits", () => {
  it("removes items and remaps editorState pivots", () => {
    const map = removeItems(withItems(5), [1, 2])
    assert.deepStrictEqual(map.items.map((i) => i.itemTransform.translation.x), [0, 3, 4])
    // pivot for item 1 is dropped; 3 -> 1, 4 -> 2, and each still points at the same item
    assert.deepStrictEqual(map.editorState!.pivots.map((p) => [p.itemIndex, p.pivot.localPosition.x]), [[1, 3], [2, 4]])
  })

  it("sets whole transforms, renormalizing rotation and rejecting bad input", () => {
    const map = withItems(2)
    const t = { translation: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 2, w: 0 }, scale3D: { x: 2, y: 2, z: 2 } }
    const next = Option.getOrThrow(setTransforms(map, [[1, t]]))
    const out = next.items[1]!.itemTransform
    assert.deepStrictEqual(out.rotation, { x: 0, y: 0, z: 1, w: 0 })
    assert.deepStrictEqual(out.scale3D, { x: 2, y: 2, z: 2 })
    assert.strictEqual(next.items[0], map.items[0]) // structural sharing
    assert.isTrue(Option.isNone(setTransforms(map, [[1, { ...t, rotation: { x: 0, y: 0, z: 0, w: 0 } }]])))
    assert.isTrue(Option.isNone(setTransforms(map, [[1, { ...t, scale3D: { x: Infinity, y: 1, z: 1 } }]])))
    assert.isTrue(Option.isNone(setTransforms(map, [[9, t]])))
  })

  it("sets several transforms all or nothing", () => {
    const map = withItems(3)
    const at = (x: number) => ({ ...map.items[0]!.itemTransform, translation: { x, y: 0, z: 0 } })
    const next = Option.getOrThrow(setTransforms(map, [[1, at(10)], [2, at(20)]]))
    assert.deepStrictEqual(next.items.map((i) => i.itemTransform.translation.x), [0, 10, 20])
    const bad = { ...at(30), translation: { x: Number.NaN, y: 0, z: 0 } }
    assert.isTrue(Option.isNone(setTransforms(map, [[1, at(10)], [2, bad]])))
  })

  it("duplicates items and their pivots", () => {
    const map = withItems(5)
    const next = duplicateItems(map, [3, 2])
    assert.deepStrictEqual(next.items.map((i) => i.itemTransform.translation.x), [0, 1, 2, 3, 4, 3, 2])
    // item 3 had a pivot: its copy (index 5) gets one too; item 2 had none
    assert.deepStrictEqual(next.editorState!.pivots.map((p) => [p.itemIndex, p.pivot.localPosition.x]), [
      [1, 1],
      [3, 3],
      [4, 4],
      [5, 3]
    ])
    assert.strictEqual(duplicateItems(map, []), map)
  })

  it("sets material slots and keeps materialAssetPaths in step", () => {
    const map = withItems(2)
    const glossy = "/Game/Art/Materials/Environment/Materials/Instances/MI_Env_Glossy_Blue.MI_Env_Glossy_Blue"
    const next = Option.getOrThrow(setSlotMaterials(map, [{ index: 1, component: 0, slot: 0, material: glossy }]))
    const mesh = next.items[1]!.meshComponents[0]!
    // a bare object path is stored class-qualified, as the game writes it
    assert.deepStrictEqual(mesh.materials, [
      { material: `/Script/Engine.MaterialInstanceConstant'${glossy}'`, materialIndex: 0 }
    ])
    assert.deepStrictEqual(mesh.materialAssetPaths, [glossy])
    assert.strictEqual(next.items[0], map.items[0]) // structural sharing
    // painting it again changes nothing, and gives back the same map
    assert.strictEqual(
      Option.getOrThrow(setSlotMaterials(next, [{ index: 1, component: 0, slot: 0, material: glossy }])),
      next
    )
    // a slot the item didn't list yet is added in index order
    const added = Option.getOrThrow(setSlotMaterials(map, [{ index: 0, component: 0, slot: 1, material: glossy }]))
    assert.deepStrictEqual(added.items[0]!.meshComponents[0]!.materials.map((m) => m.materialIndex), [0, 1])
    assert.strictEqual(added.items[0]!.meshComponents[0]!.materialAssetPaths?.length, 2)
    // all or nothing
    assert.isTrue(Option.isNone(setSlotMaterials(map, [{ index: 9, component: 0, slot: 0, material: glossy }])))
    assert.isTrue(Option.isNone(setSlotMaterials(map, [
      { index: 0, component: 0, slot: 0, material: glossy },
      { index: 1, component: 3, slot: 0, material: glossy }
    ])))
  })

  it("copies items with their pivots and pastes them into another map", () => {
    const clip = copyItems(withItems(5), [4, 2, 9])
    assert.deepStrictEqual(clip.items.map((i) => i.itemTransform.translation.x), [4, 2])
    assert.deepStrictEqual(clip.pivots.map((p) => [p.itemIndex, p.pivot.localPosition.x]), [[0, 4]])

    const two = withItems(2)
    const target = { ...two, editorState: { ...two.editorState!, pivots: two.editorState!.pivots.slice(0, 1) } }
    const next = pasteItems(target, clip)
    assert.deepStrictEqual(next.items.map((i) => i.itemTransform.translation.x), [0, 1, 4, 2])
    assert.deepStrictEqual(next.editorState!.pivots.map((p) => [p.itemIndex, p.pivot.localPosition.x]), [
      [1, 1],
      [2, 4]
    ])
    assert.strictEqual(pasteItems(target, copyItems(target, [])), target)
    // a published map gets an editorState to keep the pivots in, but only when there are some
    const { editorState: _, ...published } = target
    assert.deepStrictEqual(pasteItems(published, clip).editorState?.pivots.map((p) => p.itemIndex), [2])
    assert.isUndefined(pasteItems(published, { ...clip, pivots: [] }).editorState)
  })

  it("validates items and renames levels", () => {
    assert.isTrue(Option.isSome(validateItem(playerStartItem())))
    assert.isTrue(Option.isNone(validateItem({ actorToSpawn: 1 })))
    assert.strictEqual(setLevelNames(withItems(1), "X", "Y").worldSettings.levelData.userLevelName, "X_Y")
  })

  it("makes a published map's draft a new one, which Play can race", () => {
    const map = withItems(2)
    const published = {
      ...map,
      worldSettings: {
        ...map.worldSettings,
        levelData: { ...map.worldSettings.levelData, levelPublishedFileId: 3561234567 }
      }
    }
    assert.isFalse(isNeverPublished(published.worldSettings.levelData.levelPublishedFileId))
    const draft = asNewDraft(published)
    assert.isTrue(isNeverPublished(draft.worldSettings.levelData.levelPublishedFileId))
    assert.strictEqual(draft.items, published.items)
    assert.isFalse(isNeverPublished(0))
  })
})
