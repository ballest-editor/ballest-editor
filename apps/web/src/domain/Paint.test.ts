import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { repoRoot } from "../test/samples"
import { lookupMaterial, NEUTRAL, parseMaterialsFile } from "./Materials"
import { choiceOf, cssColor, parsePaint, swatchColor } from "./Paint"

const ROUGH_RED = "/Game/Art/Materials/Environment/Materials/Instances/MI_Env_Rough_Red.MI_Env_Rough_Red"
const qualified = (p: string) => `/Script/Engine.MaterialInstanceConstant'${p}'`
const file = {
  paint: [
    { name: "rough", colors: [{ color: "Red", material: qualified(ROUGH_RED) }] },
    {
      name: "special",
      colors: [{ color: "Iron", material: qualified("/Game/X/MI_Env_Iron.MI_Env_Iron"), displayColor: [0, 0, 1] }]
    },
    { name: "broken", colors: "nope" }
  ]
}

describe("paint", () => {
  it("parses the picker, dropping finishes that don't decode", () => {
    assert.deepStrictEqual(parsePaint(file).map((f) => f.name), ["rough", "special"])
    assert.deepStrictEqual(parsePaint({ materials: [] }), [])
    assert.deepStrictEqual(parsePaint(null), [])
  })

  it("finds the picker choice for a stored material by path, then by asset name", () => {
    const picker = parsePaint(file)
    assert.strictEqual(choiceOf(picker, qualified(ROUGH_RED))?.color.color, "Red")
    assert.strictEqual(choiceOf(picker, ROUGH_RED)?.finish.name, "rough")
    assert.strictEqual(choiceOf(picker, "/Game/Moved/MI_Env_Iron.MI_Env_Iron")?.color.color, "Iron")
    assert.isUndefined(choiceOf(picker, "/Game/Art/Stadium/Arena/MI_ArenaOrange2.MI_ArenaOrange2"))
    assert.isUndefined(choiceOf(picker, undefined))
  })

  it("colours swatches like the renderer, unless the game gives a colour", () => {
    const spec = { ...NEUTRAL, path: "x", baseColor: [0.1, 0.2, 0.3] as const }
    assert.deepStrictEqual(swatchColor(spec), [0.1, 0.2, 0.3])
    assert.deepStrictEqual(swatchColor(spec, [1, 0, 0]), [1, 0, 0])
    // emissive outshines a black base and is scaled into range
    assert.deepStrictEqual(swatchColor({ ...spec, baseColor: [0, 0, 0], emissive: [4, 2, 0] }), [1, 0.5, 0])
    assert.deepStrictEqual(swatchColor(undefined), NEUTRAL.baseColor)
    assert.strictEqual(cssColor([1, 0, 0.5]), "#ff00bc")
  })

  const real = path.join(repoRoot, "assets", "materials.json")
  it.skipIf(!fs.existsSync(real))("assets/materials.json has the game's picker, every choice extracted", () => {
    const json: unknown = JSON.parse(fs.readFileSync(real, "utf8"))
    const picker = parsePaint(json)
    assert.deepStrictEqual(picker.map((f) => f.name), [
      "smooth",
      "rough",
      "glossy",
      "concrete",
      "tiled",
      "emissive",
      "special"
    ])
    assert.deepStrictEqual(picker[0]!.colors.map((c) => c.color), [
      "White",
      "Black",
      "Red",
      "Orange",
      "Yellow",
      "Lime",
      "Blue",
      "SkyBlue",
      "Purple",
      "Wine"
    ])
    const table = parseMaterialsFile(json)
    for (const finish of picker) {
      for (const { material } of finish.colors) {
        assert.isTrue(material.startsWith("/Script/Engine."), material)
        assert.isDefined(lookupMaterial(table, material), material)
      }
    }
  })
})
