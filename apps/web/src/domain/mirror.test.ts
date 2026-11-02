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
import { MIRROR_X, MIRROR_Y, mirrorFlagsOf, mirrorScaleOf, sourceMeshOf, withMirrorMesh } from "./mirror"

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
