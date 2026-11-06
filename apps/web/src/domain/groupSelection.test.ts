import { assert, describe, it } from "@effect/vitest"
import {
  activeNodeOf,
  canGroupSelection,
  clickLevelOf,
  enteredLevelOf,
  exactSelectedGroup,
  groupBoxTargets,
  groupPathOf,
  groupSelectionStates,
  groupTrail,
  nodeKeys,
  selectableKeys,
  selectedGroupIds,
  selectionNodeIds,
  selectionSummaryOf
} from "./groupSelection"
import type { TreeNode } from "./MapSidecar"

const item = (key: string): TreeNode => ({ kind: "item", key })
const group = (id: string, ...children: ReadonlyArray<TreeNode>): TreeNode => ({
  kind: "group",
  id,
  name: id,
  tags: [],
  children
})

/** outer > (inner > (a, b), c); d loose; solo > only > e */
const tree: ReadonlyArray<TreeNode> = [
  group("outer", group("inner", item("a"), item("b")), item("c")),
  item("d"),
  group("solo", group("only", item("e")))
]

describe("groupPathOf and nodeKeys", () => {
  it("gives the groups around a node, outermost first", () => {
    assert.deepStrictEqual(groupPathOf(tree, "a"), ["outer", "inner"])
    assert.deepStrictEqual(groupPathOf(tree, "inner"), ["outer"])
    assert.deepStrictEqual(groupPathOf(tree, "d"), [])
    assert.deepStrictEqual(groupPathOf(tree, "gone"), [])
  })

  it("expands a group to every item under it", () => {
    assert.deepStrictEqual(nodeKeys(tree, "outer"), ["a", "b", "c"])
    assert.deepStrictEqual(nodeKeys(tree, "d"), ["d"])
    assert.deepStrictEqual(nodeKeys(tree, "gone"), [])
  })
})

describe("clickLevelOf", () => {
  it("reaches the outermost group with nothing entered", () => {
    assert.deepStrictEqual(clickLevelOf(tree, "a", null), { nodeId: "outer", enteredGroupId: null })
    assert.deepStrictEqual(clickLevelOf(tree, "d", null), { nodeId: "d", enteredGroupId: null })
  })

  it("reaches the children of the entered group", () => {
    assert.deepStrictEqual(clickLevelOf(tree, "a", "outer"), { nodeId: "inner", enteredGroupId: "outer" })
    assert.deepStrictEqual(clickLevelOf(tree, "c", "outer"), { nodeId: "c", enteredGroupId: "outer" })
    assert.deepStrictEqual(clickLevelOf(tree, "a", "inner"), { nodeId: "a", enteredGroupId: "inner" })
  })

  it("climbs to the nearest parent that holds an item outside the entered group", () => {
    assert.deepStrictEqual(clickLevelOf(tree, "c", "inner"), { nodeId: "c", enteredGroupId: "outer" })
    assert.deepStrictEqual(clickLevelOf(tree, "d", "inner"), { nodeId: "d", enteredGroupId: null })
    assert.deepStrictEqual(clickLevelOf(tree, "e", "inner"), { nodeId: "solo", enteredGroupId: null })
  })
})

describe("enteredLevelOf", () => {
  it("goes one group deeper per double-click, and stops at the item", () => {
    assert.deepStrictEqual(enteredLevelOf(tree, "a", null), { nodeId: "inner", enteredGroupId: "outer" })
    assert.deepStrictEqual(enteredLevelOf(tree, "a", "outer"), { nodeId: "a", enteredGroupId: "inner" })
    assert.strictEqual(enteredLevelOf(tree, "a", "inner"), undefined)
  })

  it("has nothing to enter on a loose item", () => {
    assert.strictEqual(enteredLevelOf(tree, "d", null), undefined)
  })
})

