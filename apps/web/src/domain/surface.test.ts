import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { listSamples, readSample, repoRoot } from "../test/samples"
import { MapFile } from "./MapFile"
import { parseSurfaces, surfaceLabel, surfaceMaterialOf, surfaceOf } from "./surface"

const materialsPath = path.join(repoRoot, "assets", "materials.json")

describe("item surfaces", () => {
  it.skipIf(!fs.existsSync(materialsPath))("reads the game's surfaces in the order they're saved", () => {
    const surfaces = parseSurfaces(JSON.parse(fs.readFileSync(materialsPath, "utf8")))
    assert.deepStrictEqual(surfaces.map((s) => surfaceLabel(s.name)), ["None", "Magnet", "Ice", "Grippy"])
    assert.isNull(surfaces[0]!.material)
    assert.match(surfaces[2]!.material ?? "", /MI_Surface_Ice/)
  })

  it("reads an item's surface as the probe saved it: 0 none, 1 magnet, 2 ice, 3 grippy", () => {
    const file = listSamples().find((f) => f.name.includes("new pieces probe"))!
    const items = Schema.decodeSync(Schema.fromJsonString(MapFile))(readSample(file)).items
    // the player start, the goal, an untouched cube, then magnet, ice, grippy and magnet set back to none
    assert.deepStrictEqual(items.slice(0, 7).map(surfaceOf), [0, 0, 0, 1, 2, 3, 0])
    const surfaces = [
      { name: "none", material: null },
      { name: "magnet", material: "/Game/M.M" },
      { name: "ice", material: "/Game/I.I" }
    ]
    assert.deepStrictEqual(items.slice(2, 6).map((i) => surfaceMaterialOf(i, surfaces)), [
      undefined,
      "/Game/M.M",
      "/Game/I.I",
      undefined // grippy isn't in this list
    ])
  })

  it("has none in a materials.json without them", () => {
    assert.deepStrictEqual(parseSurfaces({ materials: [] }), [])
    assert.deepStrictEqual(parseSurfaces({ surfaces: [{ name: "none", material: null }, { bad: 1 }] }).length, 1)
  })
})
