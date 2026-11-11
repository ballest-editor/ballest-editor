import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { PREFAB_TEXT } from "../test/prefabs"
import { expectVec } from "../test/vec"
import fixture from "./bundledCatalog.json"
import { Catalog, indexCatalog } from "./Catalog"
import { editTransform } from "./editTransform"
import { itemFromPiece, placementTransform } from "./factory"
import { DEFAULT_PLAYER_START } from "./level"
import { type Item, objectPathOf } from "./MapFile"
import {
  documentOrigin,
  freePrefabName,
  isPrefabName,
  itemOfPrefab,
  mapOfPrefab,
  prefabItemOf,
  prefabOfItems,
  prefabOfTab,
  prefabSourcesOf,
  prefabTierLabel,
  selectionLabelOf
} from "./prefab"
import { PrefabFile } from "./PrefabFile"
import { ORIGIN, rotatorToQuat } from "./ueMath"

const parsed = Schema.decodeUnknownSync(Catalog)(fixture)
const catalog = indexCatalog(parsed)
const cube = parsed.pieces.find((p) => p.className === "BP_Prim_Cube")!
const prefab = Schema.decodeSync(Schema.fromJsonString(PrefabFile))(PREFAB_TEXT)
const first = prefab.items[0]!
const second = prefab.items[1]!

const cubeAt = (x: number, y = 0, z = 0): Item => itemFromPiece(cube, placementTransform(cube, { x, y, z }))

describe("a tier's name in the UI", () => {
  it("says Game for the game's own folder, and Session where there are no projects", () => {
    assert.strictEqual(prefabTierLabel("user", true), "Game")
    assert.strictEqual(prefabTierLabel("project", true), "Project")
    assert.strictEqual(prefabTierLabel("user", false), "Session")
  })
})

describe("a prefab's items", () => {
  it("become map items at a frame", () => {
    const item = itemOfPrefab(first, { x: 100, y: 200, z: 300 }, catalog)
    assert.strictEqual(item.actorToSpawn, cube.classPath)
    assert.isFalse(item.bIsBaseItem)
    expectVec(item.itemTransform.translation, { x: -900, y: 200, z: 49.5 })
    assert.deepStrictEqual(item.itemTransform.scale3D, { x: 2, y: 1, z: 1 })
    const q = rotatorToQuat({ pitch: 0, yaw: 30, roll: 0 })
    assert.closeTo(item.itemTransform.rotation.z, q.z, 1e-12)
    assert.closeTo(item.itemTransform.rotation.w, q.w, 1e-12)
    const [mesh] = item.meshComponents
    assert.strictEqual(mesh?.meshAssetPath, first.meshes[0]?.mesh)
    assert.deepStrictEqual(mesh?.materialAssetPaths, first.meshes[0]?.materials)
    assert.strictEqual(objectPathOf(mesh?.materials[0]?.material ?? ""), first.meshes[0]?.materials[0])
    assert.include(mesh?.materials[0]?.material ?? "", "MaterialInstanceConstant'")
  })

  it("sort their flat properties into the map's typed lists, by value without a catalog entry", () => {
    const item = itemOfPrefab(first, ORIGIN, catalog)
    assert.deepStrictEqual(item.boolProperties, [
      { currentValue: false, propertyName: "bMirror", propertyType: "Bool" },
      { currentValue: true, propertyName: "bMirrorX", propertyType: "Bool" }
    ])
    assert.deepStrictEqual(item.intProperties, [
      { currentValue: 0, propertyName: "SurfaceAssignment", propertyType: "Integer" }
    ])
    const fractional = itemOfPrefab({ ...first, properties: { Strength: 1.5 } }, ORIGIN, catalog)
    assert.deepStrictEqual(fractional.floatProperties, [
      { currentValue: 1.5, propertyName: "Strength", propertyType: "Float" }
    ])
  })

  it("come back as they went, less paint, which a map has no field for", () => {
    const back = prefabItemOf(itemOfPrefab(second, { x: 5, y: 6, z: 7 }, catalog), { x: 5, y: 6, z: 7 })
    assert.strictEqual(back.class, second.class)
    assert.deepStrictEqual(back.properties, second.properties)
    assert.deepStrictEqual(back.meshes, second.meshes)
    assert.isUndefined(back.paint)
    for (const [i, value] of second.transform.location.entries()) {
      assert.closeTo(back.transform.location[i] ?? NaN, value, 1e-9)
    }
    for (const [i, value] of second.transform.rotation.entries()) {
      assert.closeTo(back.transform.rotation[i] ?? NaN, value, 1e-9)
    }
    assert.deepStrictEqual(back.transform.scale, second.transform.scale)
  })

  it("take no mesh component on a class the game only reloads without one", () => {
    const sign = { ...first, class: "/Game/MapItems/MP_OrangeSign.MP_OrangeSign_C" }
    assert.deepStrictEqual(itemOfPrefab(sign, ORIGIN, null).meshComponents, [])
  })
})

