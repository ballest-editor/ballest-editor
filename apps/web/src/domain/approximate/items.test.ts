import { assert, describe, it } from "@effect/vitest"
import { emptyIndexWith } from "../../test/catalogIndex"
import { assertVec } from "../../test/vec"
import type { Vec3 } from "../coords"
import { quatConjugate, quatFromAxisAngle, rotateVec, vecAdd, vecSub } from "../ueMath"
import { itemsOfPlacements, pieceOfShape, transformOfPlacement } from "./items"
import { IDENTITY_QUAT, type Placement, shapeKinds, SHAPES } from "./shapes"

const turned = quatFromAxisAngle({ x: 0, y: 0.6, z: 0.8 }, 1.1)

const placementOf = (kind: Placement["kind"], rotation = turned): Placement => ({
  kind,
  center: { x: 100, y: -200, z: 300 },
  half: { x: 300, y: 200, z: 150 },
  rotation
})

/** Where the point `local` of a piece's own frame lands, as a share of the placement's box along the fitter's axes. */
const inBox = (placement: Placement, local: Vec3): Vec3 => {
  const t = transformOfPlacement(SHAPES[placement.kind].bounds, placement)
  const scaled = { x: local.x * t.scale3D.x, y: local.y * t.scale3D.y, z: local.z * t.scale3D.z }
  const world = vecAdd(t.translation, rotateVec(t.rotation, scaled))
  const own = rotateVec(quatConjugate(placement.rotation), vecSub(world, placement.center))
  return { x: own.x / placement.half.x, y: own.y / placement.half.y, z: own.z / placement.half.z }
}

describe("transformOfPlacement", () => {
  it("stands a cube on its origin, scaled to the box", () => {
    const t = transformOfPlacement(SHAPES.box.bounds, {
      kind: "box",
      center: { x: 100, y: 200, z: 250 },
      half: { x: 500, y: 250, z: 125 },
      rotation: IDENTITY_QUAT
    })
    assertVec(t.translation, { x: 100, y: 200, z: 125 }, "translation")
    assertVec(t.scale3D, { x: 1, y: 0.5, z: 0.25 }, "scale")
  })

  it("puts the corners of every piece's bounds on the corners of a turned box", () => {
    for (const kind of shapeKinds) {
      const { max, min } = SHAPES[kind].bounds
      const low = inBox(placementOf(kind), { x: min[0], y: min[1], z: min[2] })
      const high = inBox(placementOf(kind), { x: max[0], y: max[1], z: max[2] })
      for (const axis of ["x", "y", "z"] as const) {
        assert.closeTo(Math.abs(low[axis]), 1, 1e-9, `${kind} ${axis}`)
        assert.closeTo(low[axis] + high[axis], 0, 1e-9, `${kind} ${axis}`)
      }
    }
  })

  it("points a cone's apex, a half sphere's dome and a capsule's length along the fitter's z", () => {
    // Each piece's own top, in its catalog frame (shapes.ts).
    assertVec(inBox(placementOf("cone"), { x: 0, y: 0, z: 200 }), { x: 0, y: 0, z: 1 }, "cone")
    assertVec(inBox(placementOf("hemisphere"), { x: 250, y: 0, z: 0 }), { x: 0, y: 0, z: 1 }, "hemisphere")
    assertVec(inBox(placementOf("capsule"), { x: 0, y: 0, z: 500 }), { x: 0, y: 0, z: 1 }, "capsule")
    // The half sphere's rim is on its flat face, the bottom of the box.
    assert.closeTo(inBox(placementOf("hemisphere"), { x: -250, y: 500, z: 0 }).z, -1, 1e-9)
  })
})

describe("itemsOfPlacements", () => {
  const cone = emptyIndexWith({
    className: "MP_Cone",
    meshAssetPath: "/Game/Meshes/SM_Cone.SM_Cone",
    materialSlots: [
      { index: 0, defaultMaterial: "/Game/Materials/MI_A.MI_A" },
      { index: 1, defaultMaterial: "/Game/Materials/MI_B.MI_B" }
    ],
    bounds: { min: [-150, -150, 0], max: [150, 150, 200] }
  })
  const offset = { x: 1000, y: 0, z: -50 }

  it("finds a shape's piece by its class name", () => {
    assert.strictEqual(pieceOfShape(cone.index, "cone")?.className, "MP_Cone")
    assert.isUndefined(pieceOfShape(cone.index, "sphere"))
  })

  it("makes an item a placement, moved by the offset, and names the shapes the catalog lacks once", () => {
    const placements = [
      placementOf("cone"),
      placementOf("sphere"),
      placementOf("cone", IDENTITY_QUAT),
      placementOf("sphere")
    ]
    const { items, missing } = itemsOfPlacements(cone.index, placements, offset)
    assert.deepStrictEqual(missing, ["sphere"])
    assert.lengthOf(items, 2)
    const expected = transformOfPlacement(SHAPES.cone.bounds, placementOf("cone"))
    assert.deepStrictEqual(items[0]?.itemTransform, { ...expected, translation: vecAdd(expected.translation, offset) })
    assert.strictEqual(items[0]?.actorToSpawn, cone.piece.classPath)
  })

  it("gives each item a rotation of its own", () => {
    const placements = [placementOf("cone", IDENTITY_QUAT), placementOf("cone", IDENTITY_QUAT)]
    const { items } = itemsOfPlacements(cone.index, placements, offset)
    assert.notStrictEqual(items[0]?.itemTransform.rotation, items[1]?.itemTransform.rotation)
    assert.notStrictEqual(items[0]?.itemTransform.rotation, IDENTITY_QUAT)
  })

  it("paints every slot of every piece one material when given one", () => {
    const paint = "/Script/Engine.MaterialInstanceConstant'/Game/Materials/MI_White.MI_White'"
    const { items } = itemsOfPlacements(cone.index, [placementOf("cone")], offset, paint)
    const meshes = items.flatMap((item) => item.meshComponents)
    assert.deepStrictEqual(meshes.flatMap((mesh) => mesh.materials.map((slot) => slot.material)), [paint, paint])
    const path = "/Game/Materials/MI_White.MI_White"
    assert.deepStrictEqual(meshes.flatMap((mesh) => mesh.materialAssetPaths), [path, path])
  })
})
