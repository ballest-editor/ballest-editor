/**
 * Mirroring against the game's own saves: the "new pieces probe" draft (0.4.1) has a bevel
 * mirrored on X, on Y and on both, a mirrored cube, paddle and spinning cylinder, and
 * unmirrored controls. Skipped without the extractor's catalog.
 */
import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { listSamples, readSample, repoRoot } from "../test/samples"
import { Catalog, type CatalogIndex, indexCatalog } from "./Catalog"
import { withProperty } from "./itemProperties"
import { type Item, MapFile } from "./MapFile"
import {
  isMirrorFlag,
  MIRROR_X,
  MIRROR_Y,
  mirrorFlagsOf,
  mirrorScaleOf,
  PHYSICS_FLIP,
  sourceMeshOf,
  withMirrorMesh
} from "./mirror"

const catalogPath = path.join(repoRoot, "assets", "catalog.json")
const hasCatalog = fs.existsSync(catalogPath)

const probe = () => {
  const file = listSamples().find((f) => f.name.includes("new pieces probe"))!
  return Schema.decodeSync(Schema.fromJsonString(MapFile))(readSample(file)).items
}

const setFlag = (item: Item, name: string, value: boolean): Item => {
  if (!item.boolProperties.some((p) => p.propertyName === name)) return item
  return Option.getOrThrow(withProperty(item, { list: "boolProperties", name, type: "Bool" }, value))
}

const withFlags = (item: Item, index: CatalogIndex, x: boolean, y: boolean): Item =>
  withMirrorMesh(setFlag(setFlag(item, MIRROR_X, x), MIRROR_Y, y), index)

const mainMesh = (item: Item) => item.meshComponents[0]?.meshAssetPath ?? ""
const className = (item: Item) => item.actorToSpawn.slice(item.actorToSpawn.lastIndexOf(".") + 1, -3)

describe.skipIf(!hasCatalog)("mirroring", () => {
  const index = () =>
    indexCatalog(Schema.decodeSync(Schema.fromJsonString(Catalog))(fs.readFileSync(catalogPath, "utf8")))

  it("writes every probe item's mesh and materials as the game did, from its unmirrored form", () => {
    const idx = index()
    for (const saved of probe()) {
      const { x, y } = mirrorFlagsOf(saved)
      const plain = withFlags(saved, idx, false, false)
      assert.strictEqual(mainMesh(plain), sourceMeshOf(idx, mainMesh(saved)))
      assert.deepStrictEqual(
        withFlags(plain, idx, x, y),
        saved,
        `${className(saved)} mirrored ${x ? "X" : ""}${y ? "Y" : ""}`
      )
    }
  })

  it("draws one-axis mirrors with the bake's source scaled along that axis, both as a half turn", () => {
    const idx = index()
    const items = probe()
    const bevels = items.filter((i) => className(i) === "Bevel_Full_ShortUScoop_L")
    assert.deepStrictEqual(bevels.map((i) => mirrorScaleOf(i, idx)), [
      undefined,
      [-1, 1, 1],
      [1, -1, 1],
      [-1, -1, 1],
      [-1, 1, 1]
    ])
    // Mirror X on its own and Mirror Y on its own save the same bake; both together the original
    assert.strictEqual(mainMesh(bevels[1]!), mainMesh(bevels[2]!))
    assert.strictEqual(mainMesh(bevels[3]!), mainMesh(bevels[0]!))
    // the spinning cylinder keeps its mesh (no bake) and only flips its cap
    const cylinder = items.filter((i) => className(i) === "BP_SpinningCylinder")[1]!
    assert.isTrue(mirrorFlagsOf(cylinder).x)
    assert.isUndefined(mirrorScaleOf(cylinder, idx))
    assert.match(cylinder.meshComponents[0]!.materials[1]!.material, /Cap_Flipped/)
  })
})

// Measured on 0.4.1 (docs/qa/exposed-properties.md): Flip Y sets PhysicsFlip on these two, which have no bMirror. One
// axis saves the paddle's bake and the cylinder's flipped cap; both axes save the paddle's own mesh and the normal cap.
describe.skipIf(!hasCatalog)("Flip Y on the physics props", () => {
  const index = () => indexCatalog(Schema.decodeUnknownSync(Catalog)(JSON.parse(fs.readFileSync(catalogPath, "utf8"))))
  const palette = () =>
    listSamples()
      .filter((f) => f.name.includes("palette probe"))
      .flatMap((f) => Schema.decodeSync(Schema.fromJsonString(MapFile))(readSample(f)).items)
  const named = (name: string) => palette().find((item) => className(item) === name)!
  const flipped = (item: Item, x: boolean, y: boolean) =>
    withMirrorMesh(setFlag(setFlag(item, MIRROR_X, x), PHYSICS_FLIP, y), index())
  const cap = (item: Item) => item.meshComponents[0]?.materials.at(-1)?.material ?? ""

  it("reads PhysicsFlip as the y flag", () => {
    const flag = (propertyName: string): Item => ({
      ...named("BP_PhysicsPaddle"),
      boolProperties: [{ currentValue: true, propertyName, propertyType: "Bool" }]
    })
    assert.deepStrictEqual(mirrorFlagsOf(flag(PHYSICS_FLIP)), { x: false, y: true })
    assert.deepStrictEqual(mirrorFlagsOf(flag(MIRROR_Y)), { x: false, y: true })
    assert.isTrue(isMirrorFlag(PHYSICS_FLIP))
    assert.isFalse(isMirrorFlag("bFacingOnly"))
  })

  it("saves the paddle's bake on one axis and its own mesh on both", () => {
    const paddle = named("BP_PhysicsPaddle")
    assert.include(mainMesh(flipped(paddle, false, true)), "SM_Mirror_a1c6e610f778cbb47635")
    assert.include(mainMesh(flipped(paddle, true, false)), "SM_Mirror_a1c6e610f778cbb47635")
    assert.strictEqual(mainMesh(flipped(paddle, true, true)), mainMesh(paddle))
  })

  it("keeps the cylinder's mesh and swaps its cap on one axis, not on both", () => {
    const cylinder = named("BP_SpinningCylinder")
    const yOnly = flipped(cylinder, false, true)
    assert.strictEqual(mainMesh(yOnly), mainMesh(cylinder))
    assert.include(cap(yOnly), "MI_SpinningCylinderCap_Flipped")
    assert.include(cap(flipped(cylinder, true, true)), "MI_SpinningCylinderCap_Normal")
  })
})
