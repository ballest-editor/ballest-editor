import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { expectVec } from "../test/vec"
import { setPivots, setTransforms } from "./edits"
import { editTransform, fitEditTransform, withEditTransform } from "./editTransform"
import { identityTransform, newMapFile, playerStartItem } from "./factory"
import { writeFieldAbout } from "./groupTransform"
import type { Item } from "./MapFile"
import { localToWorld } from "./pivot"

const decalClass = (name: string) => `/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/Decals/${name}.${name}_C'`
const float = (propertyName: string, currentValue: number) => ({ propertyName, propertyType: "Float", currentValue })

const decal = (name = "BP_UGCCircuitDecal"): Item => ({
  ...playerStartItem(),
  actorToSpawn: decalClass(name),
  itemTransform: identityTransform({ x: 0, y: 0, z: 8000 }),
  floatProperties: [float("DecalWidth", 300), float("DecalHeight", 400), float("DecalDepth", 60)]
})
const sizeOf = (item: Item) => Object.fromEntries(item.floatProperties.map((p) => [p.propertyName, p.currentValue]))
const ORIGIN = { x: 0, y: 0, z: 0 }

describe("a decal's edit transform", () => {
  it("has its size as its scale: X height, Y width, Z depth", () => {
    assert.deepStrictEqual(editTransform(decal()).scale3D, { x: 400, y: 300, z: 60 })
    assert.deepStrictEqual(editTransform(decal("BP_UGCShapeDecal")).scale3D, { x: 400, y: 300, z: 60 })
  })

  it("falls back to the game's default size when the properties are absent", () => {
    assert.deepStrictEqual(editTransform({ ...decal(), floatProperties: [] }).scale3D, { x: 200, y: 200, z: 100 })
  })

  it("leaves other items alone", () => {
    const item = playerStartItem()
    assert.strictEqual(editTransform(item), item.itemTransform)
    const scaled = { ...item.itemTransform, scale3D: { x: 2, y: 3, z: 4 } }
    assert.strictEqual(fitEditTransform(item, scaled, ORIGIN), scaled)
    assert.deepStrictEqual(withEditTransform(item, scaled, ORIGIN).itemTransform.scale3D, scaled.scale3D)
  })
})

describe("writing a decal's edit transform", () => {
  const scaled = (x: number, y: number, z: number) => ({
    ...editTransform(decal()),
    scale3D: { x, y, z }
  })

  it("changes its size properties and keeps its own scale", () => {
    const next = withEditTransform(decal(), scaled(500, 600, 70), ORIGIN)
    assert.deepStrictEqual(sizeOf(next), { DecalWidth: 600, DecalHeight: 500, DecalDepth: 70 })
    assert.deepStrictEqual(next.itemTransform.scale3D, { x: 1, y: 1, z: 1 })
  })

  // The game's answers to these through its inspector's Scale field, on 0.4.1.
  it("holds an edited axis to the game's limits", () => {
    assert.deepStrictEqual(fitEditTransform(decal(), scaled(1e6, 1e6, 1e6), ORIGIN).scale3D, {
      x: 2000,
      y: 2000,
      z: 1000
    })
    assert.deepStrictEqual(fitEditTransform(decal(), scaled(-300, 2, 5), ORIGIN).scale3D, { x: 10, y: 10, z: 10 })
  })

  it("keeps the pivot in place when a limit stops the scale", () => {
    const top = { x: 0, y: 0, z: 0.5 }
    const t = { ...scaled(400, 300, 5000), translation: { x: 0, y: 0, z: 8030 - 2500 } }
    const fitted = fitEditTransform(decal(), t, top)
    assert.strictEqual(fitted.scale3D.z, 1000)
    expectVec(fitted.translation, { x: 0, y: 0, z: 8030 - 500 })
  })

  it("doesn't touch a size it didn't change, even out of range", () => {
    const big = { ...decal(), floatProperties: [float("DecalHeight", 3000)] }
    const moved = { ...editTransform(big), translation: { x: 10, y: 0, z: 0 } }
    const next = withEditTransform(big, moved, ORIGIN)
    assert.strictEqual(next.floatProperties, big.floatProperties)
    assert.deepStrictEqual(next.itemTransform.translation, { x: 10, y: 0, z: 0 })
  })

  it("adds the properties an item lacks", () => {
    const next = withEditTransform({ ...decal(), floatProperties: [] }, scaled(500, 200, 100), ORIGIN)
    assert.deepStrictEqual(sizeOf(next), { DecalHeight: 500, DecalWidth: 200, DecalDepth: 100 })
    assert.isTrue(next.floatProperties.every((p) => p.propertyType === "Float"))
  })
})

// What the game's inspector did to a decal of height 400, width 300 and depth 60 at z 8000.
describe("scaling a decal about its pivot", () => {
  const scaleTo = (local: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
    const before = editTransform(decal())
    const t = writeFieldAbout(before, "scale3D", { x, y, z }, local)
    return { t, pivotBefore: localToWorld(before, local), pivotAfter: localToWorld(t, local) }
  }

  it("moves the item and not the pivot: Top, depth 60 to 160", () => {
    const { pivotAfter, pivotBefore, t } = scaleTo({ x: 0, y: 0, z: 0.5 }, 400, 300, 160)
    expectVec(pivotBefore, { x: 0, y: 0, z: 8030 })
    expectVec(pivotAfter, pivotBefore)
    expectVec(t.translation, { x: 0, y: 0, z: 7950 })
  })

  it("moves the item and not the pivot: Back, height 400 to 800", () => {
    const { pivotAfter, pivotBefore, t } = scaleTo({ x: 0.5, y: 0, z: 0 }, 800, 300, 60)
    expectVec(pivotBefore, { x: 200, y: 0, z: 8000 })
    expectVec(pivotAfter, pivotBefore)
    expectVec(t.translation, { x: -200, y: 0, z: 8000 })
  })
})

