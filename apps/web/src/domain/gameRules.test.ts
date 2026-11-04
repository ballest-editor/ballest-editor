import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import fs from "node:fs"
import path from "node:path"
import { listSamples, readSample, repoRoot } from "../test/samples"
import { decodeCatalog, indexCatalog } from "./Catalog"
import { addItem, setTransforms } from "./edits"
import { editTransform } from "./editTransform"
import { defaultEditorState, identityTransform, itemFromPiece, newMapFile, playerStartItem } from "./factory"
import { gameRuleProblems } from "./gameRules"
import { selectionProperties } from "./itemProperties"
import { gameLoadProblems } from "./limits"
import { type Item, MapFile } from "./MapFile"

const catalog = indexCatalog(
  Effect.runSync(decodeCatalog(JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "catalog.json"), "utf8"))))
)

const fresh = (): MapFile => newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
const CUBE = "BP_Prim_Cube"
const pathOf = (className: string) => [...catalog.pieceByClass.keys()].find((p) => p.includes(`.${className}_C`))!
const MESH = catalog.pieceByClass.get(pathOf(CUBE))!.meshAssetPath!
const MATERIAL = "/Game/Art/Materials/Environment/Materials/M_BaseSurface_Metal.M_BaseSurface_Metal"
const slot = (materialIndex: number) => ({ material: `/Script/Engine.Material'${MATERIAL}'`, materialIndex })
const mesh = {
  meshComponentTag: "SKGMapEditor",
  materials: [slot(0)],
  meshAssetPath: MESH,
  materialAssetPaths: [MATERIAL]
}
const cube = (patch: Partial<Item> = {}): Item => ({
  ...playerStartItem(),
  actorToSpawn: pathOf(CUBE),
  meshComponents: [mesh],
  ...patch
})
const int = (propertyName: string) => ({ currentValue: 0, propertyName, propertyType: "Integer" })
const withCube = (patch: Partial<Item>): MapFile => addItem(fresh(), cube(patch))
const levelData = (map: MapFile) => map.worldSettings.levelData
const difficulty = (levelDifficulty: string): MapFile => {
  const map = fresh()
  return {
    ...map,
    worldSettings: { ...map.worldSettings, levelData: { ...levelData(map), levelDifficulty } }
  }
}
const editorState = (patch: Partial<NonNullable<MapFile["editorState"]>>): MapFile => {
  const map = addItem(fresh(), cube())
  return {
    ...map,
    editorState: {
      ...defaultEditorState(),
      ...patch
    }
  }
}
const pivot = (itemIndex: number, choice = "Center") => ({
  itemIndex,
  pivot: { choice, localPosition: { x: 0, y: 0, z: 50 } }
})
const frame = (w = 1) => ({
  rotation: { x: 0, y: 0, z: 0, w },
  translation: { x: 0, y: 0, z: 0 },
  scale3D: { x: 1, y: 1, z: 1 }
})
const group = (name: string, w = 1) => ({ members: [0, 1], name, frame: frame(w) })

/** The classes the game reloads only with `meshComponents: []`. */
const NO_MESH_CLASSES = ["BP_TwoCubeOneColor", "BP_TwoCubeTwoColor", "MP_OrangeSign"]

