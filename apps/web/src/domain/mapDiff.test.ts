import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { listSamples, readSample } from "../test/samples"
import { identityTransform, newMapFile, playerStartItem } from "./factory"
import { diffMaps, itemCountOf, mapDiffLabelOf, type MapVersion } from "./mapDiff"
import { type Item, MapFile } from "./MapFile"

const decodeMap = Schema.decodeUnknownSync(Schema.fromJsonString(MapFile))

const start = playerStartItem()
const at = (x: number, y = 0): Item => ({ ...start, itemTransform: identityTransform({ x, y, z: 0 }) })
const turned = (item: Item): Item => ({
  ...item,
  itemTransform: { ...item.itemTransform, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } }
})
const ofClass = (item: Item, actorToSpawn: string): Item => ({ ...item, actorToSpawn })

const versionOf = (items: ReadonlyArray<Item>, ids: ReadonlyArray<string>): MapVersion => ({
  map: { ...newMapFile({ displayName: "Test", creatorName: "me", createdAt: "" }), items },
  ids
})

/** A version with no keys in common with any other, as two loads of a map without a sidecar have. */
let loads = 0
const unkeyed = (items: ReadonlyArray<Item>) => {
  loads += 1
  return versionOf(items, items.map((_, index) => `load${loads}-${index}`))
}

describe("diffMaps", () => {
  it("finds nothing between a version and itself", () => {
    const version = versionOf([at(0), at(100)], ["a", "b"])
    assert.deepStrictEqual(diffMaps(version, version), { added: 0, removed: 0, moved: 0 })
  })

  it("counts what the stable keys say was added, removed and moved", () => {
    const before = versionOf([at(0), at(100), at(200), at(300)], ["a", "b", "c", "d"])
    const after = versionOf([at(0), at(150), at(250), at(400), at(500), at(600)], ["a", "b", "c", "e", "f", "g"])
    assert.deepStrictEqual(diffMaps(before, after), { added: 3, removed: 1, moved: 2 })
  })

  it("follows a key through a change of order", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const after = versionOf([at(100), at(0)], ["b", "a"])
    assert.deepStrictEqual(diffMaps(before, after), { added: 0, removed: 0, moved: 0 })
  })

  it("counts a turn as a move, and doesn't count a difference under the fingerprint's rounding", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const after = versionOf([turned(at(0)), at(100.001)], ["a", "b"])
    assert.deepStrictEqual(diffMaps(before, after), { added: 0, removed: 0, moved: 1 })
  })

  it("counts a key whose item changed class as a new item", () => {
    const before = versionOf([at(0)], ["a"])
    const after = versionOf([ofClass(at(0), "/Game/Other.Other_C")], ["a"])
    assert.deepStrictEqual(diffMaps(before, after), { added: 1, removed: 1, moved: 0 })
  })

  it("pairs what no key pairs by class and position, so a map without a sidecar still compares", () => {
    const before = unkeyed([at(0), at(100), at(200)])
    assert.deepStrictEqual(diffMaps(before, unkeyed([at(200), at(0), at(100)])), { added: 0, removed: 0, moved: 0 })
    assert.deepStrictEqual(diffMaps(before, unkeyed([at(0), at(100), at(200), at(300)])), {
      added: 1,
      removed: 0,
      moved: 0
    })
    assert.deepStrictEqual(diffMaps(before, unkeyed([at(0), turned(at(100)), at(200)])), {
      added: 0,
      removed: 0,
      moved: 1
    })
  })

  it("without a key, an item that left its place is one removed and one added", () => {
    assert.deepStrictEqual(diffMaps(unkeyed([at(0)]), unkeyed([at(50)])), { added: 1, removed: 1, moved: 0 })
  })

  it("doesn't take two items stacked in one place for each other", () => {
    const stacked = [at(0), turned(at(0))]
    assert.deepStrictEqual(diffMaps(unkeyed(stacked), unkeyed(stacked.toReversed())), {
      added: 0,
      removed: 0,
      moved: 0
    })
  })

  it("mixes the two: keys first, then places", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const after = versionOf([at(10), at(100)], ["a", "fresh"])
    assert.deepStrictEqual(diffMaps(before, after), { added: 0, removed: 0, moved: 1 })
  })

  it.each(listSamples().map((sample) => [sample.name, sample] as const))("finds no change in %s", (_, sample) => {
    const { items } = decodeMap(readSample(sample))
    assert.deepStrictEqual(diffMaps(unkeyed(items), unkeyed(items.toReversed())), { added: 0, removed: 0, moved: 0 })
  })
})

describe("mapDiffLabelOf", () => {
  it("says each count, leaving out what didn't happen", () => {
    assert.strictEqual(mapDiffLabelOf({ added: 2, removed: 1, moved: 3 }), "+2 items · −1 item · 3 moved")
    assert.strictEqual(mapDiffLabelOf({ added: 1, removed: 0, moved: 0 }), "+1 item")
    assert.strictEqual(mapDiffLabelOf({ added: 0, removed: 4, moved: 1 }), "−4 items · 1 moved")
    assert.strictEqual(mapDiffLabelOf({ added: 0, removed: 0, moved: 0 }), "No items added, removed or moved")
  })
})

describe("itemCountOf", () => {
  it("is singular for one", () => {
    assert.strictEqual(itemCountOf(1), "1 item")
    assert.strictEqual(itemCountOf(0), "0 items")
    assert.strictEqual(itemCountOf(12), "12 items")
  })
})