describe("a new prefab", () => {
  it("is measured from the centre of its items' turned bounds, as the game's frame is", () => {
    const items = [cubeAt(0), cubeAt(1000, 0, 500)]
    const made = prefabOfItems(items, catalog)
    const [a, b] = made.items
    assert.deepStrictEqual(made.group, { rotation: [0, 0, 0], scale: [1, 1, 1] })
    const bounds = cube.bounds!
    const middle = (i: 0 | 2) => ((bounds.min[i] + bounds.max[i]) / 2)
    assert.closeTo(a?.transform.location[0] ?? NaN, -500, 1e-9)
    assert.closeTo(b?.transform.location[0] ?? NaN, 500, 1e-9)
    assert.closeTo(a?.transform.location[2] ?? NaN, -250 - middle(2), 1e-9)
    assert.closeTo(middle(0), 0, 1e-9)
  })

  it("takes its group's name as the game does, leaving none out", () => {
    const items = [cubeAt(0), cubeAt(1000)]
    assert.strictEqual(prefabOfItems(items, catalog, "Left bridge!").group.name, "Leftbridge")
    assert.notProperty(prefabOfItems(items, catalog, "!!").group, "name")
  })
})

describe("a definition's tab", () => {
  const map = mapOfPrefab("Bridge", prefab, catalog)
  const keys = ["a", "b"]
  const sources = prefabSourcesOf(prefab, map.items, keys)

  it("holds the prefab's items and nothing else, in the sky", () => {
    assert.lengthOf(map.items, 2)
    assert.strictEqual(map.worldSettings.levelData.levelDisplayName, "Bridge")
    expectVec(map.items[0]!.itemTransform.translation, {
      x: DEFAULT_PLAYER_START.x - 1000,
      y: DEFAULT_PLAYER_START.y,
      z: DEFAULT_PLAYER_START.z - 250.5
    })
  })

  it("reads its positions from the prefab's frame, as the file stores them, where a map reads the world's", () => {
    const origin = documentOrigin({ kind: "prefab" })
    const { x, y, z } = map.items[0]!.itemTransform.translation
    const [fx, fy, fz] = prefab.items[0]!.transform.location
    expectVec({ x: x - origin.x, y: y - origin.y, z: z - origin.z }, { x: fx, y: fy, z: fz })
    assert.deepStrictEqual(documentOrigin({ kind: "map" }), ORIGIN)
  })

  it("writes untouched items back as they came, paint and all", () => {
    assert.deepStrictEqual(prefabOfTab(prefab, map.items, keys, sources), prefab)
  })

  it("keeps paint through a move, and drops it with a repaint, which it would override", () => {
    const a = map.items[0]!
    const b = map.items[1]!
    const moved: Item = {
      ...a,
      itemTransform: { ...a.itemTransform, translation: { ...a.itemTransform.translation, x: 0 } }
    }
    const repainted: Item = {
      ...b,
      meshComponents: b.meshComponents.map((mesh) => ({
        ...mesh,
        materialAssetPaths: ["/Game/Other.Other"],
        materials: [{ material: "/Script/Engine.Material'/Game/Other.Other'", materialIndex: 0 }]
      }))
    }
    const saved = prefabOfTab(prefab, [moved, repainted], keys, sources)
    assert.isDefined(saved.items[0]?.paint)
    assert.isUndefined(saved.items[1]?.paint)
    assert.strictEqual(saved.items[1]?.meshes[0]?.materials[0], "/Game/Other.Other")
    assert.closeTo(saved.items[0].transform.location[0], -DEFAULT_PLAYER_START.x, 1e-9)
  })

  it("adds items the tab gained", () => {
    const saved = prefabOfTab(prefab, [...map.items, cubeAt(0)], [...keys, "c"], sources)
    assert.lengthOf(saved.items, 3)
    assert.closeTo(saved.items[2]!.transform.location[0], -DEFAULT_PLAYER_START.x, 1e-9)
  })

  it("measures an item's transform as the editor edits it", () => {
    assert.deepStrictEqual(editTransform(map.items[0]!).scale3D, { x: 2, y: 1, z: 1 })
  })
})

describe("the name a selection suggests", () => {
  const kicker = { className: "BP_Ramp_Kicker1_Short", displayName: "Kicker1 S" }
  const curve = { className: "BP_Ramp_Curve1", displayName: "Curve1 M" }

  it("reads two of a piece as a pair of its family, and more as a count of the piece", () => {
    assert.strictEqual(selectionLabelOf([kicker, kicker]), "Kicker pair")
    assert.strictEqual(selectionLabelOf([curve, curve, curve]), "Curve 1 Medium x3")
  })

  it("reads a mix as a set of the first piece's family", () => {
    assert.strictEqual(selectionLabelOf([kicker, curve, curve]), "Kicker set")
  })

  it("names a piece the catalog doesn't know from its class", () => {
    assert.strictEqual(
      selectionLabelOf([{ className: "BP_Odd_Thing" }, { className: "BP_Odd_Thing" }]),
      "Odd Thing pair"
    )
  })

  it("keeps saveprefab's rule, whatever the label holds", () => {
    assert.strictEqual(freePrefabName("Curve 1 Medium x3", new Set()), "Curve_1_Medium_x3")
    assert.strictEqual(freePrefabName(" Left (pair)! ", new Set()), "Left_pair")
    assert.strictEqual(freePrefabName("×", new Set()), "Prefab")
    assert.isTrue(isPrefabName(freePrefabName("x".repeat(80), new Set())))
  })

  it("steers clear of the names in use, and stays in the rule's length doing it", () => {
    assert.strictEqual(freePrefabName("Kicker pair", new Set(["Kicker_pair"])), "Kicker_pair_2")
    assert.strictEqual(freePrefabName("Kicker pair", new Set(["Kicker_pair", "Kicker_pair_2"])), "Kicker_pair_3")
    const long = "x".repeat(60)
    assert.isTrue(isPrefabName(freePrefabName(long, new Set([long]))))
  })
})
