import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "./bundledCatalog.json"
import { Catalog, indexCatalog } from "./Catalog"
import { itemFromPiece, newMapFile, placementTransform } from "./factory"
import type { MapFile } from "./MapFile"
import type { GroupNode, ItemNode, TreeNode } from "./MapSidecar"
import { pieceLabelOf } from "./pieceName"

import {
  copyStructure,
  flatStructure,
  freshKey,
  freshKeys,
  groupNames,
  itemNames,
  numberedNameText,
  type Structure,
  treeKeys,
  withGroup,
  withGroupName,
  withItemName,
  withMovedNodes,
  withNewItems,
  withoutGroups,
  withoutKeys,
  withPasted,
  withTags
} from "./structure"

const item = (key: string): ItemNode => ({ kind: "item", key })
const group = (id: string, ...children: ReadonlyArray<TreeNode>): GroupNode => ({
  kind: "group",
  id,
  name: id,
  tags: [],
  children
})
const initialMapForTests = () => newMapFile({ displayName: "Test", creatorName: "me", createdAt: "" })
const structure = (...tree: Structure["tree"]): Structure => ({ tree, items: new Map() })

describe("keys", () => {
  it("are URL-safe and don't repeat", () => {
    const keys = freshKeys(1000)
    assert.strictEqual(new Set(keys).size, 1000)
    for (const key of keys) assert.match(key, /^[\w-]{12}$/)
    assert.match(freshKey(), /^[\w-]{12}$/)
  })
})

describe("withGroup", () => {
  it("nests a whole group, and leaves out what is inside a node it has", () => {
    const start = structure(group("x", item("a"), item("b")), item("c"))
    const next = withGroup(start, ["x", "a", "c"], "g", "Mine")!
    assert.deepStrictEqual(next.tree, [{
      kind: "group",
      id: "g",
      name: "Mine",
      tags: [],
      children: [group("x", item("a"), item("b")), item("c")]
    }])
  })

  it("puts the group where the first key's node was", () => {
    const next = withGroup(flatStructure(["a", "b", "c", "d"]), ["c", "b"], "g", "Mine")!
    assert.deepStrictEqual(next.tree, [
      item("a"),
      { kind: "group", id: "g", name: "Mine", tags: [], children: [item("c"), item("b")] },
      item("d")
    ])
  })

  it("pulls keys out of the groups they are in, and a group left empty goes", () => {
    const start = structure(group("x", item("a"), item("b")), group("y", item("c")), item("d"))
    const next = withGroup(start, ["a", "c", "d"], "g")!
    assert.deepStrictEqual(next.tree, [
      group(
        "x",
        { kind: "group", id: "g", name: "Group", tags: [], children: [item("a"), item("c"), item("d")] },
        item("b")
      )
    ])
  })

  it("answers undefined when no id is in the tree", () => {
    assert.isUndefined(withGroup(structure(group("x", item("a"))), ["nope"], "g"))
    assert.isUndefined(withGroup(flatStructure(["a"]), [], "g"))
  })
})

describe("withoutGroups", () => {
  it("moves the children to the parent, in the group's place", () => {
    const start = structure(group("p", item("a"), group("x", item("b"), group("y", item("c"))), item("d")))
    assert.deepStrictEqual(
      withoutGroups(start, ["x"])!.tree,
      [group("p", item("a"), item("b"), group("y", item("c")), item("d"))]
    )
    assert.isUndefined(withoutGroups(start, ["a"]))
    assert.isUndefined(withoutGroups(start, ["nope"]))
  })
})

