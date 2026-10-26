import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { addItem, removeItems, setLevelNames, setTransform, setTranslation, validateItem } from "./edits"
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

  it("validates translations", () => {
    const map = withItems(2)
    const moved = setTranslation(map, 1, { x: 5, y: 6, z: 7 })
    assert.isTrue(Option.isSome(moved))
    assert.deepStrictEqual(Option.getOrThrow(moved).items[1]!.itemTransform.translation, { x: 5, y: 6, z: 7 })
    assert.strictEqual(Option.getOrThrow(moved).items[0], map.items[0]) // structural sharing
    assert.isTrue(Option.isNone(setTranslation(map, 1, { x: Number.NaN, y: 0, z: 0 })))
    assert.isTrue(Option.isNone(setTranslation(map, 9, { x: 0, y: 0, z: 0 })))
  })

  it("sets whole transforms, renormalizing rotation and rejecting bad input", () => {
    const map = withItems(2)
    const t = { translation: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 2, w: 0 }, scale3D: { x: 2, y: 2, z: 2 } }
    const out = Option.getOrThrow(setTransform(map, 1, t)).items[1]!.itemTransform
    assert.deepStrictEqual(out.rotation, { x: 0, y: 0, z: 1, w: 0 })
    assert.deepStrictEqual(out.scale3D, { x: 2, y: 2, z: 2 })
    assert.isTrue(Option.isNone(setTransform(map, 1, { ...t, rotation: { x: 0, y: 0, z: 0, w: 0 } })))
    assert.isTrue(Option.isNone(setTransform(map, 1, { ...t, scale3D: { x: Infinity, y: 1, z: 1 } })))
  })

  it("validates items and renames levels", () => {
    assert.isTrue(Option.isSome(validateItem(playerStartItem())))
    assert.isTrue(Option.isNone(validateItem({ actorToSpawn: 1 })))
    assert.strictEqual(setLevelNames(withItems(1), "X", "Y").worldSettings.levelData.userLevelName, "X_Y")
  })
})
