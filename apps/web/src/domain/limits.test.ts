import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { Catalog, type CatalogIndex, indexCatalog } from "./Catalog"
import { addItem } from "./edits"
import { defaultEditorState, identityTransform, newMapFile, playerStartItem } from "./factory"
import { gameLoadProblems, isNormalizedRotation, LIMITS } from "./limits"
import type { EditorState, Item, MapFile } from "./MapFile"

const fresh = (): MapFile => newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
const plain = (): Item => ({
  ...playerStartItem(),
  actorToSpawn: "/Script/Engine.BlueprintGeneratedClass'/Game/X/BP_X.BP_X_C'"
})
const withRotation = (item: Item, rotation: Item["itemTransform"]["rotation"]): Item => ({
  ...item,
  itemTransform: { ...identityTransform(), rotation }
})

const MESH = "/Game/X/SM_X.SM_X"
const BAKE = "/Game/LevelEditor/Mirror/Meshes/SM_Mirror_1.SM_Mirror_1"
const catalog: CatalogIndex = {
  ...indexCatalog(
    Schema.decodeSync(Catalog)({
      pieces: [],
      meshes: [{
        meshAssetPath: MESH,
        materialSlots: [{ index: 0, defaultMaterial: "/Game/A.A" }, { index: 1, defaultMaterial: "/Game/B.B" }]
      }]
    })
  ),
  mirrorSources: new Map([[BAKE, MESH]])
}
const withSlots = (meshAssetPath: string, slots: ReadonlyArray<number>): Item => ({
  ...plain(),
  meshComponents: [{
    meshComponentTag: "SKGMapEditor",
    meshAssetPath,
    materials: slots.map((materialIndex) => ({ material: "/Game/A.A", materialIndex })),
    materialAssetPaths: []
  }]
})

describe("game load rules", () => {
  it("rejects a material past the mesh's last slot, when the catalog knows the mesh", () => {
    const load = (item: Item, index: CatalogIndex | null = catalog) => gameLoadProblems(addItem(fresh(), item), index)
    assert.deepStrictEqual(load(withSlots(MESH, [0, 1])), [])
    assert.deepStrictEqual(load(withSlots(MESH, [0, 1, 2])), ["Item 2 sets material slot 3, but its mesh has 2."])
    assert.deepStrictEqual(load(withSlots(BAKE, [2])), ["Item 2 sets material slot 3, but its mesh has 2."])
    assert.deepStrictEqual(load(withSlots("/Game/Y/SM_Y.SM_Y", [7])), [])
    assert.deepStrictEqual(load(withSlots(MESH, [7]), null), [])
  })

  it("accepts a fresh map", () => {
    assert.deepStrictEqual(gameLoadProblems(fresh()), [])
  })

  it("requires exactly one player start", () => {
    assert.match(gameLoadProblems({ ...fresh(), items: [] })[0]!, /exactly one MP_PlayerStart.*has 0/)
    assert.match(gameLoadProblems(addItem(fresh(), playerStartItem()))[0]!, /has 2/)
  })

  it("rejects non-normalized rotations", () => {
    assert.isTrue(isNormalizedRotation({ x: 0, y: 0, z: Math.SQRT1_2 - 1e-5, w: Math.SQRT1_2 - 1e-5 }))
    assert.isFalse(isNormalizedRotation({ x: 0, y: 0, z: 1, w: 1 }))
    const map = addItem(fresh(), withRotation(plain(), { x: 0, y: 0, z: 1, w: 1 }))
    assert.deepStrictEqual(gameLoadProblems(map), ["Item 2 has a non-normalized rotation."])
  })

  it("enforces the per-item array limits", () => {
    const base = plain()
    const tooManyMeshes: Item = {
      ...base,
      meshComponents: Array.from({ length: LIMITS.meshComponentsPerItem + 1 }, () => base.meshComponents[0]!)
    }
    const tooManyProps: Item = {
      ...base,
      boolProperties: Array.from(
        { length: LIMITS.propertiesPerList + 1 },
        () => ({ propertyName: "b", propertyType: "Bool", currentValue: true })
      )
    }
    const problems = gameLoadProblems(addItem(addItem(fresh(), tooManyMeshes), tooManyProps))
    assert.strictEqual(problems.length, 2)
    assert.match(problems[0]!, /Item 2 has 65 mesh components/)
    assert.match(problems[1]!, /Item 3 has 4097 boolProperties/)
  })

  it("enforces the item-count limit without touching every item", () => {
    const items = Array.from({ length: LIMITS.itemsPerLevel + 1 }, () => plain())
    const map: MapFile = { ...fresh(), items: [playerStartItem(), ...items] }
    assert.match(gameLoadProblems(map)[0]!, /100002 items/)
  })
})

const withEditorState = (state: Partial<EditorState>): MapFile => {
  const map = addItem(addItem(fresh(), plain()), plain())
  return { ...map, editorState: { ...defaultEditorState(), ...state } }
}
const frame = {}

describe("game load rules for editorState", () => {
  // Each of these was opened in the game on 0.4.1, which opened a blank map instead (docs/qa/save-roundtrip.md).
  it.each([
    ["a group member past the last item", { groups: [{ members: [2, 99], frame }] }, /Group 0 .* item 99/],
    ["an empty group", { groups: [{ members: [], frame }] }, /Group 0 is empty/],
    [
      "an item in two groups",
      { groups: [{ members: [2, 3], frame }, { members: [3], frame }] },
      /Item 3 is in two groups/
    ],
    ["a group without a frame", { groups: [{ members: [2, 3] }] }, /Group 0 has no frame/],
    [
      "a pivot past the last item",
      { pivots: [{ itemIndex: 99, pivot: { choice: "Center", localPosition: { x: 0, y: 0, z: 0 } } }] },
      /pivot .* item 99/
    ]
  ])("refuses %s", (_, state, message) => {
    assert.match(gameLoadProblems(withEditorState(state)).join(" "), message)
  })

  // And each of these opened.
  it.each([
    ["a named group of two", { groups: [{ members: [2, 3], name: "a", frame }] }],
    ["a group of one", { groups: [{ members: [2], frame }] }],
    ["a group without a name", { groups: [{ members: [2, 3], frame }] }]
  ])("accepts %s", (_, state) => {
    assert.deepStrictEqual(gameLoadProblems(withEditorState(state)), [])
  })
})
