import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { listSamples, readCatalog, readSample } from "../test/samples"
import { indexCatalog } from "./Catalog"
import { addItem } from "./edits"
import { goalItem, newMapFile, playerStartItem } from "./factory"
import { LIMITS } from "./limits"
import { MapFile } from "./MapFile"
import { mapNameProblem, validateMap } from "./validateMap"

const catalog = indexCatalog(readCatalog())

const fresh = (): MapFile => newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })

const validated = (map: MapFile): MapFile => ({
  ...map,
  worldSettings: {
    ...map.worldSettings,
    levelData: { ...map.worldSettings.levelData, bValidated: true }
  }
})

const named = (map: MapFile, levelDisplayName: string, creatorName: string): MapFile => ({
  ...map,
  worldSettings: {
    ...map.worldSettings,
    levelData: { ...map.worldSettings.levelData, levelDisplayName, creatorName }
  }
})

// The samples the game won't open (`refusedInSamples` in gameRules.test.ts): one holds a piece 0.4.1 took out of the
// game, the other the three classes it saves but won't reload. A clean bill for either would lose the player's map.
const refusedSamples = new Map([["props probe", 1], ["hidden probe 2", 3]])

describe("validateMap", () => {
  it.each(listSamples().map((s) => [s.name, s] as const))("finds no errors the game wouldn't in %s", (name, sample) => {
    const map = Schema.decodeSync(Schema.fromJsonString(MapFile))(readSample(sample))
    const expected = [...refusedSamples].find(([refused]) => name.includes(refused))?.[1] ?? 0
    assert.strictEqual(validateMap(map, catalog).errors.length, expected)
  })

  it("passes a new map, but for the validation run it hasn't had", () => {
    assert.deepStrictEqual(validateMap(fresh(), catalog), {
      errors: [],
      warnings: ["Nobody has finished a validation run, so the map has no medal times."]
    })
    assert.deepStrictEqual(validateMap(validated(fresh()), catalog), { errors: [], warnings: [] })
  })

  it("needs one player start, and warns of no goal", () => {
    const map = validated(fresh())
    assert.deepStrictEqual(validateMap({ ...map, items: [goalItem()] }, catalog).errors, [
      "The game needs exactly one MP_PlayerStart; this map has 0."
    ])
    assert.deepStrictEqual(validateMap({ ...map, items: [playerStartItem()] }, catalog), {
      errors: [],
      warnings: ["The map has no goal, so Play in the in-game editor does nothing."]
    })
  })

  it("holds names to the file name's rule", () => {
    assert.deepStrictEqual(mapNameProblem(" Big Loop ", "Isaac"), Option.none())
    assert.deepStrictEqual(mapNameProblem("Big Loop", " "), Option.some("Map name and creator are required."))
    assert.deepStrictEqual(
      validateMap(named(fresh(), "Big_Loop", "B"), catalog).errors,
      ["Map name and creator: letters, digits and spaces only (they become the file name)."]
    )
  })

  it("warns when the saved level name has drifted from the name and creator", () => {
    const map = named(validated(fresh()), "C", "B")
    assert.deepStrictEqual(validateMap(map, catalog).warnings, [
      "The level is saved as \"A_B\", which doesn't match its name and creator."
    ])
  })

  it("warns of a piece exactly on top of a copy of itself", () => {
    const map = validated(fresh())
    const goal = map.items[1]!
    assert.deepStrictEqual(validateMap(addItem(map, goal), catalog).warnings, [
      "Item 2 is a copy of item 1 in the same place."
    ])
    const moved = { ...goal, itemTransform: { ...goal.itemTransform, translation: { x: 1, y: 0, z: 0 } } }
    assert.deepStrictEqual(validateMap(addItem(map, moved), catalog).warnings, [])
  })

  it("counts the limits", () => {
    const map = validated(fresh())
    const items = Array.from({ length: LIMITS.itemsPerLevel + 1 }, () => map.items[1]!)
    assert.include(
      validateMap({ ...map, items }, null).errors.join(" "),
      `The map has ${items.length} items (maximum ${LIMITS.itemsPerLevel}).`
    )
  })

  it("counts the file's characters, as the game does", () => {
    const map = validated(fresh())
    const currentValue = "x".repeat(1_000_000)
    const items = Array.from({ length: 68 }, () => ({
      ...map.items[1]!,
      stringProperties: [{ currentValue, propertyName: "A", propertyType: "String" }]
    }))
    assert.match(validateMap({ ...map, items }, null).errors.at(-1) ?? "", /^The map's file has \d+ characters/)
  })
})