describe("what a selection makes up", () => {
  it("keeps whole groups whole, in tree order", () => {
    assert.deepStrictEqual(selectionNodeIds(tree, ["d", "c", "b", "a"], null), ["outer", "d"])
    assert.deepStrictEqual(selectionNodeIds(tree, ["d", "a"], null), ["a", "d"])
    assert.deepStrictEqual(selectionNodeIds(tree, ["b", "a"], null), ["inner"])
  })

  it("finds the groups Ungroup dissolves", () => {
    assert.deepStrictEqual(selectedGroupIds(tree, ["a", "b", "d"], null), ["inner"])
    assert.deepStrictEqual(selectedGroupIds(tree, ["a", "d"], null), [])
  })

  it("sees everything in the entered group as its members, down through the groups around it", () => {
    assert.deepStrictEqual(selectionNodeIds(tree, ["a", "b", "c"], "outer"), ["inner", "c"])
    assert.deepStrictEqual(selectionNodeIds(tree, ["a", "b", "c"], "inner"), ["a", "b", "c"])
    assert.deepStrictEqual(selectionNodeIds(tree, ["e"], "only"), ["e"])
    assert.deepStrictEqual(selectedGroupIds(tree, ["a", "b", "c"], "outer"), ["inner"])
    assert.deepStrictEqual(selectedGroupIds(tree, ["e"], "only"), [])
    assert.isTrue(canGroupSelection(tree, ["a", "b", "c"], "outer"))
  })

  it("can group anything but one whole group", () => {
    assert.isTrue(canGroupSelection(tree, ["d"], null))
    assert.isTrue(canGroupSelection(tree, ["a", "b", "d"], null))
    assert.isFalse(canGroupSelection(tree, ["a", "b"], null))
    assert.isFalse(canGroupSelection(tree, [], null))
  })
})

describe("selectableKeys", () => {
  it("is every item in the map, in or out of a group", () => {
    assert.deepStrictEqual(selectableKeys(tree, null), ["a", "b", "c", "d", "e"])
  })

  it("is the entered group's items, nested ones too", () => {
    assert.deepStrictEqual(selectableKeys(tree, "outer"), ["a", "b", "c"])
    assert.deepStrictEqual(selectableKeys(tree, "inner"), ["a", "b"])
  })
})

describe("selectionSummaryOf", () => {
  const nested = [
    item("loose"),
    group("outer", item("a"), group("inner", item("b"), item("c"))),
    group("one", item("d"))
  ]
  const names = new Map([
    ["loose", { name: "Goal", ordinal: undefined }],
    ["a", { name: "Cube", ordinal: 2 }],
    ["outer", { name: "Group", ordinal: undefined }],
    ["inner", { name: "Group", ordinal: 2 }],
    ["one", { name: "Left ramp", ordinal: undefined }]
  ])
  const summary = (selected: ReadonlyArray<string>, entered: string | null = null) =>
    selectionSummaryOf(nested, selected, entered, names)

  it("is nothing for an empty selection", () => {
    assert.isNull(summary([]))
  })

  it("names a lone item, ordinal and all", () => {
    assert.deepStrictEqual(summary(["loose"]), { name: "Goal", ordinal: undefined })
    assert.deepStrictEqual(summary(["a"]), { name: "Cube", ordinal: 2 })
  })

  it("counts items that make up no group", () => {
    assert.strictEqual(summary(["loose", "a"])?.name, "2 items")
    assert.strictEqual(summary(["a", "b"])?.name, "2 items")
  })

  it("names one whole group, the outermost one for nested groups", () => {
    assert.deepStrictEqual(summary(["a", "b", "c"]), { name: "Group", ordinal: undefined })
    assert.deepStrictEqual(summary(["b", "c"]), { name: "Group", ordinal: 2 })
    assert.deepStrictEqual(summary(["d"]), { name: "Left ramp", ordinal: undefined })
  })

  it("counts several whole groups", () => {
    assert.deepStrictEqual(summary(["b", "c", "d"]), { name: "2 groups", ordinal: undefined })
  })

  it("counts items and groups when a selection mixes them", () => {
    assert.strictEqual(summary(["loose", "a", "b", "c"])?.name, "4 items · 1 group")
    assert.strictEqual(summary(["loose", "d"])?.name, "2 items · 1 group")
    assert.strictEqual(summary(["a", "d"])?.name, "2 items · 1 group")
  })

  it("counts an entered group's members, all selected, rather than naming it", () => {
    assert.strictEqual(summary(["a", "b", "c"], "outer")?.name, "3 items · 1 group")
    assert.strictEqual(summary(["b", "c"], "inner")?.name, "2 items")
    assert.deepStrictEqual(summary(["d"], "one"), { name: "1 item", ordinal: undefined })
  })

  it("counts a lone item without a name rather than showing nothing", () => {
    assert.strictEqual(summary(["b"])?.name, "1 item")
  })
})

