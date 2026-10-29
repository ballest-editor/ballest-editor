import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import {
  addItem,
  copyItems,
  duplicateItems,
  pasteItems,
  removeItems,
  setLevelNames,
  setTransforms,
  validateItem
} from "./edits"
import { identityTransform, newMapFile, playerStartItem } from "./factory"
import type { MapFile } from "./MapFile"

const withItems = (n: number): MapFile => {
  let map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
  for (let i = 1; i < n; i++) {
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
    // a published map has no editorState to keep pivots in
    const { editorState: _, ...published } = target
    assert.isUndefined(pasteItems(published, clip).editorState)
  })

  it("validates items and renames levels", () => {
    assert.isTrue(Option.isSome(validateItem(playerStartItem())))
    assert.isTrue(Option.isNone(validateItem({ actorToSpawn: 1 })))
    assert.strictEqual(setLevelNames(withItems(1), "X", "Y").worldSettings.levelData.userLevelName, "X_Y")
  })
})
