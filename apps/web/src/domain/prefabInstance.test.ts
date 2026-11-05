import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { changedPrefab, PREFAB_TEXT } from "../test/prefabs"
import fixture from "./bundledCatalog.json"
import { Catalog, indexCatalog } from "./Catalog"
import type { UeTransform } from "./coords"
import { setSlotMaterials, setTransforms } from "./edits"
import { editTransform } from "./editTransform"
import { newMapFile } from "./factory"
import { applyGroupDelta, type GroupDelta } from "./groupTransform"
import { itemOfPrefab } from "./prefab"
import { PrefabFile } from "./PrefabFile"
import { checkInstance, definitionOf, type DocParts, instancesIn, withUpdatedInstance } from "./prefabInstance"
import { findGroup, flatStructure, freshKeys, type Structure, treeKeys, withGroup, withPrefabLink } from "./structure"
import { rotatorToQuat } from "./ueMath"

const catalog = indexCatalog(Schema.decodeUnknownSync(Catalog)(fixture))
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(PrefabFile))
const prefab = decode(PREFAB_TEXT)
const HASH = "a".repeat(64)
const NEW_HASH = "b".repeat(64)
const definition = definitionOf(prefab, { tier: "user", name: "Bridge", hash: HASH }, catalog)

const FRAME = { x: 3000, y: -2000, z: 8000 }
const GROUP = "instance"

/** A map holding one loose item, then an instance of the fixture. */
const placedDoc = (): DocParts => {
  const map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
  const [start] = map.items
  const items = prefab.items.map((item) => itemOfPrefab(item, FRAME, catalog))
  const startKeys = freshKeys(1)
  const keys = freshKeys(items.length)
  const structure = withPrefabLink(
    withGroup(flatStructure([...startKeys, ...keys]), keys, GROUP, "Bridge")!,
    GROUP,
    definition.link
  )!
  return { map: { ...map, items: [start!, ...items] }, ids: [...startKeys, ...keys], structure }
}

const groupOf = (doc: DocParts) => findGroup(doc.structure.tree, GROUP)!
const check = (doc: DocParts) => checkInstance(doc, groupOf(doc), groupOf(doc).prefab!)
const instanceKeys = (doc: DocParts) => treeKeys([groupOf(doc)])

/** `doc` with `delta` applied to the instance's items about `pivot`, as a gizmo drag on the whole group would. */
const withDelta = (doc: DocParts, delta: GroupDelta, pivot = FRAME): DocParts => {
  const entries = instanceKeys(doc).map((key) => {
    const index = doc.ids.indexOf(key)
    return [index, applyGroupDelta(editTransform(doc.map.items[index]!), pivot, delta)] as const
  })
  return { ...doc, map: Option.getOrThrow(setTransforms(doc.map, entries)) }
}

const moved = (doc: DocParts, key: string, by: number): DocParts => {
  const index = doc.ids.indexOf(key)
  const t: UeTransform = editTransform(doc.map.items[index]!)
  const next = { ...t, translation: { ...t.translation, x: t.translation.x + by } }
  return { ...doc, map: Option.getOrThrow(setTransforms(doc.map, [[index, next]])) }
}

