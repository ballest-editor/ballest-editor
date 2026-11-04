import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { Catalog, indexCatalog } from "../domain/Catalog"
import { identityTransform, itemFromPiece } from "../domain/factory"
import { visualsOf } from "./visuals"

const CUBE = "/Engine/BasicShapes/Cube.Cube"
const BEAM = "/Game/Art/UsedMarketPlace/StylizedFX_Collection_q/M_AJ_LandRay.M_AJ_LandRay"
const GLOW = "/Game/Art/Materials/VFX/M_CheckpointPreGlow.M_CheckpointPreGlow"
const slot = (defaultMaterial: string) => ({ index: 0, defaultMaterial, meshMaterial: "/Engine/WorldGridMaterial" })
const extra = (name: string, material: string) => ({
  name,
  meshAssetPath: CUBE,
  glb: "pieces/_Engine/BasicShapes/Cube.glb",
  visible: true,
  transformRelativeToMain: { location: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
  materialSlots: [slot(material)]
})
// Two pieces drawing the same engine cube with different materials, like the air vent's beam and the
// checkpoint's glow panel.
const catalog = Schema.decodeUnknownSync(Catalog)({
  pieces: [
    {
      classPath: "/Game/Vent.Vent_C",
      className: "Vent",
      meshAssetPath: null,
      materialSlots: [],
      extraMeshes: [extra("WindCube", BEAM)]
    },
    {
      classPath: "/Game/Checkpoint.Checkpoint_C",
      className: "Checkpoint",
      meshAssetPath: null,
      materialSlots: [],
      extraMeshes: [extra("Aura", GLOW)]
    },
    {
      classPath: "/Game/TwoCubes.TwoCubes_C",
      className: "TwoCubes",
      meshAssetPath: CUBE,
      materialSlots: [slot(GLOW)],
      extraMeshes: [extra("Second", BEAM)]
    }
  ]
})

describe("visualsOf", () => {
  it("gives each extra mesh component its own slot materials, not the shared mesh's", () => {
    const index = indexCatalog(catalog)
    const [vent, checkpoint] = catalog.pieces
    assert.deepStrictEqual(visualsOf(itemFromPiece(vent!, identityTransform()), index).map((v) => v.slotMaterials), [[
      BEAM
    ]])
    assert.deepStrictEqual(
      visualsOf(itemFromPiece(checkpoint!, identityTransform()), index).map((v) => v.slotMaterials),
      [[
        GLOW
      ]]
    )
  })

  it("draws the class's Main mesh for an item with no mesh components, as the game does", () => {
    const index = indexCatalog(catalog)
    const [vent, , twoCubes] = catalog.pieces
    const bare = (piece: typeof twoCubes) => ({ ...itemFromPiece(piece!, identityTransform()), meshComponents: [] })
    assert.deepStrictEqual(
      visualsOf(bare(twoCubes), index).map((v) => [v.key, v.mesh?.meshAssetPath, v.slotMaterials]),
      [
        ["main", CUBE, [GLOW]],
        ["x0", CUBE, [BEAM]]
      ]
    )
    // a class with no Main mesh is its extras
    assert.deepStrictEqual(visualsOf(bare(vent), index).map((v) => v.key), ["x0"])
  })
})

describe("visualsOf, 0.4.1", () => {
  const BAKE = "/Game/LevelEditor/Mirror/Meshes/SM_Mirror_1.SM_Mirror_1"
  const ICE = "/Game/Ice.Ice"
  const box = Schema.decodeSync(Catalog)({
    pieces: [{
      classPath: "/Game/Box.Box_C",
      className: "Box",
      meshAssetPath: CUBE,
      glb: "pieces/_Engine/BasicShapes/Cube.glb",
      materialSlots: [slot(BEAM), { ...slot(GLOW), index: 1 }]
    }],
    mirrors: { meshes: [{ meshAssetPath: CUBE, mirrorMeshAssetPath: BAKE }] }
  })

  it("draws a baked mirror as its source mesh, and a surface over every slot", () => {
    const index = indexCatalog(box)
    const item = itemFromPiece(box.pieces[0]!, identityTransform())
    const mirrored = { ...item, meshComponents: [{ ...item.meshComponents[0]!, meshAssetPath: BAKE }] }
    assert.strictEqual(visualsOf(mirrored, index)[0]?.mesh?.meshAssetPath, CUBE)
    const iced = {
      ...item,
      intProperties: [{ currentValue: 2, propertyName: "SurfaceAssignment", propertyType: "Integer" }]
    }
    const surfaces = [{ name: "none", material: null }, { name: "magnet", material: null }, {
      name: "ice",
      material: ICE
    }]
    assert.deepStrictEqual(visualsOf(iced, index, surfaces)[0]?.slotMaterials, [ICE, ICE])
    assert.deepStrictEqual(visualsOf(item, index, surfaces)[0]?.slotMaterials.map((m) => m?.includes("LandRay")), [
      true,
      false
    ])
  })
})