describe("setTransforms on a decal", () => {
  const map = () => ({ ...newMapFile({ displayName: "A", creatorName: "B", createdAt: "" }), items: [decal()] })

  it("writes the size, and holds the item's pivot to the limits", () => {
    const top = { choice: "Top", localPosition: { x: 0, y: 0, z: 0.5 } }
    const t = { ...editTransform(decal()), translation: { x: 0, y: 0, z: 0 }, scale3D: { x: 400, y: 300, z: 5000 } }
    const next = Option.getOrThrow(setTransforms(setPivots(map(), [[0, top]]), [[0, t]]))
    const item = next.items[0]!
    assert.strictEqual(sizeOf(item)["DecalDepth"], 1000)
    expectVec(item.itemTransform.translation, { x: 0, y: 0, z: 2000 })
    assert.deepStrictEqual(item.itemTransform.scale3D, { x: 1, y: 1, z: 1 })
  })
})

// What the game did on 0.4.1: on load, and through its inspector's Scale field.
describe("an elevator's scale", () => {
  const elevator = (x: number, y: number, z: number): Item => ({
    ...playerStartItem(),
    actorToSpawn:
      "/Script/Engine.BlueprintGeneratedClass'/Game/LevelEditor/PackageAssets/BallestAssets/PhysicsProps/BP_Elevator.BP_Elevator_C'",
    itemTransform: { ...identityTransform({ x: 0, y: 0, z: 8000 }), scale3D: { x, y, z } }
  })
  const request = (item: Item, x: number, y: number, z: number, local = ORIGIN) =>
    fitEditTransform(item, writeFieldAbout(editTransform(item), "scale3D", { x, y, z }, local), local)
  const scale = (x: number, y: number, z: number) => ({ x, y, z })

  it("is read as the game loads it: X sets the size, Z is 1", () => {
    assert.deepStrictEqual(editTransform(elevator(1, 3, 1)).scale3D, scale(1, 1, 1))
    assert.deepStrictEqual(editTransform(elevator(0.5, 2, 1.5)).scale3D, scale(0.5, 0.5, 1))
    assert.deepStrictEqual(editTransform(elevator(-2, 1, 1)).scale3D, scale(-2, 2, 1))
    assert.deepStrictEqual(editTransform(elevator(100, 100, 100)).scale3D, scale(100, 100, 1))
  })

  it("follows the edited axis, or X when both changed", () => {
    assert.deepStrictEqual(request(elevator(1, 1, 1), 2, 1, 1).scale3D, scale(2, 2, 1))
    assert.deepStrictEqual(request(elevator(2, 2, 1), 2, 3, 1).scale3D, scale(3, 3, 1))
    assert.deepStrictEqual(request(elevator(3, 3, 1), 1, 3, 1).scale3D, scale(1, 1, 1))
    assert.deepStrictEqual(request(elevator(2, 2, 1), 5, 7, 9).scale3D, scale(5, 5, 1))
  })

  it("keeps each axis's sign", () => {
    assert.deepStrictEqual(request(elevator(1, 1, 1), -3, 1, 1).scale3D, scale(-3, 3, 1))
    assert.deepStrictEqual(request(elevator(1, 1, 1), 1, -4, 1).scale3D, scale(4, -4, 1))
    assert.deepStrictEqual(request(elevator(1, 1, 1), -2, -2, 1).scale3D, scale(-2, -2, 1))
  })

  it("stops at 0.01 and has no upper limit", () => {
    assert.deepStrictEqual(request(elevator(1, 1, 1), 0.001, 0.001, 1).scale3D, scale(0.01, 0.01, 1))
    assert.deepStrictEqual(request(elevator(1, 1, 1), -0.001, -0.001, 1).scale3D, scale(-0.01, -0.01, 1))
    assert.deepStrictEqual(request(elevator(1, 1, 1), 1e6, 1e6, 1).scale3D, scale(1e6, 1e6, 1))
  })

  it("keeps the pivot through the minimum, moving the item", () => {
    const t = request(elevator(1, 1, 1), 0.001, 0.001, 1, { x: 150, y: 0, z: 0 })
    expectVec(t.translation, { x: 148.5, y: 0, z: 8000 })
  })

  it("moves the item for the scale asked for, so a dropped Z or a linked axis slides the pivot", () => {
    const top = { x: 0, y: 0, z: 8.9602 }
    const dropped = request(elevator(1, 1, 1), 2, 2, 3, top)
    expectVec(dropped.translation, { x: 0, y: 0, z: 7982.0796 })
    assert.deepStrictEqual(dropped.scale3D, scale(2, 2, 1))
    const right = { x: 0, y: 150, z: -0.0157 }
    const linked = request(elevator(1, 1, 1), 3, 1, 1, right)
    expectVec(linked.translation, { x: 0, y: 0, z: 8000 })
    expectVec(localToWorld(linked, right), { x: 0, y: 450, z: 7999.9843 })
  })

  it("is written to the item's own scale", () => {
    const item = elevator(1, 1, 1)
    const t = { ...editTransform(item), scale3D: scale(2, 1, 1) }
    assert.deepStrictEqual(withEditTransform(item, t, ORIGIN).itemTransform.scale3D, scale(2, 2, 1))
  })
})