describe("whether an instance is unmodified", () => {
  it("is as placed", () => assert.isTrue(check(placedDoc()).unmodified))

  it("allows moving, turning and scaling the whole group", () => {
    const doc = placedDoc()
    assert.isTrue(check(withDelta(doc, { kind: "translate", offset: { x: 500, y: 12.5, z: -3 } })).unmodified)
    const turn = rotatorToQuat({ pitch: 12, yaw: 33, roll: -71 })
    assert.isTrue(check(withDelta(doc, { kind: "rotate", rotation: turn })).unmodified)
    assert.isTrue(check(withDelta(doc, { kind: "scale", factor: 2.5 })).unmodified)
    assert.isTrue(check(withDelta(doc, { kind: "scale", factor: 0.5, axis: "y" })).unmodified)
  })

  it("allows them together, in any order", () => {
    const turn = rotatorToQuat({ pitch: 0, yaw: 90, roll: 0 })
    const a = withDelta(placedDoc(), { kind: "rotate", rotation: turn })
    const b = withDelta(a, { kind: "scale", factor: 3 })
    const c = withDelta(b, { kind: "translate", offset: { x: 1000, y: 0, z: 0 } })
    assert.isTrue(check(c).unmodified)
  })

  it("allows the game's scale, which spreads the items too", () => {
    const doc = placedDoc()
    const entries = instanceKeys(doc).map((key) => {
      const index = doc.ids.indexOf(key)
      const t = editTransform(doc.map.items[index]!)
      const stretch = (value: number, from: number) => from + (value - from) * 2
      return [index, {
        ...t,
        translation: {
          x: stretch(t.translation.x, FRAME.x),
          y: stretch(t.translation.y, FRAME.y),
          z: stretch(t.translation.z, FRAME.z)
        },
        scale3D: { x: t.scale3D.x * 2, y: t.scale3D.y * 2, z: t.scale3D.z * 2 }
      }] as const
    })
    assert.isTrue(check({ ...doc, map: Option.getOrThrow(setTransforms(doc.map, entries)) }).unmodified)
  })

  it("survives the group being renamed and tagged, and items reordered in the outline", () => {
    const doc = placedDoc()
    const [a, b] = instanceKeys(doc)
    const tree = doc.structure.tree.map((node) =>
      node.kind === "group"
        ? { ...node, name: "Other", children: [{ kind: "item", key: b! }, { kind: "item", key: a! }] as const }
        : node
    )
    assert.isTrue(check({ ...doc, structure: { ...doc.structure, tree } }).unmodified)
  })

  it("isn't, once one item moved", () => {
    const doc = placedDoc()
    assert.isFalse(check(moved(doc, instanceKeys(doc)[1]!, 1)).unmodified)
    assert.isFalse(check(moved(doc, instanceKeys(doc)[0]!, 1)).unmodified)
  })

  it("isn't, once an item's property or material changed", () => {
    const doc = placedDoc()
    const index = doc.ids.indexOf(instanceKeys(doc)[0]!)
    const flipped = doc.map.items.map((item, i) =>
      i === index ? { ...item, boolProperties: [{ ...item.boolProperties[0]!, currentValue: true }] } : item
    )
    assert.isFalse(check({ ...doc, map: { ...doc.map, items: flipped } }).unmodified)
    const painted = setSlotMaterials(doc.map, [{ index, component: 0, slot: 0, material: "/Game/Other.Other" }])
    assert.isFalse(check({ ...doc, map: Option.getOrThrow(painted) }).unmodified)
  })

  it("isn't, with an item gone or another class in its place", () => {
    const doc = placedDoc()
    const [, second] = instanceKeys(doc)
    const index = doc.ids.indexOf(second!)
    const fewer: DocParts = {
      ...doc,
      map: { ...doc.map, items: doc.map.items.filter((_, i) => i !== index) },
      ids: doc.ids.filter((key) => key !== second),
      structure: {
        ...doc.structure,
        tree: doc.structure.tree.map((node) =>
          node.kind === "group"
            ? { ...node, children: node.children.filter((child) => child.kind === "item" && child.key !== second) }
            : node
        )
      }
    }
    assert.isFalse(check(fewer).unmodified)
    const other = doc.map.items.map((item, i) => i === index ? { ...item, actorToSpawn: "/Game/Other.Other_C" } : item)
    assert.isFalse(check({ ...doc, map: { ...doc.map, items: other } }).unmodified)
  })
})

/** The fixture with its second item further along, and a third item. */
const nextDefinition = definitionOf(
  decode(changedPrefab((json) => {
    const [, second] = json.items
    second!.transform.location = [2000, 200, 250.5]
    json.items.push({ ...second!, transform: { ...second!.transform, location: [2000, 900, 250.5] } })
  })),
  { tier: "user", name: "Bridge", hash: NEW_HASH },
  catalog
)