describe("withMovedNodes", () => {
  const start = structure(item("a"), group("x", item("b"), item("c")), group("y", item("d")))

  it("moves an item between groups and the root, at an index counted once it has left", () => {
    assert.deepStrictEqual(withMovedNodes(start, ["a"], "x", 1)!.tree, [
      group("x", item("b"), item("a"), item("c")),
      group("y", item("d"))
    ])
    assert.deepStrictEqual(withMovedNodes(start, ["b"], null, 0)!.tree, [
      item("b"),
      item("a"),
      group("x", item("c")),
      group("y", item("d"))
    ])
    assert.deepStrictEqual(withMovedNodes(start, ["b"], "x", 1)!.tree, [
      item("a"),
      group("x", item("c"), item("b")),
      group("y", item("d"))
    ])
  })

  it("moves a group with what is in it, clamps the index and drops a group it empties", () => {
    assert.deepStrictEqual(withMovedNodes(start, ["x"], "y", 99)!.tree, [
      item("a"),
      group("y", item("d"), group("x", item("b"), item("c")))
    ])
    assert.deepStrictEqual(withMovedNodes(start, ["d"], "x", 0)!.tree, [
      item("a"),
      group("x", item("d"), item("b"), item("c"))
    ])
  })

  it("keeps a target that held only the emptied group", () => {
    const nested = structure(group("a", group("b", item("k"))))
    assert.deepStrictEqual(withMovedNodes(nested, ["k"], "a", 0)!.tree, [group("a", item("k"))])
  })

  it("refuses a move into itself, or a parent that isn't a group, and a move that changes nothing", () => {
    const nested = structure(group("x", group("y", item("a"))))
    assert.isUndefined(withMovedNodes(nested, ["x"], "y", 0))
    assert.isUndefined(withMovedNodes(nested, ["x"], "x", 0))
    assert.isUndefined(withMovedNodes(nested, ["y"], "a", 0))
    assert.isUndefined(withMovedNodes(nested, ["nope"], null, 0))
    assert.isUndefined(withMovedNodes(start, ["a"], null, 0))
    assert.isUndefined(withMovedNodes(start, ["c"], "x", 5))
  })
})

describe("names and tags", () => {
  it("sets and clears an item's name, keeping its tags", () => {
    const named = withItemName(flatStructure(["a"]), "a", "  Ramp ")!
    assert.deepStrictEqual(named.items.get("a"), { name: "Ramp" })
    assert.isUndefined(withItemName(named, "a", "Ramp"))
    const tagged = withTags(named, "a", ["x"])!
    assert.deepStrictEqual(withItemName(tagged, "a", null)!.items.get("a"), { tags: ["x"] })
    assert.isFalse(withItemName(named, "a", " ")!.items.has("a"))
    assert.isUndefined(withItemName(named, "nope", "x"))
  })

  it("renames a group, not to nothing", () => {
    const start = structure(group("p", group("x", item("a"))))
    const next = withGroupName(start, "x", " New ")!
    assert.deepStrictEqual(next.tree, [group("p", { ...group("x", item("a")), name: "New" })])
    assert.isUndefined(withGroupName(start, "x", "x"))
    assert.isUndefined(withGroupName(start, "x", "  "))
    assert.isUndefined(withGroupName(start, "a", "New"))
  })

  it("tags items and groups with free strings, each once", () => {
    const start = structure(item("a"), group("x", item("b")))
    const onItem = withTags(start, "a", [" one ", "two", "one", ""])!
    assert.deepStrictEqual(onItem.items.get("a"), { tags: ["one", "two"] })
    assert.isUndefined(withTags(onItem, "a", ["one", "two"]))
    assert.isFalse(withTags(onItem, "a", [])!.items.has("a"))
    const onGroup = withTags(start, "x", ["t"])!
    assert.deepStrictEqual(onGroup.tree[1], { ...group("x", item("b")), tags: ["t"] })
    assert.isUndefined(withTags(start, "nope", ["t"]))
  })
})

describe("withoutKeys", () => {
  it("drops items and their data, and the groups they leave empty", () => {
    const start: Structure = {
      tree: [item("a"), group("x", group("y", item("b")), item("c")), group("empty")],
      items: new Map([["b", { name: "B" }], ["a", { name: "A" }]])
    }
    const next = withoutKeys(start, new Set(["b", "c"]))
    assert.deepStrictEqual(next.tree, [item("a"), group("empty")])
    assert.deepStrictEqual([...next.items.keys()], ["a"])
  })
})