// Each of these opened a blank map in the game, or left the map off the Create page (docs/qa/limits-validation.md).
const refused: ReadonlyArray<readonly [string, MapFile, RegExp]> = [
  [
    "a class that doesn't exist",
    withCube({ actorToSpawn: "/Script/Engine.BlueprintGeneratedClass'/Game/N/BP_N.BP_N_C'" }),
    /BP_N, which isn't a map piece/
  ],
  [
    "a class that isn't a map piece",
    withCube({
      actorToSpawn: "/Script/Engine.BlueprintGeneratedClass'/Game/Core/Gameplay/MapTriggers/BP_KillZone.BP_KillZone_C'"
    }),
    /BP_KillZone/
  ],
  [
    "a class the game no longer ships",
    withCube({ actorToSpawn: pathOf("MP_PinballPaddle"), meshComponents: [] }),
    /MP_PinballPaddle/
  ],
  ["a property the class doesn't have", withCube({ intProperties: [int("NoSuchProp")] }), /NoSuchProp property/],
  [
    "a property in the wrong list",
    withCube({ floatProperties: [{ ...int("SurfaceAssignment"), propertyType: "Float" }] }),
    /SurfaceAssignment property/
  ],
  ["a property set twice", withCube({ intProperties: [int("SurfaceAssignment"), int("SurfaceAssignment")] }), /twice/],
  ["a property with no name", withCube({ intProperties: [int("")] }), /no name/],
  ["the same mesh component twice", withCube({ meshComponents: [mesh, mesh] }), /same mesh component twice/],
  [
    "a second component with another tag",
    withCube({ meshComponents: [mesh, { ...mesh, meshComponentTag: "Other" }] }),
    /2 mesh components/
  ],
  [
    "a mesh that isn't cooked",
    withCube({ meshComponents: [{ ...mesh, meshAssetPath: "/Game/N/SM_N.SM_N" }] }),
    /doesn't have/
  ],
  ["a negative material slot", withCube({ meshComponents: [{ ...mesh, materials: [slot(-1)] }] }), /slot -1/],
  [
    "a material slot set twice",
    withCube({ meshComponents: [{ ...mesh, materials: [slot(0), slot(0)] }] }),
    /slot 0 twice/
  ],
  [
    "more material paths than slots",
    withCube({ meshComponents: [{ ...mesh, materialAssetPaths: [MATERIAL, MATERIAL, MATERIAL] }] }),
    /lists 3 materials/
  ],
  [
    "over 256 materials",
    withCube({ meshComponents: [{ ...mesh, materials: Array.from({ length: 257 }, (_, i) => slot(i)) }] }),
    /more than 256/
  ],
  ["an unknown difficulty", difficulty("Impossible"), /Create page/],
  ["an empty difficulty", difficulty(""), /Create page/],
  ["editor state version 0", editorState({ version: 0 }), /version 0/],
  ["editor state version 2", editorState({ version: 2 }), /version 2/],
  ["two pivots on an item", editorState({ pivots: [pivot(1), pivot(1, "Top")] }), /two pivots/],
  ["an unknown pivot choice", editorState({ pivots: [pivot(1, "Sideways")] }), /Sideways/],
  ["a group name of 65 characters", editorState({ groups: [group("A".repeat(65))] }), /1 to 64/],
  ["a group name with a space", editorState({ groups: [group("A B")] }), /1 to 64/],
  ["a group frame that isn't normalized", editorState({ groups: [group("G", 2)] }), /non-normalized/],
  ...NO_MESH_CLASSES.map((className) =>
    [
      `one mesh component on a ${className}`,
      withCube({ actorToSpawn: pathOf(className), meshComponents: [mesh] }),
      /mesh components, which makes the game discard the whole map/
    ] as const
  ),
  [
    "an empty mesh component on a MP_OrangeSign",
    withCube({
      actorToSpawn: pathOf("MP_OrangeSign"),
      meshComponents: [{ ...mesh, meshAssetPath: "", materials: [], materialAssetPaths: [] }]
    }),
    /MP_OrangeSign with mesh components/
  ]
]

// The samples the game won't open. `hidden probe 2` holds the three classes it saves but won't reload: BP_TwoCubeOneColor,
// BP_TwoCubeTwoColor and MP_OrangeSign (docs/qa/exposed-properties.md).
const refusedInSamples: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["props probe", ["Item 15 is a MP_PinballPaddle, which isn't a map piece in this game version."]],
  [
    "hidden probe 2",
    [[27, "BP_TwoCubeOneColor"], [28, "BP_TwoCubeTwoColor"], [44, "MP_OrangeSign"]].map(([item, className]) =>
      `Item ${item} is a ${className} with mesh components, which makes the game discard the whole map. Delete it.`
    )
  ]
]

