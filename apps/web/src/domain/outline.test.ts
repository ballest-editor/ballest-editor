import { assert, describe, it } from "@effect/vitest"
import type { TreeNode } from "./MapSidecar"
import { dropTargetAt, indexOnceLeft, outlineRows, rowKeys, rowRange, scrollToShow, visibleRange } from "./outline"
import type { Structure } from "./structure"

const item = (key: string): TreeNode => ({ kind: "item", key })
const group = (id: string, ...children: ReadonlyArray<TreeNode>): TreeNode => ({
  kind: "group",
  id,
  name: `Group ${id}`,
  tags: id === "g" ? ["bridge"] : [],
  children
})

/** g > (h > (a), b); c; e (empty) */
const structure: Structure = {
  tree: [group("g", group("h", item("a")), item("b")), item("c"), group("e")],
  items: new Map([["b", { tags: ["start", "ramp"] }]])
}
const names = new Map([["a", "Cube 1"], ["b", "Left ramp"], ["c", "Cube 2"]])
const classes = new Map([["a", "BP_Prim_Cube"], ["b", "BP_Ramp"], ["c", "BP_Prim_Cube"]])
const rowsOf = (collapsed: ReadonlyArray<string> = [], query = "") =>
  outlineRows(structure, names, classes, new Set(collapsed), query)
const ids = (rows: ReturnType<typeof rowsOf>) => rows.map((row) => row.id)

describe("outlineRows", () => {
  it("lists the tree in order with depth, parent and place", () => {
    const rows = rowsOf()
    assert.deepStrictEqual(ids(rows), ["g", "h", "a", "b", "c", "e"])
    assert.deepStrictEqual(rows.map((row) => row.depth), [0, 1, 2, 1, 0, 0])
    assert.deepStrictEqual(rows.map((row) => row.parentId), [null, "g", "h", "g", null, null])
    assert.deepStrictEqual(rows.map((row) => row.index), [0, 0, 0, 1, 1, 2])
  })

  it("gives names, classes, tags and counts", () => {
    const [g, , , b] = rowsOf()
    assert.strictEqual(g?.name, "Group g")
    assert.strictEqual(g?.childCount, 2)
    assert.strictEqual(g?.itemCount, 2)
    assert.deepStrictEqual(g?.tags, ["bridge"])
    assert.strictEqual(b?.name, "Left ramp")
    assert.strictEqual(b?.className, "BP_Ramp")
    assert.deepStrictEqual(b?.tags, ["start", "ramp"])
  })

  it("hides what a collapsed group holds, and still counts it", () => {
    const rows = rowsOf(["g"])
    assert.deepStrictEqual(ids(rows), ["g", "c", "e"])
    assert.isTrue(rows[0]!.collapsed)
    assert.strictEqual(rows[0]!.itemCount, 2)
  })
})

describe("the filter", () => {
  it("matches names and shows the ancestors", () => {
    assert.deepStrictEqual(ids(rowsOf([], "cube 1")), ["g", "h", "a"])
  })

  it("matches classes and tags", () => {
    assert.deepStrictEqual(ids(rowsOf([], "bp_ramp")), ["g", "b"])
    assert.deepStrictEqual(ids(rowsOf([], "START")), ["g", "b"])
  })

  it("needs every word", () => {
    assert.deepStrictEqual(ids(rowsOf([], "cube ramp")), [])
    assert.deepStrictEqual(ids(rowsOf([], "left  start")), ["g", "b"])
  })

  it("matches a group by its own name and tags, without what it holds", () => {
    assert.deepStrictEqual(ids(rowsOf([], "bridge")), ["g"])
    assert.deepStrictEqual(ids(rowsOf([], "group h")), ["g", "h"])
  })

  it("looks inside collapsed groups, and shows them open", () => {
    const rows = rowsOf(["g", "h"], "cube 1")
    assert.deepStrictEqual(ids(rows), ["g", "h", "a"])
    assert.isFalse(rows[0]!.collapsed)
  })

  it("is off for a blank query", () => {
    assert.strictEqual(rowsOf([], "   ").length, 6)
  })
})

