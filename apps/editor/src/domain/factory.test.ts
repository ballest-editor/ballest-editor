import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "./bundledCatalog.json"
import { Catalog } from "./Catalog"
import {
  formatCreatedAt,
  identityTransform,
  itemFromPiece,
  newMapFile,
  placementTransform,
  qualifyMaterialPath
} from "./factory"
import { classNameOf, isPlayerStart, Item, MapFile, objectPathOf } from "./MapFile"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
const cube = catalog.pieces.find((p) => p.className === "BP_Prim_Cube")!
const track = catalog.pieces.find((p) => p.className === "BP_Track_Short1")!

describe("factory", () => {
  it("builds a palette item with the full shape the game writes", () => {
    const item = itemFromPiece(track, identityTransform({ x: 1, y: 2, z: 3 }))
    // decodes with the schema and has the game's key order
    const decoded = Schema.decodeUnknownSync(Item)(JSON.parse(JSON.stringify(item)))
    assert.deepStrictEqual(Object.keys(Schema.encodeSync(Item)(decoded)), [
      "actorToSpawn",
      "itemTransform",
      "meshComponents",
      "bIsBaseItem",
      "boolProperties",
      "floatProperties",
      "intProperties",
      "textProperties",
      "nameProperties",
      "stringProperties"
    ])
    const mesh = item.meshComponents[0]!
    assert.deepStrictEqual(Object.keys(mesh), ["meshComponentTag", "materials", "meshAssetPath", "materialAssetPaths"])
    assert.strictEqual(mesh.meshComponentTag, "SKGMapEditor")
    assert.strictEqual(mesh.meshAssetPath, track.meshAssetPath)
    assert.deepStrictEqual(mesh.materials.map((m) => m.materialIndex), [0, 1])
    const bare = "/Game/Art/Materials/Environment/Materials/M_BaseSurface_Metal.M_BaseSurface_Metal"
    assert.deepStrictEqual(mesh.materials.map((m) => m.material), [
      `/Script/Engine.Material'${bare}'`,
      `/Script/Engine.Material'${bare}'`
    ])
    assert.deepStrictEqual(mesh.materialAssetPaths, [bare, bare])
    assert.isFalse(item.bIsBaseItem)
    assert.deepStrictEqual(item.floatProperties, [])
    assert.strictEqual(itemFromPiece(cube, identityTransform()).actorToSpawn, cube.classPath)
  })

  it("qualifies bare material paths the way map files store them", () => {
    assert.strictEqual(
      qualifyMaterialPath("/Game/Art/MI_GoldWorn.MI_GoldWorn"),
      "/Script/Engine.MaterialInstanceConstant'/Game/Art/MI_GoldWorn.MI_GoldWorn'"
    )
    assert.strictEqual(qualifyMaterialPath("/Game/M_Glass.M_Glass"), "/Script/Engine.Material'/Game/M_Glass.M_Glass'")
    const already = "/Script/Engine.Material'/Game/M.M'"
    assert.strictEqual(qualifyMaterialPath(already), already)
  })

  it("places the player start at the in-game default scale", () => {
    const start = catalog.pieces.find((p) => p.className === "MP_PlayerStart")!
    assert.deepStrictEqual(placementTransform(start, { x: 1, y: 2, z: 3 }).scale3D, {
      x: 0.276538,
      y: 0.276538,
      z: 0.276538
    })
  })

  it("creates a new map with exactly one player start that decodes", () => {
    const map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "2026.01.02-03.04.05" })
    const decoded = Schema.decodeUnknownSync(MapFile)(JSON.parse(JSON.stringify(map)))
    assert.strictEqual(decoded.items.filter(isPlayerStart).length, 1)
    assert.strictEqual(decoded.worldSettings.levelData.userLevelName, "A_B")
    assert.isFalse(decoded.worldSettings.levelData.bValidated)
  })

  it("formats createdAt and parses class/material paths", () => {
    assert.strictEqual(
      formatCreatedAt({ year: 2026, month: 3, day: 7, hour: 9, minute: 5, second: 1, millisecond: 0 }),
      "2026.03.07-09.05.01"
    )
    assert.strictEqual(classNameOf(cube.classPath), "BP_Prim_Cube")
    assert.strictEqual(objectPathOf("/Script/Engine.Material'/Game/M.M'"), "/Game/M.M")
  })
})

describe("palette sections", () => {
  it("groups by category in file order, then Other, then hidden pieces", async () => {
    const { paletteSections, HIDDEN_SECTION, OTHER_SECTION, pieceLabelOf } = await import("./Catalog")
    const base = Schema.encodeSync(Catalog)(catalog).pieces[0]!
    const piece = (className: string, extra: Record<string, unknown>) =>
      Schema.decodeSync(Catalog)({ pieces: [{ ...base, className, ...extra }] }).pieces[0]!
    const sections = paletteSections([
      piece("A", { category: "Tracks" }),
      piece("B", { category: "Shapes", displayName: "Big B" }),
      piece("C", {}),
      piece("D", { category: "Tracks", inPalette: false }),
      piece("E", { category: "Tracks" })
    ])
    assert.deepStrictEqual(sections.map((s) => [s.name, s.pieces.map((p) => p.className)]), [
      ["Tracks", ["A", "E"]],
      ["Shapes", ["B"]],
      [OTHER_SECTION, ["C"]],
      [HIDDEN_SECTION, ["D"]]
    ])
    assert.isTrue(sections.at(-1)!.hidden)
    assert.strictEqual(pieceLabelOf(sections[1]!.pieces[0]!), "Big B")
  })
})
