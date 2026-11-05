import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "./bundledCatalog.json"
import { Catalog, indexCatalog } from "./Catalog"
import { itemFromPiece, newMapFile, placementTransform } from "./factory"
import type { MapFile } from "./MapFile"
import type { GroupNode, ItemNode, TreeNode } from "./MapSidecar"

import {
  copyStructure,
  flatStructure,
  freshKey,
  freshKeys,
  itemDisplayNames,
  nextGroupName,
  type Structure,
  treeKeys,
  withGroup,
  withGroupName,
  withItemName,
  withMovedNode,
  withNewItems,
  withoutGroup,
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
        { kind: "group", id: "g", name: "Group 1", tags: [], children: [item("a"), item("c"), item("d")] },
        item("b")
      )
    ])
  })

  it("names groups Group N, the lowest number free", () => {
    assert.strictEqual(nextGroupName([]), "Group 1")
    assert.strictEqual(
      nextGroupName([{ ...group("x"), name: "Group 1" }, group("y", { ...group("z"), name: "Group 2" })]),
      "Group 3"
    )
  })

  it("answers undefined when no key is an item", () => {
    assert.isUndefined(withGroup(structure(group("x", item("a"))), ["x", "nope"], "g"))
    assert.isUndefined(withGroup(flatStructure(["a"]), [], "g"))
  })
})

describe("withoutGroup", () => {
  it("moves the children to the parent, in the group's place", () => {
    const start = structure(group("p", item("a"), group("x", item("b"), group("y", item("c"))), item("d")))
    assert.deepStrictEqual(
      withoutGroup(start, "x")!.tree,
      [group("p", item("a"), item("b"), group("y", item("c")), item("d"))]
    )
    assert.isUndefined(withoutGroup(start, "a"))
    assert.isUndefined(withoutGroup(start, "nope"))
  })
})

describe("withMovedNode", () => {
  const start = structure(item("a"), group("x", item("b"), item("c")), group("y", item("d")))

  it("moves an item between groups and the root, at an index counted once it has left", () => {
    assert.deepStrictEqual(withMovedNode(start, "a", "x", 1)!.tree, [
      group("x", item("b"), item("a"), item("c")),
      group("y", item("d"))
    ])
    assert.deepStrictEqual(withMovedNode(start, "b", null, 0)!.tree, [
      item("b"),
      item("a"),
      group("x", item("c")),
      group("y", item("d"))
    ])
    assert.deepStrictEqual(withMovedNode(start, "b", "x", 1)!.tree, [
      item("a"),
      group("x", item("c"), item("b")),
      group("y", item("d"))
    ])
  })

  it("moves a group with what is in it, clamps the index and drops a group it empties", () => {
    assert.deepStrictEqual(withMovedNode(start, "x", "y", 99)!.tree, [
      item("a"),
      group("y", item("d"), group("x", item("b"), item("c")))
    ])
    assert.deepStrictEqual(withMovedNode(start, "d", "x", 0)!.tree, [
      item("a"),
      group("x", item("d"), item("b"), item("c"))
    ])
  })

  it("keeps a target that held only the emptied group", () => {
    const nested = structure(group("a", group("b", item("k"))))
    assert.deepStrictEqual(withMovedNode(nested, "k", "a", 0)!.tree, [group("a", item("k"))])
  })

  it("refuses a move into itself, or a parent that isn't a group, and a move that changes nothing", () => {
    const nested = structure(group("x", group("y", item("a"))))
    assert.isUndefined(withMovedNode(nested, "x", "y", 0))
    assert.isUndefined(withMovedNode(nested, "x", "x", 0))
    assert.isUndefined(withMovedNode(nested, "y", "a", 0))
    assert.isUndefined(withMovedNode(nested, "nope", null, 0))
    assert.isUndefined(withMovedNode(start, "a", null, 0))
    assert.isUndefined(withMovedNode(start, "c", "x", 5))
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

describe("itemDisplayNames", () => {
  const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
  const cube = catalog.pieces.find((p) => p.className === "BP_Prim_Cube")!
  const placed = (x: number) => itemFromPiece(cube, placementTransform(cube, { x, y: 0, z: 0 }))

  it("uses the user's name, else the piece's and an ordinal in document order", () => {
    const base = initialMapForTests()
    const map: MapFile = { ...base, items: [...base.items, placed(0), placed(1), placed(2)] }
    const keys = ["start", "goal", "c1", "c2", "c3"]
    const names = itemDisplayNames(map, keys, new Map([["c2", { name: "Mine" }]]), indexCatalog(catalog))
    const label = cube.displayName || cube.className
    assert.strictEqual(names.get("c1"), `${label} 1`)
    assert.strictEqual(names.get("c2"), "Mine")
    assert.strictEqual(names.get("c3"), `${label} 3`)
  })

  it("falls back on the class's name without a catalog", () => {
    const base = initialMapForTests()
    const map: MapFile = { ...base, items: [placed(0)] }
    assert.strictEqual(itemDisplayNames(map, ["a"], new Map(), null).get("a"), "BP_Prim_Cube 1")
  })
})

describe("withNewItems", () => {
  it("adds items loose at the end of the root", () => {
    const start = structure(group("x", item("a")))
    assert.deepStrictEqual(withNewItems(start, ["b"]).tree, [group("x", item("a")), item("b")])
  })
})