describe("groupBoxTargets", () => {
  it("boxes each group whole in the selection, and no group for loose items", () => {
    assert.deepStrictEqual(groupBoxTargets(tree, ["a", "b", "e"], null), [
      { id: "inner", keys: ["a", "b"], entered: false },
      { id: "solo", keys: ["e"], entered: false }
    ])
    assert.deepStrictEqual(groupBoxTargets(tree, ["d", "c"], null), [])
  })

  it("keeps the entered group's box, quiet, with a child selected or nothing", () => {
    const entered = { id: "outer", keys: ["a", "b", "c"], entered: true }
    assert.deepStrictEqual(groupBoxTargets(tree, ["c"], "outer"), [entered])
    assert.deepStrictEqual(groupBoxTargets(tree, [], "outer"), [entered])
    assert.deepStrictEqual(groupBoxTargets(tree, ["a", "b"], "outer"), [
      { id: "inner", keys: ["a", "b"], entered: false },
      entered
    ])
  })

  it("keeps the box quiet with everything in the entered group selected: that is its members, not the group", () => {
    assert.deepStrictEqual(groupBoxTargets(tree, ["a", "b", "c"], "outer"), [
      { id: "inner", keys: ["a", "b"], entered: false },
      { id: "outer", keys: ["a", "b", "c"], entered: true }
    ])
  })
})

describe("exactSelectedGroup", () => {
  const idOf = (keys: ReadonlyArray<string>, entered: string | null = null) =>
    exactSelectedGroup(tree, keys, entered)?.id

  it("matches a selection of just one group's items, in any order", () => {
    assert.strictEqual(idOf(["c", "a", "b"]), "outer")
    assert.strictEqual(idOf(["b", "a"]), "inner")
  })

  it("doesn't match anything else", () => {
    assert.strictEqual(idOf(["a"]), undefined)
    assert.strictEqual(idOf(["a", "b", "d"]), undefined)
    assert.strictEqual(idOf(["d"]), undefined)
    assert.strictEqual(idOf([]), undefined)
  })

  it("takes the outermost of nested groups, inside the entered one", () => {
    assert.strictEqual(idOf(["e"]), "solo")
    assert.strictEqual(idOf(["e"], "solo"), "only")
    assert.strictEqual(idOf(["e"], "only"), undefined)
  })
})

describe("groupSelectionStates", () => {
  it("tells whole groups from partly selected ones", () => {
    const states = groupSelectionStates(tree, new Set(["a", "b"]))
    assert.strictEqual(states.get("inner"), "all")
    assert.strictEqual(states.get("outer"), "some")
    assert.isFalse(states.has("solo"))
  })
})

describe("activeNodeOf", () => {
  it("is the active item, with the groups to open around it", () => {
    assert.deepStrictEqual(activeNodeOf(tree, ["d", "a"]), { id: "a", parents: ["outer", "inner"] })
  })

  it("is the outermost whole group the active item is in", () => {
    assert.deepStrictEqual(activeNodeOf(tree, ["a", "b", "c"]), { id: "outer", parents: [] })
    assert.deepStrictEqual(activeNodeOf(tree, ["a", "b"]), { id: "inner", parents: ["outer"] })
  })

  it("is nothing for an empty selection or a key the tree lacks", () => {
    assert.strictEqual(activeNodeOf(tree, []), undefined)
    assert.strictEqual(activeNodeOf(tree, ["gone"]), undefined)
  })
})

describe("groupTrail", () => {
  it("runs from the root to the group", () => {
    assert.deepStrictEqual(groupTrail(tree, "inner").map((g) => g.id), ["outer", "inner"])
    assert.deepStrictEqual(groupTrail(tree, null), [])
    assert.deepStrictEqual(groupTrail(tree, "gone"), [])
  })
})
