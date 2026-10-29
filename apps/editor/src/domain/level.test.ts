import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { listSamples, readSample } from "../test/samples"
import { newMapFile } from "./factory"
import { DEFAULT_PLAYER_START, floorHeightOf, KILL_ZONE_HEIGHT, WATER } from "./level"
import { isPlayerStart, MapFile } from "./MapFile"

const decodeSample = Schema.decodeSync(Schema.fromJsonString(MapFile))
const sample = (name: string) => {
  const file = listSamples().find((f) => f.name.includes(name))
  if (file === undefined) throw new Error(`no sample ${name}`)
  return decodeSample(readSample(file))
}

describe("level", () => {
  it("matches the player start of maps left where the game put it", () => {
    for (const name of ["achievement_TwoRibbons", "ct4NameBugTest", "flow trial", "Sway n So"]) {
      const start = sample(name).items.find(isPlayerStart)
      assert.deepStrictEqual(start?.itemTransform.translation, DEFAULT_PLAYER_START, name)
    }
  })

  it("puts a new map's player start there, above the water and the kill zone", () => {
    const map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
    assert.deepStrictEqual(map.items.find(isPlayerStart)?.itemTransform.translation, DEFAULT_PLAYER_START)
    assert.strictEqual(floorHeightOf(map), DEFAULT_PLAYER_START.z)
    assert.isAbove(KILL_ZONE_HEIGHT, 0)
    assert.isAbove(WATER.height, KILL_ZONE_HEIGHT)
    assert.isAbove(DEFAULT_PLAYER_START.z, WATER.height)
  })

  it("builds at the player start's height, or the game's default without one", () => {
    assert.strictEqual(floorHeightOf(sample("Ballest Of The Mall")), 653.5982360839844)
    const map = sample("Bevel Up")
    assert.strictEqual(floorHeightOf(map), 315)
    assert.strictEqual(floorHeightOf({ ...map, items: map.items.filter((i) => !isPlayerStart(i)) }), 8615)
  })
})
