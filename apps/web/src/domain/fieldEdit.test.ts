import { assert, describe, it } from "@effect/vitest"
import { identityTransform } from "./factory"
import { editThings, readThing, type Thing } from "./fieldEdit"
import { setEntry } from "./numberEntry"

describe("a row read from a document's origin (a prefab tab, documentOrigin)", () => {
  const at = identityTransform({ x: 100, y: 20, z: 300 })
  const thing: Thing = {
    unit: { id: "a", keys: ["a"], pivot: at.translation, transform: at, anchor: "a" },
    extent: undefined
  }
  const origin = { x: 50, y: 0, z: 200 }

  it("reads a location and a pivot from it, and sets a value measured from it", () => {
    for (const kind of ["location", "pivot"] as const) {
      const view = { kind, perUnit: 100, origin }
      assert.deepStrictEqual(readThing(thing, view), { x: 0.5, y: 0.2, z: 1 }, kind)
      const moved = editThings([thing], view, { x: setEntry(0) }, new Map([["a", at]]))
      assert.deepStrictEqual(moved.get("a")?.translation, { x: 50, y: 20, z: 300 }, kind)
    }
  })
})
