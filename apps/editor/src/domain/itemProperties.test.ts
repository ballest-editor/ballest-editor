import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { CatalogPiece } from "./Catalog"
import { setProperty } from "./edits"
import { identityTransform, itemFromPiece, newMapFile } from "./factory"
import {
  defaultProperties,
  propertyLabel,
  selectionProperties,
  validPropertyValue,
  withProperty
} from "./itemProperties"
import { Item, type MapFile } from "./MapFile"

const decal = Schema.decodeSync(CatalogPiece)({
  classPath: "/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/Decals/BP_UGCCircuitDecal.BP_UGCCircuitDecal_C'",
  className: "BP_UGCCircuitDecal",
  meshAssetPath: null,
  materialSlots: [],
  bounds: null,
  properties: [
    { name: "DecalWidth", list: "floatProperties", type: "Float", default: 200, hidden: true },
    { name: "DecalStyle", list: "intProperties", type: "Integer", default: 0, hidden: false },
    { name: "bFacingOnly", list: "boolProperties", type: "Bool", default: true, hidden: false },
    // a native property the extractor couldn't type: never written or shown
    { name: "Mystery", list: null, type: null, default: null }
  ]
})

const placed = () => itemFromPiece(decal, identityTransform())
const width = { list: "floatProperties", name: "DecalWidth", type: "Float" } as const

const mapOf = (items: ReadonlyArray<Item>): MapFile => ({
  ...newMapFile({ displayName: "T", creatorName: "C", createdAt: "" }),
  items
})

describe("item properties", () => {
  it("places a piece with every exposed property at its default, as the game saves them", () => {
    const item = placed()
    assert.deepStrictEqual(defaultProperties(decal).floatProperties, [
      { currentValue: 200, propertyName: "DecalWidth", propertyType: "Float" }
    ])
    assert.deepStrictEqual(item.intProperties, [{
      currentValue: 0,
      propertyName: "DecalStyle",
      propertyType: "Integer"
    }])
    assert.deepStrictEqual(item.boolProperties, [{
      currentValue: true,
      propertyName: "bFacingOnly",
      propertyType: "Bool"
    }])
    assert.deepStrictEqual(item.textProperties, [])
    assert.doesNotThrow(() => Schema.decodeSync(Item)(item))
  })

  it("shows the catalog's properties in its order, defaults for missing ones, then the item's others", () => {
    const item: Item = {
      ...placed(),
      floatProperties: [{ currentValue: 1, propertyName: "Extra", propertyType: "Float" }],
      boolProperties: [{ currentValue: false, propertyName: "bFacingOnly", propertyType: "Bool" }]
    }
    const shown = selectionProperties([{ item, piece: decal }])
    assert.deepStrictEqual(shown.map((p) => [p.name, p.values, p.default, p.hidden]), [
      ["DecalWidth", [200], 200, true],
      ["DecalStyle", [0], 0, false],
      ["bFacingOnly", [false], true, false],
      ["Extra", [1], undefined, false]
    ])
    // without a catalog entry, only what the item stores, list by list
    assert.deepStrictEqual(selectionProperties([{ item, piece: undefined }]).map((p) => p.name), [
      "bFacingOnly",
      "Extra",
      "DecalStyle"
    ])
  })

  it("shows only the properties every selected item has, with each item's value", () => {
    const a = placed()
    const b = Option.getOrThrow(withProperty(placed(), width, 350))
    const other: Item = { ...placed(), actorToSpawn: "other", intProperties: [] }
    const shown = selectionProperties([{ item: a, piece: decal }, { item: b, piece: decal }, {
      item: other,
      piece: undefined
    }])
    assert.deepStrictEqual(shown.map((p) => [p.name, p.values]), [["DecalWidth", [200, 350, 200]], [
      "bFacingOnly",
      [true, true, true]
    ]])
  })

  it("sets a stored value in place, or adds the entry the item lacks", () => {
    const item = { ...placed(), floatProperties: [] }
    const added = Option.getOrThrow(withProperty(item, width, 12.5))
    assert.deepStrictEqual(added.floatProperties, [{
      currentValue: 12.5,
      propertyName: "DecalWidth",
      propertyType: "Float"
    }])
    const kept = {
      ...placed(),
      floatProperties: [{ currentValue: 1, propertyName: "DecalWidth", propertyType: "Float", x: 1 }]
    }
    assert.deepStrictEqual(Option.getOrThrow(withProperty(kept, width, 2)).floatProperties, [
      { currentValue: 2, propertyName: "DecalWidth", propertyType: "Float", x: 1 }
    ])
  })

  it("rejects values the game wouldn't load, all or nothing", () => {
    assert.isTrue(validPropertyValue("intProperties", 3))
    assert.isFalse(validPropertyValue("intProperties", 1.5))
    assert.isFalse(validPropertyValue("intProperties", 2 ** 31))
    assert.isFalse(validPropertyValue("floatProperties", Number.POSITIVE_INFINITY))
    assert.isFalse(validPropertyValue("boolProperties", 1))
    assert.isTrue(validPropertyValue("stringProperties", ""))
    const map = mapOf([placed(), placed()])
    assert.isTrue(Option.isNone(setProperty(map, [0, 1], width, Number.NaN)))
    assert.isTrue(Option.isNone(setProperty(map, [0, 5], width, 1)))
    const next = Option.getOrThrow(setProperty(map, [0, 1], width, 1))
    assert.deepStrictEqual(next.items.map((i) => i.floatProperties[0]?.currentValue), [1, 1])
    assert.strictEqual(map.items[0]!.floatProperties[0]!.currentValue, 200)
  })

  it("labels property names readably", () => {
    assert.strictEqual(propertyLabel("bFacingOnly"), "Facing Only")
    assert.strictEqual(propertyLabel("QualifiedAirflowTargetSpeed"), "Qualified Airflow Target Speed")
    assert.strictEqual(propertyLabel("Field Magnitude"), "Field Magnitude")
    assert.strictEqual(propertyLabel("bool"), "bool")
  })
})
