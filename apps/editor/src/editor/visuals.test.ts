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
})
