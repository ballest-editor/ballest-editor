import { assert, describe, it } from "@effect/vitest"
import { droppedMap, isMapDrag, startMapDrag } from "./mapDrag"

const FILE = "Map_LevelEditorMain&Big Loop_me.balledit"

/** The parts of a `DataTransfer` a drag uses. */
const transfer = (): DataTransfer => {
  const data = new Map<string, string>()
  const fake = {
    effectAllowed: "none",
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? ""
  }
  // @ts-expect-error -- only what's above is read
  return fake
}

describe("a map's drag", () => {
  it("carries the map's file name", () => {
    const drag = transfer()
    startMapDrag(drag, FILE)
    assert.isTrue(isMapDrag(drag))
    assert.strictEqual(droppedMap(drag), FILE)
    assert.strictEqual(drag.effectAllowed, "copy")
  })

  it("isn't any other drag, and no other name is a map", () => {
    const drag = transfer()
    assert.isFalse(isMapDrag(drag))
    assert.isUndefined(droppedMap(drag))
    drag.setData("application/x-ballest-map", "../outside.txt")
    assert.isUndefined(droppedMap(drag))
  })
})
