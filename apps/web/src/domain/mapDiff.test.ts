import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { listSamples, readSample } from "../test/samples"
import { defaultEditorState, identityTransform, newMapFile, playerStartItem } from "./factory"
import { diffMaps, itemCountOf, mapDiffLabelOf, type MapVersion, withPivotsOf } from "./mapDiff"
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

const NOTHING = { added: 0, removed: 0, moved: 0, edited: 0, settings: false, pivots: false }

describe("diffMaps", () => {
  it("counts an item's paint or properties apart from its transform", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const faster: Item = {
      ...at(0),
      floatProperties: [{ currentValue: 2, propertyName: "speed", propertyType: "float" }]
    }
    assert.deepStrictEqual(diffMaps(before, versionOf([faster, at(100)], ["a", "b"])), { ...NOTHING, edited: 1 })
  })

  it("leaves out what every save in the game rewrites, and tells a setting the player changed", () => {
    const version = versionOf([at(0)], ["a"])
    const { worldSettings } = version.map
    const after = (changed: Partial<MapFile["worldSettings"]>) => ({
      ...version,
      map: { ...version.map, worldSettings: { ...worldSettings, ...changed } }
    })
    // measured: an in-game save with no edits, docs/qa/save-roundtrip.md
    const saved = after({
      metaData: [],
      directionalLightAngle: 131.26651,
      directionalLight: {
        ...worldSettings.directionalLight,
        timeOfDay: worldSettings.directionalLight.timeOfDay + 0.0000019
      },
      levelData: { ...worldSettings.levelData, createdAt: "2026.11.06-20.12.41" }
    })
    assert.deepStrictEqual(diffMaps(version, saved), NOTHING)
    const brighter = after({ directionalLight: { ...worldSettings.directionalLight, timeOfDay: 3.5 } })
    assert.deepStrictEqual(diffMaps(version, brighter), { ...NOTHING, settings: true })
  })

  it("tells pivots the game's version doesn't have: every save there drops them", () => {
    const version = versionOf([at(0)], ["a"])
    const pivot = { itemIndex: 0, pivot: { choice: "Center", localPosition: { x: 0, y: 0, z: 50 } } }
    const withPivot = {
      ...version,
      map: { ...version.map, editorState: { ...defaultEditorState(), pivots: [pivot] } }
    }
    const { editorState: _dropped, ...saved } = version.map
    assert.deepStrictEqual(diffMaps(withPivot, { ...version, map: saved }), { ...NOTHING, pivots: true })
    assert.deepStrictEqual(diffMaps(version, { ...version, map: saved }), NOTHING)
  })

  it("carries pivots to the items of the same key, wherever they are now, and leaves the rest behind", () => {
    const pivotOn = (itemIndex: number) => ({
      itemIndex,
      pivot: { choice: "Center", localPosition: { x: 0, y: 0, z: 50 } }
    })
    const before = versionOf([at(0), at(100), at(200)], ["a", "b", "c"])
    const from = {
      ...before,
      map: { ...before.map, editorState: { ...defaultEditorState(), pivots: [pivotOn(0), pivotOn(2)] } }
    }
    const { editorState: _dropped, ...saved } = versionOf([at(200), at(50)], ["c", "a"]).map
    const carried = withPivotsOf(from, { map: saved, ids: ["c", "a"] })
    assert.deepStrictEqual(carried.map.editorState?.pivots, [pivotOn(1), pivotOn(0)])
    const gone = withPivotsOf(from, { map: saved, ids: ["c", "z"] })
    assert.deepStrictEqual(gone.map.editorState?.pivots, [pivotOn(0)])
    assert.isTrue(diffMaps(from, gone).pivots)
    // nothing to carry
    assert.strictEqual(withPivotsOf(before, before), before)
  })

  it("gives two items of one fingerprint a pivot each, in order", () => {
    const pivotOn = (itemIndex: number, choice: string) => ({
      itemIndex,
      pivot: { choice, localPosition: { x: 0, y: 0, z: 0 } }
    })
    const twins = versionOf([at(0), at(0)], ["a", "b"])
    const from = {
      ...twins,
      map: { ...twins.map, editorState: { ...defaultEditorState(), pivots: [pivotOn(0, "Top"), pivotOn(1, "Bottom")] } }
    }
    const carried = withPivotsOf(from, unkeyed([at(0), at(0)]))
    assert.deepStrictEqual(carried.map.editorState?.pivots, [pivotOn(0, "Top"), pivotOn(1, "Bottom")])
  })

  it("doesn't count a pivot that only followed its item to another index", () => {
    const pivotOn = (itemIndex: number) => ({
      itemIndex,
      pivot: { choice: "Center", localPosition: { x: 0, y: 0, z: 0 } }
    })
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const from = { ...before, map: { ...before.map, editorState: { ...defaultEditorState(), pivots: [pivotOn(0)] } } }
    const moved = versionOf([at(100), at(0)], ["b", "a"])
    const carried = withPivotsOf(from, moved)
    assert.deepStrictEqual(carried.map.editorState?.pivots, [pivotOn(1)])
    assert.deepStrictEqual(diffMaps(from, carried), NOTHING)
  })

  it("doesn't take the last digits a save moves in a rotation for a move", () => {
    const quarter = turned(at(0))
    const { rotation } = quarter.itemTransform
    const nudged: Item = {
      ...quarter,
      itemTransform: {
        ...quarter.itemTransform,
        rotation: { ...rotation, w: rotation.w + 2e-16, z: rotation.z - 2e-16 }
      }
    }
    assert.deepStrictEqual(diffMaps(versionOf([quarter], ["a"]), versionOf([nudged], ["a"])), NOTHING)
  })

  it("finds nothing between a version and itself", () => {
    const version = versionOf([at(0), at(100)], ["a", "b"])
    assert.deepStrictEqual(diffMaps(version, version), NOTHING)
  })

  it("counts what the stable keys say was added, removed and moved", () => {
    const before = versionOf([at(0), at(100), at(200), at(300)], ["a", "b", "c", "d"])
    const after = versionOf([at(0), at(150), at(250), at(400), at(500), at(600)], ["a", "b", "c", "e", "f", "g"])
    assert.deepStrictEqual(diffMaps(before, after), { ...NOTHING, added: 3, removed: 1, moved: 2 })
  })

  it("follows a key through a change of order", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const after = versionOf([at(100), at(0)], ["b", "a"])
    assert.deepStrictEqual(diffMaps(before, after), { ...NOTHING, added: 0, removed: 0, moved: 0 })
  })

  it("counts a turn as a move, and doesn't count a difference under the fingerprint's rounding", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const after = versionOf([turned(at(0)), at(100.001)], ["a", "b"])
    assert.deepStrictEqual(diffMaps(before, after), { ...NOTHING, added: 0, removed: 0, moved: 1 })
  })

  it("counts a key whose item changed class as a new item", () => {
    const before = versionOf([at(0)], ["a"])
    const after = versionOf([ofClass(at(0), "/Game/Other.Other_C")], ["a"])
    assert.deepStrictEqual(diffMaps(before, after), { ...NOTHING, added: 1, removed: 1, moved: 0 })
  })

  it("pairs what no key pairs by class and position, so a map without a sidecar still compares", () => {
    const before = unkeyed([at(0), at(100), at(200)])
    assert.deepStrictEqual(diffMaps(before, unkeyed([at(200), at(0), at(100)])), {
      ...NOTHING,
      added: 0,
      removed: 0,
      moved: 0
    })
    assert.deepStrictEqual(diffMaps(before, unkeyed([at(0), at(100), at(200), at(300)])), { ...NOTHING, added: 1 })
    assert.deepStrictEqual(diffMaps(before, unkeyed([at(0), turned(at(100)), at(200)])), { ...NOTHING, moved: 1 })
  })

  it("without a key, an item that left its place is one removed and one added", () => {
    assert.deepStrictEqual(diffMaps(unkeyed([at(0)]), unkeyed([at(50)])), {
      ...NOTHING,
      added: 1,
      removed: 1,
      moved: 0
    })
  })

  it("doesn't take two items stacked in one place for each other", () => {
    const stacked = [at(0), turned(at(0))]
    assert.deepStrictEqual(diffMaps(unkeyed(stacked), unkeyed(stacked.toReversed())), NOTHING)
  })

  it("mixes the two: keys first, then places", () => {
    const before = versionOf([at(0), at(100)], ["a", "b"])
    const after = versionOf([at(10), at(100)], ["a", "fresh"])
    assert.deepStrictEqual(diffMaps(before, after), { ...NOTHING, added: 0, removed: 0, moved: 1 })
  })

  it.each(listSamples().map((sample) => [sample.name, sample] as const))("finds no change in %s", (_, sample) => {
    const { items } = decodeMap(readSample(sample))
    assert.deepStrictEqual(diffMaps(unkeyed(items), unkeyed(items.toReversed())), {
      ...NOTHING,
      added: 0,
      removed: 0,
      moved: 0
    })
  })
})

describe("mapDiffLabelOf", () => {
  it("says each count, leaving out what didn't happen", () => {
    assert.strictEqual(mapDiffLabelOf({ ...NOTHING, added: 2, removed: 1, moved: 3 }), "+2 items · −1 item · 3 moved")
    assert.strictEqual(mapDiffLabelOf({ ...NOTHING, added: 1, removed: 0, moved: 0 }), "+1 item")
    assert.strictEqual(mapDiffLabelOf({ ...NOTHING, added: 0, removed: 4, moved: 1 }), "−4 items · 1 moved")
    assert.strictEqual(mapDiffLabelOf({ ...NOTHING, edited: 2, settings: true }), "2 edited · Settings changed")
    assert.strictEqual(mapDiffLabelOf({ ...NOTHING, pivots: true }), "Pivots changed")
    assert.strictEqual(mapDiffLabelOf(NOTHING), "No items or settings changed")
  })
})

describe("itemCountOf", () => {
  it("is singular for one", () => {
    assert.strictEqual(itemCountOf(1), "1 item")
    assert.strictEqual(itemCountOf(0), "0 items")
    assert.strictEqual(itemCountOf(12), "12 items")
  })
})
