import { assert, describe, it } from "@effect/vitest"
import { nestedTree } from "../test/trees"
import {
  areaModeOf,
  AreaRegion,
  areaSelectionOf,
  areaUnitsOf,
  caughtUnitsOf,
  extendPath,
  type Point2
} from "./areaSelect"
import { clickLevelOf, nodeKeys, selectableKeys } from "./groupSelection"
import { treeKeys } from "./structure"

const p = (x: number, y: number): Point2 => ({ x, y })
const box = (x0: number, y0: number, x1: number, y1: number) => {
  const region = AreaRegion.of({ kind: "box", from: p(x0, y0), to: p(x1, y1) })
  if (region === undefined) throw new Error("no region")
  return region
}
const lasso = (...points: ReadonlyArray<readonly [number, number]>) => {
  const region = AreaRegion.of({ kind: "lasso", points: points.map(([x, y]) => p(x, y)) })
  if (region === undefined) throw new Error("no region")
  return region
}

describe("areaModeOf", () => {
  it("goes by direction: left to right is inside, right to left touching", () => {
    assert.strictEqual(areaModeOf("direction", p(100, 100), p(200, 50)), "inside")
    assert.strictEqual(areaModeOf("direction", p(100, 100), p(20, 300)), "touching")
  })
  it("is fixed by the setting otherwise", () => {
    assert.strictEqual(areaModeOf("touching", p(0, 0), p(10, 0)), "touching")
    assert.strictEqual(areaModeOf("inside", p(10, 0), p(0, 0)), "inside")
  })
})

describe("extendPath", () => {
  it("drops points too close to the last one kept", () => {
    const one = extendPath([], p(0, 0))
    assert.deepStrictEqual(extendPath(one, p(1, 1)), one)
    assert.strictEqual(extendPath(one, p(5, 0)).length, 2)
  })
})

describe("AreaRegion", () => {
  it("a box drawn either way holds the same points", () => {
    for (const region of [box(10, 10, 50, 40), box(50, 40, 10, 10)]) {
      assert.isTrue(region.contains(10, 10))
      assert.isTrue(region.contains(30, 20))
      assert.isFalse(region.contains(51, 20))
    }
  })

  it("a box touches a triangle with a corner inside, one around it, and one crossing it", () => {
    const region = box(0, 0, 10, 10)
    assert.isTrue(region.touchesTriangle(5, 5, 50, 5, 50, 50), "a corner inside")
    assert.isTrue(region.touchesTriangle(-100, -100, 100, -100, 0, 100), "wraps the box")
    assert.isTrue(region.touchesTriangle(-5, 5, 15, 4, 15, 6), "a sliver across it")
    assert.isFalse(region.touchesTriangle(12, -5, 30, -5, 12, 30), "beside it")
    // the triangle's bounds overlap the box, but its long edge passes the corner by
    assert.isFalse(region.touchesTriangle(5, 25, 25, 5, 25, 25), "past the diagonal")
  })

  it("a lasso is its closed path, concave parts included", () => {
    // a U: two arms joined at the bottom
    const u = lasso([0, 0], [10, 0], [10, 20], [20, 20], [20, 0], [30, 0], [30, 30], [0, 30])
    assert.isTrue(u.contains(5, 10), "left arm")
    assert.isTrue(u.contains(25, 10), "right arm")
    assert.isTrue(u.contains(15, 25), "base")
    assert.isFalse(u.contains(15, 10), "the gap between the arms")
    assert.isFalse(u.touchesTriangle(12, 2, 18, 2, 15, 15), "a triangle in the gap")
    assert.isTrue(u.touchesTriangle(12, 2, 18, 2, 15, 22), "one reaching the base")
    assert.isTrue(u.touchesTriangle(-50, -50, 100, -50, 15, 200), "one around the whole lasso")
  })

  it("files a lasso's edges by row, so a long path reads the same as a short one", () => {
    const circle = Array.from({ length: 400 }, (_, i) => {
      const a = (i / 400) * Math.PI * 2
      return [500 + 300 * Math.cos(a), 500 + 300 * Math.sin(a)] as const
    })
    const region = lasso(...circle)
    assert.isTrue(region.contains(500, 500))
    assert.isTrue(region.contains(500, 210))
    assert.isFalse(region.contains(500, 190))
    assert.isFalse(region.contains(260, 260))
  })

  it("a lasso of two points holds nothing yet", () => {
    assert.isUndefined(AreaRegion.of({ kind: "lasso", points: [p(0, 0), p(10, 10)] }))
  })
})