// Each of these loaded in the game.
const accepted: ReadonlyArray<readonly [string, MapFile]> = [
  ["a piece as the game saves it", withCube({})],
  ["a bare class path", withCube({ actorToSpawn: pathOf(CUBE).replace(/^[^']*'(.*)'$/, "$1") })],
  ["a class hidden from the palette", withCube({ actorToSpawn: pathOf("BP_Prim_Sphere"), meshComponents: [] })],
  ["no mesh components", withCube({ meshComponents: [] })],
  ["an unknown tag on the one component", withCube({ meshComponents: [{ ...mesh, meshComponentTag: "Other" }] })],
  [
    "a mesh of another piece",
    withCube({
      meshComponents: [{
        ...mesh,
        meshAssetPath: "/Game/Maps/_GENERATED/PC/SM_GoalRing.SM_GoalRing",
        materials: [],
        materialAssetPaths: []
      }]
    })
  ],
  ["no material paths", withCube({ meshComponents: [{ ...mesh, materialAssetPaths: [] }] })],
  ["a difficulty in another case", difficulty("beginner")],
  ["a difficulty with its enum's prefix", difficulty("EBallgameDifficulty::Expert")],
  ["a pivot on the start", editorState({ pivots: [pivot(0)] })],
  ["the WorldOrigin pivot", editorState({ pivots: [pivot(1, "WorldOrigin")] })],
  ["pivots out of order", editorState({ pivots: [pivot(1), pivot(0)] })],
  ["a group name of 64 characters", editorState({ groups: [group("A".repeat(64))] })],
  ["a group with no name", editorState({ groups: [group("")] })],
  ...NO_MESH_CLASSES.map((className) =>
    [
      `a ${className} with no mesh components`,
      withCube({ actorToSpawn: pathOf(className), meshComponents: [] })
    ] as const
  )
]

describe("the game's rules", () => {
  it.each(refused)("refuses %s", (_, map, message) => {
    assert.match(gameRuleProblems(map, catalog).join(" "), message)
  })

  it.each(accepted)("accepts %s", (_, map) => {
    assert.deepStrictEqual(gameRuleProblems(map, catalog), [])
  })

  it("refuses a mesh component on the classes that load without one, with no catalog to go by", () => {
    const map = withCube({ actorToSpawn: pathOf("BP_TwoCubeOneColor"), meshComponents: [mesh] })
    assert.match(gameRuleProblems(map, null).join(" "), /discard the whole map/)
  })

  it("keeps to the parser's limits on any JSON value", () => {
    const withPad = (pad: unknown): MapFile => ({ ...fresh(), pad })
    const nest = (depth: number): unknown => depth === 0 ? 0 : [nest(depth - 1)]
    const problems = (pad: unknown) => gameRuleProblems(withPad(pad), null)
    assert.deepStrictEqual(problems("a".repeat(1_048_576)), [])
    assert.match(problems("a".repeat(1_048_577))[0]!, /1048577 characters/)
    assert.deepStrictEqual(problems({ ["k".repeat(4096)]: 1 }), [])
    assert.match(problems({ ["k".repeat(4097)]: 1 })[0]!, /field name/)
    assert.deepStrictEqual(problems(Array.from({ length: 100_000 }, () => 0)), [])
    assert.match(problems(Array.from({ length: 100_001 }, () => 0))[0]!, /100001 entries/)
    assert.deepStrictEqual(problems(nest(63)), [])
    assert.match(problems(nest(64))[0]!, /nests deeper/)
  })

  it("leaves the catalog's rules out without a catalog", () => {
    assert.deepStrictEqual(gameRuleProblems(withCube({ actorToSpawn: "/Game/N/BP_N.BP_N_C" }), null), [])
  })

  it("the class in a problem is the file's item", () => {
    const map = addItem(fresh(), cube({ actorToSpawn: "/Game/N/BP_N.BP_N_C" }))
    assert.match(gameLoadProblems(map, catalog).join(" "), new RegExp(`Item ${map.items.length - 1} is a BP_N`))
  })

  it.each(["BP_UGCCircuitDecal", "BP_UGCShapeDecal"])("takes a %s's size from the Scale row alone", (className) => {
    const piece = catalog.pieceByClass.get(pathOf(className))!
    const placed = itemFromPiece(piece, identityTransform({ x: 0, y: 0, z: 0 }))
    const isSize = (name: string) => ["DecalHeight", "DecalWidth", "DecalDepth"].includes(name)
    const unsized = { ...placed, floatProperties: placed.floatProperties.filter((p) => !isSize(p.propertyName)) }
    for (const item of [placed, unsized]) {
      const map = addItem(fresh(), item)
      const scale3D = { x: 500, y: 300, z: 60 }
      const resized = setTransforms(map, [[map.items.length - 1, { ...editTransform(item), scale3D }]])
      const next = Option.getOrThrow(resized)
      assert.deepStrictEqual(editTransform(next.items.at(-1)!).scale3D, scale3D)
      assert.deepStrictEqual(gameLoadProblems(next, catalog), [])
    }
    assert.isFalse(selectionProperties([{ item: placed, piece }]).some((p) => isSize(p.name)))
  })

  // A false alarm here would stop a player saving a map the game loads. The props probe is from 0.4.0: it has the
  // pinball paddle 0.4.1 took out of the game, and a map with one opens blank.
  it.each(listSamples().map((s) => [s.name, s] as const))("finds only what the game refuses in %s", (name, sample) => {
    const map = Schema.decodeSync(Schema.fromJsonString(MapFile))(readSample(sample))
    assert.deepStrictEqual(gameRuleProblems(map, catalog), refusedInSamples.find(([s]) => name.includes(s))?.[1] ?? [])
  })
})
