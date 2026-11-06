import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { repoRoot } from "../test/samples"
import { Catalog, indexCatalog } from "./Catalog"
import { playerStartItem } from "./factory"
import type { Item } from "./MapFile"
import { lookupMaterial, NEUTRAL, parseMaterialsFile } from "./Materials"
import {
  choiceOf,
  colorForFinish,
  colorLabelOf,
  cssColor,
  finishLabelOf,
  materialLabelOf,
  offPanelSlotsOf,
  paintGroups,
  paintTargets,
  parsePaint,
  swatchColor
} from "./Paint"
import { SURFACE_PROPERTY } from "./surface"

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

const classOf = (name: string) => `/Script/Engine.BlueprintGeneratedClass'/Game/X/${name}.${name}_C'`
const itemOf = (name: string, surface = 0, meshAssetPath = "/Game/X/SM.SM"): { readonly item: Item } => ({
  item: {
    ...playerStartItem(),
    actorToSpawn: classOf(name),
    meshComponents: [{ meshComponentTag: "SKGMapEditor", meshAssetPath, materials: [], materialAssetPaths: [] }],
    intProperties: [{ propertyName: SURFACE_PROPERTY, propertyType: "Integer", currentValue: surface }]
  }
})
const piece = (name: string, paintable?: boolean, offPanelPaint?: ReadonlyArray<number>) => ({
  classPath: classOf(name),
  className: name,
  meshAssetPath: null,
  materialSlots: [],
  ...(paintable === undefined ? {} : { paintable }),
  ...(offPanelPaint === undefined ? {} : { offPanelPaint })
})
const index = indexCatalog(
  Schema.decodeSync(Catalog)({
    pieces: [piece("Cube", true), piece("Light", false), piece("Glass", false, [0, 2]), piece("Old")]
  })
)

describe("what the game's panel lists", () => {
  it("leaves out pieces that don't take paint, and keeps the rest of the selection", () => {
    const cube = itemOf("Cube"), light = itemOf("Light")
    assert.deepStrictEqual(paintTargets([cube, light], index), { surfaceLocked: false, items: [cube] })
    assert.deepStrictEqual(paintTargets([light], index).items, [])
  })

  it("keeps a locked piece with off-panel slots, and only those slots", () => {
    const glass = itemOf("Glass")
    assert.deepStrictEqual(paintTargets([glass], index).items, [glass])
    assert.deepStrictEqual([...(offPanelSlotsOf(glass.item, index) ?? [])], [0, 2])
    assert.strictEqual(offPanelSlotsOf(itemOf("Light").item, index)?.size, 0)
  })

  it("has no off-panel slots on a piece the panel paints itself", () => {
    assert.isUndefined(offPanelSlotsOf(itemOf("Cube").item, index))
    assert.isUndefined(offPanelSlotsOf(itemOf("Old").item, index))
    assert.isUndefined(offPanelSlotsOf(itemOf("Glass").item, null))
  })

  it("locks off-panel slots with the rest while a surface is set", () => {
    assert.deepStrictEqual(paintTargets([itemOf("Glass", 1)], index), { surfaceLocked: true, items: [] })
  })

  it("keeps pieces a catalog doesn't say anything about", () => {
    const old = itemOf("Old"), unknown = itemOf("Gone")
    assert.deepStrictEqual(paintTargets([old, unknown], index).items, [old, unknown])
    assert.deepStrictEqual(paintTargets([old], null).items, [old])
  })

  it("lists nothing for the whole selection once one item has a surface", () => {
    assert.deepStrictEqual(paintTargets([itemOf("Cube"), itemOf("Cube", 2)], index), {
      surfaceLocked: true,
      items: []
    })
  })

  it("groups by class, so a mirrored item's baked mesh stays with its piece", () => {
    const plain = itemOf("Cube"), mirrored = itemOf("Cube", 0, "/Game/Mirror/SM_Mirror_1.SM_Mirror_1")
    const other = itemOf("Old")
    assert.deepStrictEqual(paintGroups([plain, other, mirrored]), [[plain, mirrored], [other]])
  })
})

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

  it("names finishes, colours and off-picker materials as a person would", () => {
    assert.strictEqual(finishLabelOf({ name: "smooth", colors: [] }), "Smooth")
    assert.strictEqual(colorLabelOf({ color: "SkyBlue", material: "" }), "Sky Blue")
    assert.strictEqual(
      materialLabelOf("/Script/Engine.Material'/Game/Art/M_BaseSurface_Metal.M_BaseSurface_Metal'"),
      "Base Surface Metal"
    )
    assert.strictEqual(materialLabelOf("/Game/Art/MI_Env_Dark.MI_Env_Dark"), "Env Dark")
  })

  it("keeps the colour across finishes, and takes an unpainted slot for Grey", () => {
    const colors = (...names: ReadonlyArray<string>) => names.map((color) => ({ color, material: `/Game/${color}` }))
    const glossy = { name: "glossy", colors: colors("White", "Red") }
    const special = { name: "special", colors: colors("Grey", "Copper") }
    const red = { finish: { name: "rough", colors: colors("Red") }, color: { color: "Red", material: "/Game/Red" } }
    assert.strictEqual(colorForFinish(glossy, red)?.color, "Red")
    assert.isUndefined(colorForFinish(special, red))
    assert.strictEqual(colorForFinish(special, undefined)?.color, "Grey")
    assert.isUndefined(colorForFinish(glossy, undefined))
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