const tree = nestedTree

describe("areaUnitsOf", () => {
  it("reaches what a click reaches, at every level", () => {
    for (const entered of [null, "outer", "inner", "solo", "only"]) {
      const units = areaUnitsOf(tree, entered)
      for (const key of treeKeys(tree)) {
        const { nodeId } = clickLevelOf(tree, key, entered)
        if (!selectableKeys(tree, entered).includes(key)) continue
        assert.strictEqual(units.unitOf.get(key), nodeId, `${key} inside ${entered}`)
        assert.deepStrictEqual(units.keysOf.get(nodeId), nodeKeys(tree, nodeId))
      }
    }
  })
})

describe("caughtUnitsOf", () => {
  const units = areaUnitsOf(tree, null)
  const all = treeKeys(tree)

  it("touching catches a group by any of its items", () => {
    const touched = new Set(["b"])
    assert.deepStrictEqual(caughtUnitsOf(units, all, "touching", (key) => touched.has(key)), [["a", "b", "c"]])
  })

  it("inside catches a group only when all of its items are", () => {
    const inside = new Set(["a", "b", "d"])
    assert.deepStrictEqual(caughtUnitsOf(units, all, "inside", (key) => inside.has(key)), [["d"]])
    inside.add("c")
    assert.deepStrictEqual(caughtUnitsOf(units, all, "inside", (key) => inside.has(key)), [["a", "b", "c"], ["d"]])
  })

  it("inside an entered group, looks at its children alone", () => {
    const entered = areaUnitsOf(tree, "outer")
    const candidates = selectableKeys(tree, "outer")
    assert.deepStrictEqual(caughtUnitsOf(entered, candidates, "touching", () => true), [["a", "b"], ["c"]])
  })

  it("leaves out what isn't a candidate, without it keeping a group out", () => {
    // c can't be picked (hidden or locked, #81): a and b inside are the whole group as far as the box can see
    const inside = new Set(["a", "b"])
    assert.deepStrictEqual(
      caughtUnitsOf(units, ["a", "b", "d"], "inside", (key) => inside.has(key)),
      [["a", "b", "c"]]
    )
  })
})

describe("areaSelectionOf", () => {
  const distances = new Map([["a", 30], ["b", 5], ["c", 50], ["d", 10], ["e", 40]])
  const near = (key: string) => distances.get(key) ?? Infinity

  it("a plain drag selects what it caught, the item nearest the press active", () => {
    assert.deepStrictEqual(areaSelectionOf(["e"], [["a", "b", "c"], ["d"]], "replace", near), ["a", "c", "d", "b"])
    assert.deepStrictEqual(areaSelectionOf(["e"], [], "replace", near), [])
  })

  it("add keeps the selection and puts what is new after it", () => {
    assert.deepStrictEqual(areaSelectionOf(["e", "d"], [["d"], ["a"]], "add", near), ["e", "d", "a"])
    assert.deepStrictEqual(areaSelectionOf(["e", "d"], [["d"]], "add", near), ["e", "d"], "nothing new: unchanged")
  })

  it("toggle takes away whole units selected and adds the rest", () => {
    assert.deepStrictEqual(
      areaSelectionOf(["d", "e"], [["a", "b", "c"], ["d"]], "toggle", near),
      ["e", "a", "c", "b"]
    )
  })

  it("toggle adds the rest of a unit only partly selected", () => {
    assert.deepStrictEqual(areaSelectionOf(["a"], [["a", "b", "c"]], "toggle", near), ["a", "c", "b"])
  })

  it("remove takes away what it caught and leaves the active item if it stays", () => {
    assert.deepStrictEqual(areaSelectionOf(["a", "d", "e"], [["d"]], "remove", near), ["a", "e"])
    assert.deepStrictEqual(areaSelectionOf(["a", "e"], [["d"]], "remove", near), ["a", "e"])
  })
})
