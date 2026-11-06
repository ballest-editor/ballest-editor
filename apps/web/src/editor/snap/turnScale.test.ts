import { assert, describe, it } from "@effect/vitest"
import { defaultSnapConfig } from "../../domain/snapConfig"
import { ORIGIN } from "../../domain/ueMath"
import { boxAt, cubeAt, meshOfBox } from "../../test/snapFixtures"
import { flushPairsOf, scaleStopsOf } from "./turnScale"

const at = { x: 100, y: 0, z: 0 }
const selection = { base: { x: 1, y: 0, z: 0 }, box: boxAt(ORIGIN), ends: [], pivotPoint: ORIGIN }

describe("what a turn and a scale stop on", () => {
  it("turns flush with a mesh's own faces, its box standing in until it has loaded", () => {
    const pairsOf = (mesh: ReturnType<typeof meshOfBox> | undefined) =>
      flushPairsOf(defaultSnapConfig, selection, [cubeAt("a", at, { mesh: () => mesh })], 10)
    const curved = { ...meshOfBox(boxAt(at)), faces: meshOfBox(boxAt(at)).faces.slice(0, 2) }
    assert.lengthOf(pairsOf(curved), 2)
    assert.lengthOf(pairsOf(undefined), 6)
  })

  it("scales up to a box's faces without asking for the mesh, however many items the map has", () => {
    const mesh = () => assert.fail("a scale doesn't place the map's meshes")
    const stops = scaleStopsOf({ x: 1, y: 0, z: 0 }, ORIGIN, [cubeAt("a", at, { mesh })])
    assert.deepStrictEqual(stops.map((stop) => stop.at).toSorted((a, b) => a - b), [50, 150])
  })
})
