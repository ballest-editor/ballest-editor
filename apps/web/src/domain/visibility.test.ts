import { assert, describe, it } from "@effect/vitest"
import { group, item, nestedTree } from "../test/trees"
import type { Structure } from "./structure"
import {
  flagStateOf,
  isolationOf,
  isPickable,
  isShown,
  keysWith,
  pickableSelection,
  toggledFlag,
  withFlag
} from "./visibility"

/** g > (a, b); c loose; d loose, named. */
const structure: Structure = {
  tree: [group("g", item("a"), item("b")), item("c"), item("d")],
  items: new Map([["d", { name: "Dee" }]])
}

const flagged = (on: Record<string, ReadonlyArray<"hidden" | "locked">>): Structure => ({
  ...structure,
  items: new Map(Object.entries(on).map(([key, flags]) => [key, Object.fromEntries(flags.map((f) => [f, true]))]))
})

describe("withFlag", () => {
  it("sets and clears a flag beside what an item already has, and drops an entry left with nothing", () => {
    const hidden = withFlag(structure, ["a", "d"], "hidden", true)!
    assert.deepStrictEqual(hidden.items.get("a"), { hidden: true })
    assert.deepStrictEqual(hidden.items.get("d"), { name: "Dee", hidden: true })
    const shown = withFlag(hidden, ["a", "d"], "hidden", false)!
    assert.isFalse(shown.items.has("a"))
    assert.deepStrictEqual(shown.items.get("d"), { name: "Dee" })
  })

  it("changes nothing, and says so, when every item already is as asked or isn't in the tree", () => {
    assert.isUndefined(withFlag(structure, ["a"], "locked", false))
    assert.isUndefined(withFlag(structure, ["nowhere"], "hidden", true))
    const locked = withFlag(structure, ["a"], "locked", true)!
    assert.isUndefined(withFlag(locked, ["a"], "locked", true))
  })

  it("keeps hidden and locked apart", () => {
    const both = withFlag(withFlag(structure, ["c"], "hidden", true)!, ["c"], "locked", true)!
    assert.deepStrictEqual(both.items.get("c"), { hidden: true, locked: true })
    assert.deepStrictEqual(withFlag(both, ["c"], "hidden", false)!.items.get("c"), { locked: true })
    assert.deepStrictEqual(keysWith(both, "locked"), ["c"])
  })
})

describe("isShown and isPickable", () => {
  const s = flagged({ a: ["hidden"], b: ["locked"] })
  const isolation = isolationOf(["a", "b", "c", "d"], ["a", "b", "c"])!

  it("draws what isn't hidden or left out by the isolation", () => {
    assert.deepStrictEqual(["a", "b", "c", "d"].filter((key) => isShown(s, null, key)), ["b", "c", "d"])
    assert.deepStrictEqual(["a", "b", "c", "d"].filter((key) => isShown(s, isolation, key)), ["b", "c"])
  })

  // the seam box and lasso select (#85) picks through
  it("picks what is drawn and not locked", () => {
    assert.deepStrictEqual(["a", "b", "c", "d"].filter((key) => isPickable(s, null, key)), ["c", "d"])
    assert.deepStrictEqual(["a", "b", "c", "d"].filter((key) => isPickable(s, isolation, key)), ["c"])
  })
})

describe("flagStateOf and toggledFlag", () => {
  it("says how much of a group has the flag, and a press sets it unless all of it has it", () => {
    const s = flagged({ a: ["hidden"] })
    assert.strictEqual(flagStateOf(s, ["a", "b"], "hidden"), "some")
    assert.strictEqual(flagStateOf(s, ["a"], "hidden"), "all")
    assert.strictEqual(flagStateOf(s, ["b"], "hidden"), "none")
    assert.isTrue(toggledFlag(s, ["a", "b"], "hidden"))
    assert.isFalse(toggledFlag(s, ["a"], "hidden"))
  })
})

describe("isolationOf", () => {
  it("leaves out everything but the keys, so what is added later shows", () => {
    const isolation = isolationOf(["a", "b", "c"], ["b"])!
    assert.deepStrictEqual([...isolation.outside], ["a", "c"])
    assert.isTrue(isShown(structure, isolation, "new"))
  })

  it("has nothing to isolate without keys", () => {
    assert.isUndefined(isolationOf(["a"], []))
  })
})

describe("pickableSelection", () => {
  const nested = nestedTree
  const all = () => true

  it("is every item in the map with nothing hidden or locked, in or out of a group", () => {
    assert.deepStrictEqual(pickableSelection(nested, null, all), ["a", "b", "c", "d", "e"])
  })

  it("is the entered group's items, nested ones too", () => {
    assert.deepStrictEqual(pickableSelection(nested, "outer", all), ["a", "b", "c"])
    assert.deepStrictEqual(pickableSelection(nested, "inner", all), ["a", "b"])
  })

  it("selects each node with an item a pick reaches, whole, hidden and locked members with it", () => {
    const s = flagged({ a: ["hidden"], c: ["locked"] })
    const pickable = (key: string) => isPickable(s, null, key)
    assert.deepStrictEqual(pickableSelection(s.tree, null, pickable), ["a", "b", "d"])
  })

  it("leaves out a group with nothing pickable, and inside an entered group takes its children", () => {
    const s = flagged({ a: ["hidden"], b: ["locked"] })
    const pickable = (key: string) => isPickable(s, null, key)
    assert.deepStrictEqual(pickableSelection(s.tree, null, pickable), ["c", "d"])
    const inside = flagged({ a: ["locked"] })
    assert.deepStrictEqual(pickableSelection(inside.tree, "g", (key) => isPickable(inside, null, key)), ["b"])
  })
})