describe("copy and paste", () => {
  const keyOf = new Map([["a", "a2"], ["b", "b2"], ["c", "c2"]])
  let ids = 0
  const freshId = () => `new${++ids}`

  it("keeps a whole group, and puts its copy after it", () => {
    ids = 0
    const start: Structure = {
      tree: [group("x", item("a"), group("y", item("b"))), item("z")],
      items: new Map([["a", { name: "A", tags: ["t"] }]])
    }
    const clip = copyStructure(start, new Set(["a", "b"]))
    assert.deepStrictEqual(clip.tree, [start.tree[0]!])
    const pasted = withPasted(start, clip, keyOf, freshId)
    assert.deepStrictEqual(pasted.tree, [
      start.tree[0]!,
      { ...group("x", item("a2"), { ...group("y", item("b2")), id: "new2" }), id: "new1" },
      item("z")
    ])
    assert.deepStrictEqual(pasted.items.get("a2"), { name: "A", tags: ["t"] })
  })

  it("leaves a partly copied group's items beside their sources, in that group", () => {
    const start = structure(group("x", item("a"), item("b"), item("c")))
    const clip = copyStructure(start, new Set(["a", "c"]))
    assert.deepStrictEqual(clip.tree, [item("a"), item("c")])
    assert.deepStrictEqual(withPasted(start, clip, keyOf).tree, [
      group("x", item("a"), item("a2"), item("b"), item("c"), item("c2"))
    ])
  })

  it("lands at the end of the root when the source has gone", () => {
    const start = structure(group("x", item("a"), item("b")), item("z"))
    const clip = copyStructure(start, new Set(["a", "b"]))
    const cut = withoutKeys(start, new Set(["a", "b"]))
    const pasted = withPasted(cut, clip, keyOf, () => "copy")
    assert.deepStrictEqual(pasted.tree, [item("z"), { ...group("x", item("a2"), item("b2")), id: "copy" }])
  })

  it("every item stays in exactly one place", () => {
    const start = structure(group("x", item("a"), group("y", item("b"))), item("c"))
    const clip = copyStructure(start, new Set(["a", "b", "c"]))
    const keys = treeKeys(withPasted(start, clip, keyOf).tree)
    assert.strictEqual(new Set(keys).size, 6)
    assert.lengthOf(keys, 6)
  })
})

describe("itemNames", () => {
  const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
  const cube = catalog.pieces.find((p) => p.className === "BP_Prim_Cube")!
  const placed = (x: number) => itemFromPiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))

  it("uses the user's name, else the piece's, numbering shared names in document order", () => {
    const base = initialMapForTests()
    const map: MapFile = { ...base, items: [...base.items, placed(0), placed(1), placed(2)] }
    const keys = ["start", "goal", "c1", "c2", "c3"]
    const names = itemNames(map, keys, new Map([["c2", { name: "Mine" }]]), indexCatalog(catalog))
    const label = pieceLabelOf(cube)
    assert.strictEqual(numberedNameText(names.get("c1")!), `${label} 1`)
    assert.strictEqual(numberedNameText(names.get("c2")!), "Mine")
    assert.strictEqual(numberedNameText(names.get("c3")!), `${label} 2`)
  })

  it("gives a name nothing else has no ordinal", () => {
    const base = initialMapForTests()
    const names = itemNames(base, ["start", "goal"], new Map(), indexCatalog(catalog))
    assert.deepStrictEqual(names.get("start"), { name: "Player Start", ordinal: undefined })
    assert.isUndefined(names.get("goal")?.ordinal)
  })

  it("numbers items the user gave the same name", () => {
    const base = initialMapForTests()
    const map: MapFile = { ...base, items: [placed(0), placed(1)] }
    const names = itemNames(map, ["a", "b"], new Map([["a", { name: "Ramp" }], ["b", { name: "Ramp" }]]), null)
    assert.deepStrictEqual([...names.values()], [{ name: "Ramp", ordinal: 1 }, { name: "Ramp", ordinal: 2 }])
  })

  it("writes the class out without a catalog", () => {
    const base = initialMapForTests()
    const map: MapFile = { ...base, items: [placed(0)] }
    assert.strictEqual(numberedNameText(itemNames(map, ["a"], new Map(), null).get("a")!), "Prim Cube")
  })
})

