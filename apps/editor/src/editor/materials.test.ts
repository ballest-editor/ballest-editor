import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { parseMaterialsFile } from "../domain/Materials"
import { BLUE, GLASS, materialsFile } from "../test/materials"
import { applySlotMaterials, materialFor, neutralMaterial, slotIndexOf } from "./materials"

describe("three materials", () => {
  it("builds cached three materials: blue is blue, glass is translucent, unknown is neutral", () => {
    const table = parseMaterialsFile(materialsFile)
    const blue = materialFor(table, BLUE)
    assert.isTrue(blue.color.b > blue.color.r && blue.color.b > blue.color.g)
    assert.strictEqual(materialFor(table, BLUE), blue) // cached
    const glass = materialFor(table, GLASS)
    assert.isTrue(glass.transparent)
    assert.isBelow(glass.opacity, 1)
    assert.strictEqual(glass.normalMap?.colorSpace, THREE.NoColorSpace)
    assert.strictEqual(glass.normalScale.y, -1)
    assert.strictEqual(glass.side, THREE.DoubleSide) // the game material is two-sided
    assert.strictEqual(blue.side, THREE.FrontSide)
    assert.strictEqual(materialFor(table, "/Game/Unknown.Unknown"), neutralMaterial())
    assert.strictEqual(materialFor(null, BLUE), neutralMaterial())
  })

  it("assigns materials per primitive by UE slot index", () => {
    const table = parseMaterialsFile(materialsFile)
    const root = new THREE.Group()
    const prim = (name: string) => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name }))
    const a = prim("0:Base")
    const b = prim("1:Glass")
    root.add(a, b)
    assert.deepStrictEqual([slotIndexOf(a), slotIndexOf(b)], [0, 1])
    applySlotMaterials(root, table, [BLUE, GLASS])
    assert.strictEqual(a.material, materialFor(table, BLUE))
    assert.strictEqual(b.material, materialFor(table, GLASS))
  })
})