describe("updating an instance", () => {
  it("replaces its items where it stands, keeps its keys and adds the new item to the group", () => {
    const doc = withDelta(placedDoc(), { kind: "translate", offset: { x: 100, y: 0, z: 0 } })
    const [a, b] = instanceKeys(doc)
    const updated = withUpdatedInstance(doc, GROUP, nextDefinition)!
    const keys = instanceKeys(updated)
    assert.lengthOf(keys, 3)
    assert.strictEqual(keys[0], a)
    assert.strictEqual(keys[1], b)
    assert.lengthOf(updated.map.items, 4)
    const secondAt = updated.map.items[updated.ids.indexOf(b!)]?.itemTransform.translation.x
    assert.closeTo(secondAt ?? NaN, FRAME.x + 100 + 2000, 0.01)
    assert.strictEqual(groupOf(updated).prefab?.hash, NEW_HASH)
    assert.isTrue(check(updated).unmodified)
  })

  it("carries the instance's turn and scale over to the new items", () => {
    const turn = rotatorToQuat({ pitch: 0, yaw: 90, roll: 0 })
    const doc = withDelta(placedDoc(), { kind: "rotate", rotation: turn })
    const updated = withUpdatedInstance(doc, GROUP, nextDefinition)!
    const third = updated.map.items.at(-1)!
    // (2000, 900, 250.5) turned a quarter about the frame
    assert.closeTo(third.itemTransform.translation.x, FRAME.x - 900, 0.01)
    assert.closeTo(third.itemTransform.translation.y, FRAME.y + 2000, 0.01)
    assert.isTrue(check(updated).unmodified)
  })

  it("drops what the definition lost, with its name, and leaves the rest of the map alone", () => {
    const doc = placedDoc()
    const twoItems = changedPrefab((json) => void (json.items = [json.items[0]!, json.items[0]!]))
    const shorter = definitionOf(decode(twoItems), { tier: "user", name: "Bridge", hash: NEW_HASH }, catalog)
    const three = withUpdatedInstance(doc, GROUP, nextDefinition)!
    const key = instanceKeys(three)[2]!
    const named: DocParts = {
      ...three,
      structure: { ...three.structure, items: new Map([[key, { name: "Keep me" }]]) } satisfies Structure
    }
    const updated = withUpdatedInstance(named, GROUP, shorter)!
    assert.lengthOf(instanceKeys(updated), 2)
    assert.lengthOf(updated.map.items, 3)
    assert.isFalse(updated.structure.items.has(key))
    assert.strictEqual(updated.map.items[0], doc.map.items[0])
  })

  it("leaves an edited instance about where most of it is", () => {
    const shifted = withDelta(placedDoc(), { kind: "translate", offset: { x: 7000, y: 0, z: 0 } })
    const threeItems0 = changedPrefab((json) => void json.items.push(json.items[0]!))
    const longer = definitionOf(decode(threeItems0), { tier: "user", name: "Bridge", hash: NEW_HASH }, catalog)
    const threeItems = withUpdatedInstance(shifted, GROUP, longer)!
    const edited = moved(threeItems, instanceKeys(threeItems)[0]!, 500)
    assert.isFalse(check(edited).unmodified)
    const replaced = withUpdatedInstance(edited, GROUP, longer)!
    assert.isTrue(check(replaced).unmodified)
    const first = replaced.map.items[replaced.ids.indexOf(instanceKeys(replaced)[0]!)]
    assert.closeTo(first?.itemTransform.translation.x ?? NaN, FRAME.x + 7000 - 1000, 0.01)
  })

  it("answers undefined for a group that isn't an instance", () => {
    assert.isUndefined(withUpdatedInstance(placedDoc(), "nothing", definition))
  })
})

describe("finding instances", () => {
  it("looks inside other groups", () => {
    const doc = placedDoc()
    const nested = withGroup(doc.structure, [GROUP], "outer", "Outer")!
    assert.deepStrictEqual(instancesIn(nested.tree).map(({ id }) => id), [GROUP])
  })
})