describe("groupNames", () => {
  const named = (id: string, name: string, ...children: ReadonlyArray<TreeNode>): TreeNode => ({
    ...group(id, ...children),
    name
  })

  it("numbers groups of the same name in tree order, at any depth", () => {
    const tree = [named("a", "Group", named("b", "Group")), item("x"), named("c", "Group")]
    assert.deepStrictEqual([...groupNames(tree).values()].map((name) => name.ordinal), [1, 2, 3])
  })

  it("leaves a name only one group has alone, and numbers the user's names too", () => {
    const names = groupNames([named("a", "curves"), named("b", "curves"), named("c", "stairs")])
    assert.deepStrictEqual(names.get("a"), { name: "curves", ordinal: 1 })
    assert.deepStrictEqual(names.get("b"), { name: "curves", ordinal: 2 })
    assert.deepStrictEqual(names.get("c"), { name: "stairs", ordinal: undefined })
  })
})

describe("numberedNameText", () => {
  it("adds the ordinal when there is one", () => {
    assert.strictEqual(numberedNameText({ name: "Cube", ordinal: 3 }), "Cube 3")
    assert.strictEqual(numberedNameText({ name: "Goal", ordinal: undefined }), "Goal")
  })
})

describe("withNewItems", () => {
  it("adds items loose at the end of the root", () => {
    const start = structure(group("x", item("a")))
    assert.deepStrictEqual(withNewItems(start, ["b"]).tree, [group("x", item("a")), item("b")])
  })
})

describe("withMovedNodes", () => {
  it("moves several nodes together, in the order given", () => {
    const next = withMovedNodes(flatStructure(["a", "b", "c", "d"]), ["c", "a"], null, 2)!
    assert.deepStrictEqual(next.tree, [item("b"), item("d"), item("c"), item("a")])
  })

  it("takes nodes from different groups, and a group left empty goes", () => {
    const start = structure(group("x", item("a")), group("y", item("b"), item("c")), group("z", item("d")))
    const next = withMovedNodes(start, ["a", "b"], "z", 0)!
    assert.deepStrictEqual(next.tree, [group("y", item("c")), group("z", item("a"), item("b"), item("d"))])
  })

  it("keeps a move's source group up to date beside the target", () => {
    const start = structure(group("x", item("a"), item("b")), item("c"))
    const next = withMovedNodes(start, ["a", "c"], null, 1)!
    assert.deepStrictEqual(next.tree, [group("x", item("b")), item("a"), item("c")])
  })

  it("moves a node with its group, not on its own", () => {
    const start = structure(group("x", item("a")), item("b"))
    assert.deepStrictEqual(withMovedNodes(start, ["x", "a"], null, 1)!.tree, [item("b"), group("x", item("a"))])
  })

  it("changes nothing for nodes already there", () => {
    assert.strictEqual(withMovedNodes(flatStructure(["a", "b", "c"]), ["a", "b"], null, 0), undefined)
    assert.strictEqual(withMovedNodes(flatStructure(["a"]), ["gone"], null, 0), undefined)
  })

  it("won't put a group inside one of the nodes on the move", () => {
    const start = structure(group("x", group("y", item("a"))), item("b"))
    assert.strictEqual(withMovedNodes(start, ["x", "b"], "y", 0), undefined)
  })
})

describe("withoutGroups", () => {
  it("dissolves several groups at once, nested ones too", () => {
    const start = structure(group("x", group("y", item("a"))), group("z", item("b")), item("c"))
    assert.deepStrictEqual(withoutGroups(start, ["x", "y", "z"])!.tree, [item("a"), item("b"), item("c")])
  })

  it("changes nothing without a group to dissolve", () => {
    assert.strictEqual(withoutGroups(flatStructure(["a"]), ["a", "gone"]), undefined)
  })
})