describe("rowRange and rowKeys", () => {
  const rows = rowsOf()

  it("runs between two rows in either direction", () => {
    assert.deepStrictEqual(ids(rowRange(rows, "a", "c")), ["a", "b", "c"])
    assert.deepStrictEqual(ids(rowRange(rows, "c", "a")), ["a", "b", "c"])
  })

  it("is the one row without a start that's shown", () => {
    assert.deepStrictEqual(ids(rowRange(rows, null, "c")), ["c"])
    assert.deepStrictEqual(ids(rowRange(rows, "gone", "c")), ["c"])
  })

  it("expands group rows to their items", () => {
    assert.deepStrictEqual(rowKeys(structure.tree, rowRange(rowsOf(["g"]), "g", "c")), ["a", "b", "c"])
  })
})

describe("dropTargetAt", () => {
  const rows = rowsOf()
  const noDrag = new Set<string>()
  const drop = (rowIndex: number, fraction: number, dragged: ReadonlySet<string> = noDrag) =>
    dropTargetAt(rows, structure.tree.length, rowIndex, fraction, dragged)

  it("splits an item row into before and after", () => {
    assert.deepInclude(drop(4, 0.2), { position: "before", parentId: null, index: 1, rowId: "c", depth: 0 })
    assert.deepInclude(drop(4, 0.8), { position: "after", parentId: null, index: 2, rowId: "c", depth: 0 })
  })

  it("drops beside an item in its own group", () => {
    assert.deepInclude(drop(3, 0.8), { position: "after", parentId: "g", index: 2, depth: 1 })
    assert.deepInclude(drop(2, 0.2), { position: "before", parentId: "h", index: 0, depth: 2 })
  })

  it("splits a group row into before, into and after", () => {
    assert.deepInclude(drop(5, 0.1), { position: "before", parentId: null, index: 2 })
    assert.deepInclude(drop(1, 0.5), { position: "into", parentId: "h", index: 1, rowId: "h" })
    assert.deepInclude(drop(5, 0.9), { position: "after", parentId: null, index: 3 })
  })

  it("makes the gap below an open group its first child's", () => {
    assert.deepInclude(drop(0, 0.9), { position: "after", parentId: "g", index: 0, depth: 1, rowId: "g" })
  })

  it("goes past a collapsed group, not into it", () => {
    const collapsed = rowsOf(["g"])
    assert.deepInclude(dropTargetAt(collapsed, 3, 0, 0.9, noDrag), { position: "after", parentId: null, index: 1 })
  })

  it("lands at the end of the root below the last row", () => {
    assert.deepInclude(drop(6, 0), { rowId: null, position: "after", parentId: null, index: 3, depth: 0 })
  })

  it("refuses a dragged node and everything inside it", () => {
    assert.strictEqual(drop(4, 0.2, new Set(["c"])), undefined)
    assert.strictEqual(drop(2, 0.5, new Set(["g"])), undefined)
    assert.strictEqual(drop(1, 0.5, new Set(["h"])), undefined)
  })

  it("allows a node next to one being dragged", () => {
    assert.deepInclude(drop(4, 0.2, new Set(["h"])), { position: "before", parentId: null, index: 1 })
  })
})

describe("indexOnceLeft", () => {
  const flat: Structure = { tree: ["a", "b", "c", "d"].map(item), items: new Map() }

  it("takes off the dragged nodes before the gap", () => {
    assert.strictEqual(indexOnceLeft(flat, { parentId: null, index: 3 }, new Set(["a", "b"])), 1)
    assert.strictEqual(indexOnceLeft(flat, { parentId: null, index: 1 }, new Set(["c"])), 1)
  })

  it("counts in the target group", () => {
    assert.strictEqual(indexOnceLeft(structure, { parentId: "g", index: 2 }, new Set(["h"])), 1)
    assert.strictEqual(indexOnceLeft(structure, { parentId: "g", index: 2 }, new Set(["c"])), 2)
  })
})

describe("the scroll window", () => {
  it("covers the rows in view and the overscan, inside the list", () => {
    assert.deepStrictEqual(visibleRange(0, 240, 24, 3750, 5), { start: 0, end: 15 })
    assert.deepStrictEqual(visibleRange(2400, 240, 24, 3750, 5), { start: 95, end: 115 })
    assert.deepStrictEqual(visibleRange(89_760, 240, 24, 3750, 5), { start: 3735, end: 3750 })
    assert.deepStrictEqual(visibleRange(0, 0, 24, 0, 5), { start: 0, end: 0 })
  })

  it("moves no further than it takes to show a row", () => {
    assert.strictEqual(scrollToShow(5, 0, 240, 24), 0)
    assert.strictEqual(scrollToShow(5, 1000, 240, 24), 120)
    assert.strictEqual(scrollToShow(50, 0, 240, 24), 984)
  })
})
