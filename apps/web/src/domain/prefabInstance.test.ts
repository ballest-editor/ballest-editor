import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { changedPrefab, overrideFields, PREFAB_TEXT } from "../test/prefabs"
import { expectVec } from "../test/vec"
import fixture from "./bundledCatalog.json"
import { Catalog, indexCatalog } from "./Catalog"
import type { UeTransform } from "./coords"
import { setSlotMaterials, setTransforms } from "./edits"
import { editTransform } from "./editTransform"
import { newMapFile } from "./factory"
import { applyGroupDelta, type GroupDelta } from "./groupTransform"
import type { TreeNode } from "./MapSidecar"
import { itemOfPrefab } from "./prefab"
import { PrefabFile } from "./PrefabFile"
import {
  checkInstance,
  definitionOf,
  instanceOrigin,
  instancesIn,
  instancesOfPrefab,
  overriddenMembers,
  overrideSummary,
  reshapedInstances,
  withRecordedOverrides,
  withResetMembers,
  withUnlinked,
  withUpdatedInstance
} from "./prefabInstance"
import {
  type Doc,
  findGroup,
  flatStructure,
  freshKeys,
  type Structure,
  treeKeys,
  withGroup,
  withPrefabLink
} from "./structure"
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
const placedDoc = (): Doc => {
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

const groupOf = (doc: Doc) => findGroup(doc.structure.tree, GROUP)!
const check = (doc: Doc) => checkInstance(doc, groupOf(doc), groupOf(doc).prefab!)
const instanceKeys = (doc: Doc) => treeKeys([groupOf(doc)])

/** `doc` with each of the instance's items put through `edit`. */
const withItems = (doc: Doc, edit: (t: UeTransform) => UeTransform): Doc => {
  const entries = instanceKeys(doc).map((key) => {
    const index = doc.ids.indexOf(key)
    return [index, edit(editTransform(doc.map.items[index]!))] as const
  })
  return { ...doc, map: Option.getOrThrow(setTransforms(doc.map, entries)) }
}

/** `doc` with `delta` applied to the instance's items about `pivot`, as a gizmo drag on the whole group would. */
const withDelta = (doc: Doc, delta: GroupDelta, pivot = FRAME): Doc =>
  withItems(doc, (t) => applyGroupDelta(t, pivot, delta))

const moved = (doc: Doc, key: string, by: number): Doc => {
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

  it("stays unmodified through scales about its origin, however many, whatever its members' turns", () => {
    const origin = () => instanceOrigin(doc, groupOf(doc), groupOf(doc).prefab!)!
    let doc = placedDoc()
    expectVec(origin(), FRAME, 2)
    for (
      const delta of [{ kind: "scale", factor: 2.5, axis: "x" }, { kind: "scale", factor: 0.4, axis: "y" }] as const
    ) {
      doc = withDelta(doc, delta, origin())
      assert.isTrue(check(doc).unmodified)
      expectVec(origin(), FRAME, 2)
    }
    doc = withDelta(doc, { kind: "translate", offset: { x: 700, y: 0, z: 0 } })
    expectVec(origin(), { ...FRAME, x: FRAME.x + 700 }, 2)
    doc = withDelta(doc, { kind: "scale", factor: 1.5, axis: "z" }, origin())
    assert.isTrue(check(doc).unmodified)
  })

  it("has no origin to go by once it's edited", () => {
    const placed = placedDoc()
    const doc = moved(placed, instanceKeys(placed)[1]!, 500)
    assert.isUndefined(instanceOrigin(doc, groupOf(doc), groupOf(doc).prefab!))
  })

  it("allows a scale along one axis then a turn, or the other way round", () => {
    const turn = rotatorToQuat({ pitch: 12, yaw: 33, roll: -71 })
    const stretch = { kind: "scale", factor: 2.5, axis: "x" } as const
    const placed = placedDoc()
    assert.isTrue(check(withDelta(withDelta(placed, stretch), { kind: "rotate", rotation: turn })).unmodified)
    assert.isTrue(check(withDelta(withDelta(placed, { kind: "rotate", rotation: turn }), stretch)).unmodified)
  })

  it("allows a scale that left the items' offsets, as the editor's used to", () => {
    const stretched = withItems(placedDoc(), (t) => ({ ...t, scale3D: { ...t.scale3D, y: t.scale3D.y * 3 } }))
    assert.isTrue(check(stretched).unmodified)
  })

  it("allows the game's scale, which spreads the items too", () => {
    const stretch = (value: number, from: number) => from + (value - from) * 2
    const spread = withItems(placedDoc(), (t) => ({
      ...t,
      translation: {
        x: stretch(t.translation.x, FRAME.x),
        y: stretch(t.translation.y, FRAME.y),
        z: stretch(t.translation.z, FRAME.z)
      },
      scale3D: { x: t.scale3D.x * 2, y: t.scale3D.y * 2, z: t.scale3D.z * 2 }
    }))
    assert.isTrue(check(spread).unmodified)
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
    const fewer: Doc = {
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
    const named: Doc = {
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

const RED = "/Game/A/MI_Red.MI_Red"

/** `doc` with the instance's member `n` painted. */
const painted = (doc: Doc, n: number): Doc => {
  const index = doc.ids.indexOf(instanceKeys(doc)[n]!)
  return {
    ...doc,
    map: Option.getOrThrow(setSlotMaterials(doc.map, [{ index, component: 0, slot: 0, material: RED }]))
  }
}

/** `doc` with the instance's member `n` hidden, or shown. */
const hidden = (doc: Doc, n: number, on = true): Doc => {
  const key = instanceKeys(doc)[n]!
  const items = new Map(doc.structure.items)
  if (on) items.set(key, { hidden: true })
  else items.delete(key)
  return { ...doc, structure: { ...doc.structure, items } }
}

/** One edit, as the store commits it. */
const edit = (doc: Doc, change: (doc: Doc) => Doc) => withRecordedOverrides(doc, change(doc))

const materialOf = (doc: Doc, n: number) =>
  doc.map.items[doc.ids.indexOf(instanceKeys(doc)[n]!)]?.meshComponents[0]?.materials[0]?.material
const xOfMember = (doc: Doc, n: number) =>
  doc.map.items[doc.ids.indexOf(instanceKeys(doc)[n]!)]?.itemTransform.translation.x ?? NaN

/** The fixture placed 100 along, its first member moved and hidden, its second painted. */
const overridden = () => {
  const placed = withDelta(placedDoc(), { kind: "translate", offset: { x: 100, y: 0, z: 0 } })
  return edit(
    edit(edit(placed, (d) => painted(d, 1)), (d) => moved(d, instanceKeys(d)[0]!, 500)),
    (d) => hidden(d, 0)
  )
}

describe("an instance's overrides", () => {
  it("records a member's paint, and the instance still follows its definition", () => {
    const doc = edit(placedDoc(), (d) => painted(d, 0))
    assert.deepStrictEqual(overrideFields(groupOf(doc).prefab?.overrides), [{ member: 0, fields: ["paint"] }])
    assert.isTrue(check(doc).unmodified)
    expectVec(instanceOrigin(doc, groupOf(doc), groupOf(doc).prefab!)!, FRAME, 2)
  })

  it("records the member that moved on its own, whichever it is, and not a move of the whole instance", () => {
    for (const n of [0, 1]) {
      const doc = edit(placedDoc(), (d) => moved(d, instanceKeys(d)[n]!, 500))
      assert.deepStrictEqual(overrideFields(groupOf(doc).prefab?.overrides), [{ member: n, fields: ["transform"] }])
      assert.isTrue(check(doc).unmodified)
      expectVec(instanceOrigin(doc, groupOf(doc), groupOf(doc).prefab!)!, FRAME, 2)
    }
    const whole = edit(
      placedDoc(),
      (d) => withDelta(d, { kind: "rotate", rotation: rotatorToQuat({ pitch: 0, yaw: 40, roll: 0 }) })
    )
    assert.isUndefined(groupOf(whole).prefab?.overrides)
    const once = edit(placedDoc(), (d) => moved(d, instanceKeys(d)[1]!, 500))
    // each member moved on its own in turn: the second isn't the instance moving, and it still stands where it did
    const both = edit(once, (d) => moved(d, instanceKeys(d)[0]!, 300))
    assert.deepStrictEqual(overrideFields(groupOf(both).prefab?.overrides), [{ member: 0, fields: ["transform"] }, {
      member: 1,
      fields: ["transform"]
    }])
    assert.isTrue(check(both).unmodified)
    expectVec(instanceOrigin(both, groupOf(both), groupOf(both).prefab!)!, FRAME, 2)
    // the overridden member goes along with the rest, and stays its own
    const twice = edit(once, (d) => withDelta(d, { kind: "translate", offset: { x: 0, y: 300, z: 0 } }))
    assert.deepStrictEqual(overrideFields(groupOf(twice).prefab?.overrides), [{ member: 1, fields: ["transform"] }])
    assert.isTrue(check(twice).unmodified)
  })

  it("records the members a scale along one axis about another point leaves out of line", () => {
    // as with a loose piece active in the selection
    const doc = edit(placedDoc(), (d) => withDelta(d, { kind: "scale", factor: 2, axis: "y" }, { x: 0, y: 5000, z: 0 }))
    assert.isNotEmpty(groupOf(doc).prefab?.overrides ?? [])
    assert.isTrue(check(doc).unmodified)
  })

  it("records a hidden member, and drops that once it's shown again", () => {
    const doc = edit(placedDoc(), (d) => hidden(d, 1))
    assert.deepStrictEqual(overrideFields(groupOf(doc).prefab?.overrides), [{ member: 1, fields: ["hidden"] }])
    assert.isUndefined(groupOf(edit(doc, (d) => hidden(d, 1, false))).prefab?.overrides)
  })

  it("leaves an instance the edit placed or relinked alone, and one with a member gone", () => {
    const placed = placedDoc()
    const bare: Doc = { ...placed, structure: { ...placed.structure, tree: [] } }
    assert.strictEqual(groupOf(withRecordedOverrides(bare, painted(placed, 0))).prefab, definition.link)
    const relinked = withPrefabLink(placed.structure, GROUP, { ...definition.link })!
    const after = withRecordedOverrides(placed, painted({ ...placed, structure: relinked }, 0))
    assert.isUndefined(groupOf(after).prefab?.overrides)
  })

  it("keeps paint, moves and hiding through an Update, and the rest follows the definition", () => {
    const doc = overridden()
    const firstAt = xOfMember(doc, 0)
    const updated = withUpdatedInstance(doc, GROUP, nextDefinition)!
    const link = groupOf(updated).prefab!
    assert.strictEqual(link.hash, NEW_HASH)
    assert.deepStrictEqual(overrideFields(link.overrides), [{ member: 0, fields: ["hidden", "transform"] }, {
      member: 1,
      fields: ["paint"]
    }])
    assert.closeTo(xOfMember(updated, 0), firstAt, 1e-6)
    // the second member's new place in the definition, with its paint
    assert.closeTo(xOfMember(updated, 1), FRAME.x + 100 + 2000, 0.01)
    assert.strictEqual(materialOf(updated, 1), materialOf(doc, 1))
    assert.isTrue(updated.structure.items.get(instanceKeys(updated)[0]!)?.hidden)
    // the member the definition gained stands where the instance puts it
    assert.closeTo(xOfMember(updated, 2), FRAME.x + 100 + 2000, 0.01)
    assert.isTrue(check(updated).unmodified)
    // and once more, with nothing new
    const again = withUpdatedInstance(updated, GROUP, nextDefinition)!
    assert.closeTo(xOfMember(again, 0), firstAt, 1e-6)
    assert.strictEqual(materialOf(again, 1), materialOf(doc, 1))
  })

  it("drops the overrides of a member that gives way to another class", () => {
    const doc = edit(placedDoc(), (d) => painted(d, 1))
    const cylinder = "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces/" +
      "BP_Prim_Cylinder.BP_Prim_Cylinder_C"
    const other = changedPrefab((json) => void (json.items[1]!.class = cylinder))
    const swapped = definitionOf(decode(other), { tier: "user", name: "Bridge", hash: NEW_HASH }, catalog)
    const updated = withUpdatedInstance(doc, GROUP, swapped)!
    assert.notStrictEqual(instanceKeys(updated)[1], instanceKeys(doc)[1])
    assert.isUndefined(groupOf(updated).prefab?.overrides)
  })
})

describe("resetting overrides", () => {
  it("lists each member that carries overrides, by key, with what it overrides", () => {
    const doc = overridden()
    const [first, second] = instanceKeys(doc)
    const members = overriddenMembers(doc)
    assert.deepStrictEqual(members.get(first!), {
      groupId: GROUP,
      member: 0,
      fields: ["transform", "hidden"]
    })
    assert.deepStrictEqual(members.get(second!), { groupId: GROUP, member: 1, fields: ["paint"] })
    assert.strictEqual(overriddenMembers(placedDoc()).size, 0)
    assert.strictEqual(overrideSummary(["transform", "paint", "hidden"]), "transform, paint and hidden")
    assert.strictEqual(overrideSummary(["paint"]), "paint")
  })

  it("puts a member back as its definition has it, shown, and leaves the others' overrides", () => {
    const doc = overridden()
    const was = materialOf(doc, 1)
    const reset = withResetMembers(doc, GROUP, [0], definition)!
    assert.deepStrictEqual(overrideFields(groupOf(reset).prefab?.overrides), [{ member: 1, fields: ["paint"] }])
    // where the instance's placement puts the definition's first item, 100 along
    assert.closeTo(xOfMember(reset, 0), xOfMember(placedDoc(), 0) + 100, 0.01)
    assert.isUndefined(reset.structure.items.get(instanceKeys(reset)[0]!)?.hidden)
    assert.strictEqual(materialOf(reset, 1), was)
    assert.isTrue(check(reset).unmodified)
  })

  it("puts every member back with none named", () => {
    const reset = withResetMembers(overridden(), GROUP, undefined, definition)!
    assert.isUndefined(groupOf(reset).prefab?.overrides)
    assert.strictEqual(materialOf(reset, 1), materialOf(placedDoc(), 1))
    assert.closeTo(xOfMember(reset, 0), xOfMember(placedDoc(), 0) + 100, 0.01)
  })
})

describe("an instance given members or losing them", () => {
  /** `doc` with item `key` moved into or out of the instance. */
  const regrouped = (doc: Doc, key: string, into: boolean): Doc => {
    const item: TreeNode = { kind: "item", key }
    const tree = doc.structure.tree.flatMap((node): ReadonlyArray<TreeNode> => {
      if (node.kind === "item") return node.key === key && into ? [] : [node]
      if (node.id !== GROUP) return [node]
      return into
        ? [{ ...node, children: [...node.children, item] }]
        : [{ ...node, children: node.children.filter((child) => child.kind !== "item" || child.key !== key) }, item]
    })
    return { ...doc, structure: { ...doc.structure, tree } }
  }

  it("is found when an item joins it or leaves it, and not for a move, a reorder, a rename or an Update", () => {
    const doc = placedDoc()
    const [loose] = doc.ids
    const [first, second] = instanceKeys(doc)
    assert.deepStrictEqual(reshapedInstances(doc, regrouped(doc, loose!, true)).map(({ id }) => id), [GROUP])
    assert.deepStrictEqual(reshapedInstances(doc, regrouped(doc, first!, false)).map(({ id }) => id), [GROUP])
    assert.lengthOf(reshapedInstances(doc, moved(doc, first!, 500)), 0)
    const tree = doc.structure.tree.map((node) =>
      node.kind === "group"
        ? { ...node, name: "Other", children: [{ kind: "item", key: second! }, { kind: "item", key: first! }] as const }
        : node
    )
    assert.lengthOf(reshapedInstances(doc, { ...doc, structure: { ...doc.structure, tree } }), 0)
    assert.lengthOf(reshapedInstances(doc, withUpdatedInstance(doc, GROUP, nextDefinition)!), 0)
  })

  it("isn't when it goes whole", () => {
    const doc = placedDoc()
    const tree = doc.structure.tree.filter((node) => node.kind === "item")
    assert.lengthOf(reshapedInstances(doc, { ...doc, structure: { ...doc.structure, tree } }), 0)
  })

  it("is made a plain group by unlinking, its items as they are", () => {
    const doc = placedDoc()
    const unlinked = withUnlinked(doc, [GROUP])
    assert.isUndefined(groupOf(unlinked).prefab)
    assert.strictEqual(unlinked.map, doc.map)
    assert.strictEqual(withUnlinked(unlinked, [GROUP]), unlinked)
  })
})

describe("finding instances", () => {
  it("finds the instances of one definition, by its tier and name", () => {
    const { tree } = placedDoc().structure
    assert.deepStrictEqual(instancesOfPrefab(tree, { tier: "user", name: "Bridge" }).map(({ id }) => id), [GROUP])
    assert.lengthOf(instancesOfPrefab(tree, { tier: "project", name: "Bridge" }), 0)
    assert.lengthOf(instancesOfPrefab(tree, { tier: "user", name: "Arch" }), 0)
  })

  it("looks inside other groups", () => {
    const doc = placedDoc()
    const nested = withGroup(doc.structure, [GROUP], "outer", "Outer")!
    assert.deepStrictEqual(instancesIn(nested.tree).map(({ id }) => id), [GROUP])
  })
})
