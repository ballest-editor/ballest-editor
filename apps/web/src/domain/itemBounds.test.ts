import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { expectVec } from "../test/vec"
import { Catalog, indexCatalog } from "./Catalog"
import { identityTransform, playerStartItem } from "./factory"
import { boxCentreOf, formatBoxSize, itemsBoxOf, placedBoxOf } from "./itemBounds"
import type { Item } from "./MapFile"
import { rotatorToQuat } from "./ueMath"

const CLASS = "/Script/Engine.BlueprintGeneratedClass'/Game/Test/BP_Slab.BP_Slab_C'"

const catalog = indexCatalog(
  Schema.decodeSync(Catalog)({
    pieces: [{
      classPath: CLASS,
      className: "BP_Slab",
      objectPath: "/Game/Test/BP_Slab.BP_Slab_C",
      meshAssetPath: "/Game/Test/SM_Slab.SM_Slab",
      glb: null,
      materialSlots: [],
      bounds: { min: [-100, -10, 0], max: [300, 10, 50] }
    }]
  })
)

const slab = (x = 0, y = 0, z = 0): Item => ({
  ...playerStartItem(),
  actorToSpawn: CLASS,
  meshComponents: [],
  itemTransform: identityTransform({ x, y, z })
})

/** A piece the catalog doesn't know, and with no mesh to ask about. */
const unknown = (x: number, y = 0, z = 0): Item => ({ ...slab(x, y, z), actorToSpawn: "/Game/Test/Gone.Gone_C" })

describe("itemsBoxOf", () => {
  it("has no box for no items", () => {
    assert.isUndefined(itemsBoxOf([], catalog))
  })

  it("goes round a piece's bounds, not its origin", () => {
    const box = itemsBoxOf([slab(1000)], catalog)
    assert.deepStrictEqual(box, { min: { x: 900, y: -10, z: 0 }, max: { x: 1300, y: 10, z: 50 } })
    expectVec(boxCentreOf(box!), { x: 1100, y: 0, z: 25 })
  })

  it("counts the corners of a turned and scaled piece", () => {
    const item = slab()
    const turned = {
      ...item,
      itemTransform: {
        ...item.itemTransform,
        rotation: { ...rotatorToQuat({ pitch: 0, yaw: 90, roll: 0 }) },
        scale3D: { x: 2, y: 1, z: 3 }
      }
    }
    const box = itemsBoxOf([turned], catalog)!
    expectVec(box.min, { x: -10, y: -200, z: 0 })
    expectVec(box.max, { x: 10, y: 600, z: 150 })
  })

  it("takes a piece with no bounds as its translation, beside one with bounds", () => {
    assert.deepStrictEqual(itemsBoxOf([unknown(50, 60, 70)], catalog), {
      min: { x: 50, y: 60, z: 70 },
      max: { x: 50, y: 60, z: 70 }
    })
    assert.deepStrictEqual(itemsBoxOf([slab(), unknown(500, 0, -40)], catalog), {
      min: { x: -100, y: -10, z: -40 },
      max: { x: 500, y: 10, z: 50 }
    })
  })

  it("takes every item as its translation with no catalog", () => {
    assert.deepStrictEqual(itemsBoxOf([slab(10), slab(30, 4)], null), {
      min: { x: 10, y: 0, z: 0 },
      max: { x: 30, y: 4, z: 0 }
    })
  })

  it("holds more items than a call has room for arguments", () => {
    const items = Array.from({ length: 100_000 }, (_, x) => slab(x))
    assert.strictEqual(itemsBoxOf(items, catalog)?.max.x, 99_999 + 300)
  })
})

describe("placedBoxOf", () => {
  it("goes by where an item stands, not where the document has it", () => {
    const item = slab()
    assert.strictEqual(
      placedBoxOf([{ item, transform: identityTransform({ x: 5000, y: 0, z: 0 }) }], catalog)?.min.x,
      4900
    )
  })
})

describe("formatBoxSize", () => {
  it("gives a box's size in metres, to a decimal", () => {
    const box = { min: { x: -620, y: 10, z: 0 }, max: { x: 620, y: 320, z: 200 } }
    assert.strictEqual(formatBoxSize(box), "12.4 × 3.1 × 2.0 m")
  })
})
