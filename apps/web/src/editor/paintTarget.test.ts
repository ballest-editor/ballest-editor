import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as THREE from "three"
import { Catalog, indexCatalog } from "../domain/Catalog"
import { mainMeshComponentOf, meshComponentFor, playerStartItem } from "../domain/factory"
import { defaultKeybinds } from "../domain/Keybinds"
import type { Item } from "../domain/MapFile"
import { SURFACE_PROPERTY } from "../domain/surface"
import {
  type Brush,
  PAINT_BLOCKED,
  paintHintOf,
  type PaintSpot,
  paintSpotOf,
  paintTargetOf,
  pickedBrushOf,
  showsTarget
} from "./paintTarget"
import { VISUAL_KEY } from "./visuals"

const classOf = (name: string) => `/Script/Engine.BlueprintGeneratedClass'/Game/X/${name}.${name}_C'`
const meshOf = (name: string) => `/Game/X/SM_${name}.SM_${name}`
const defaultOf = (name: string, slot: number) => `/Game/X/M_${name}${slot}.M_${name}${slot}`
const qualified = (path: string) => `/Script/Engine.Material'${path}'`
const RED = "/Script/Engine.MaterialInstanceConstant'/Game/X/MI_Env_Rough_Red.MI_Env_Rough_Red'"

const surfaceProperty = (hidden: boolean) => ({
  name: SURFACE_PROPERTY,
  list: "intProperties",
  type: "Integer",
  default: 0,
  hidden
})

/** A three-slot piece; `extras` adds an extra mesh, `surface` whether the game offers it one. */
const piece = (
  name: string,
  options: { paintable?: boolean; offPanelPaint?: ReadonlyArray<number>; surface?: boolean; meshless?: boolean } = {}
) => ({
  classPath: classOf(name),
  className: name,
  meshAssetPath: options.meshless === true ? null : meshOf(name),
  materialSlots: [0, 1, 2].map((index) => ({ index, defaultMaterial: defaultOf(name, index) })),
  properties: [surfaceProperty(options.surface === false)],
  ...(options.paintable === undefined ? {} : { paintable: options.paintable }),
  ...(options.offPanelPaint === undefined ? {} : { offPanelPaint: options.offPanelPaint })
})

const index = indexCatalog(
  Schema.decodeUnknownSync(Catalog)({
    pieces: [
      piece("Box"),
      piece("Glass", { paintable: false, offPanelPaint: [0, 2], surface: false }),
      piece("Light", { paintable: false, offPanelPaint: [] }),
      piece("BP_TwoCubeOneColor")
    ],
    mirrors: {
      meshes: [{ meshAssetPath: meshOf("Box"), mirrorMeshAssetPath: "/Game/LevelEditor/Mirror/SM_BoxM.SM_BoxM" }]
    }
  })
)

/** An item of piece `name`, with one mesh component listing `listed` slots at their defaults (none: no component). */
const itemOf = (
  name: string,
  options: { listed?: ReadonlyArray<number> | null; surface?: number; mesh?: string } = {}
): Item => ({
  ...playerStartItem(),
  actorToSpawn: classOf(name),
  meshComponents: options.listed === null
    ? []
    : [{
      ...meshComponentFor(options.mesh ?? meshOf(name), []),
      materials: (options.listed ?? [0, 1, 2]).map((slot) => ({
        material: qualified(defaultOf(name, slot)),
        materialIndex: slot
      }))
    }],
  intProperties: [{ propertyName: SURFACE_PROPERTY, propertyType: "Integer", currentValue: options.surface ?? 0 }]
})

const red: Brush = { _tag: "Material", material: RED }
const spot = (visual: string | undefined, slot: number): PaintSpot => ({ itemId: "a", visual, slot })

describe("what the paint tool's pointer is over", () => {
  /** An item's object as ItemObject builds it: the item, its visuals, a mesh per slot. */
  const tree = () => {
    const item = new THREE.Group()
    item.userData = { itemId: "a" }
    const primitive = (visual: THREE.Object3D, slot: number) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry())
      mesh.geometry.userData = { ueMaterialIndex: slot }
      // glbs nest their primitives under a node of their own
      const node = new THREE.Group()
      node.add(mesh)
      visual.add(node)
      return mesh
    }
    const visual = (key: string) => {
      const group = new THREE.Group()
      group.userData = { [VISUAL_KEY]: key }
      item.add(group)
      return group
    }
    const m0 = visual("m0")
    const x0 = visual("x0")
    const meshes = {
      slot1: primitive(m0, 1),
      slot1Again: primitive(m0, 1),
      slot2: primitive(m0, 2),
      extra: primitive(x0, 1),
      bare: primitive(item, 0)
    }
    const line = new THREE.LineSegments()
    item.add(line)
    return { item, line, meshes }
  }
  const hit = (object: THREE.Object3D) => ({ object, distance: 1, point: new THREE.Vector3() })

  it("finds the item, the visual and the slot of the nearest mesh hit", () => {
    const { line, meshes } = tree()
    assert.deepStrictEqual(paintSpotOf([hit(line), hit(meshes.slot2)]), spot("m0", 2))
    assert.deepStrictEqual(paintSpotOf([hit(meshes.extra)]), spot("x0", 1))
    // a part of the item outside its visuals (a laser's beam)
    assert.deepStrictEqual(paintSpotOf([hit(meshes.bare)]), spot(undefined, 0))
    assert.isUndefined(paintSpotOf([hit(new THREE.Mesh())]))
    assert.isUndefined(paintSpotOf([]))
  })

  it("outlines the hovered slot's primitives in its visual alone, or every mesh for the whole item", () => {
    const { meshes } = tree()
    const all = Object.values(meshes)
    const shows = (whole: boolean) => all.filter(showsTarget({ spot: spot("m0", 1), whole }))
    assert.deepStrictEqual(shows(false), [meshes.slot1, meshes.slot1Again])
    assert.deepStrictEqual(shows(true), all)
  })
})

describe("what a click with the paint tool paints", () => {
  const target = (item: Item, at: PaintSpot, brush: Brush = red, whole = false) =>
    paintTargetOf(at, item, index, brush, whole)
  const edits = (item: Item, at: PaintSpot, whole = false) => {
    const { effect } = target(item, at, red, whole)
    return effect._tag === "Slots" ? effect.edits.map(({ creates: _, ...edit }) => edit) : effect
  }

  it("paints the slot under the pointer, keyed by item, component and slot", () => {
    const t = target(itemOf("Box"), spot("m0", 1))
    assert.strictEqual(t.key, "a:0:1")
    assert.isFalse(t.whole)
    assert.deepStrictEqual(edits(itemOf("Box"), spot("m0", 1)), [{ component: 0, slot: 1, material: RED }])
  })

  it("lists the slots below an unlisted one at their defaults, so the list stays contiguous", () => {
    assert.deepStrictEqual(edits(itemOf("Box", { listed: [0] }), spot("m0", 2)), [
      { component: 0, slot: 1, material: defaultOf("Box", 1) },
      { component: 0, slot: 2, material: RED }
    ])
  })

  it("paints every slot of the item for the whole piece, keyed by the item", () => {
    const t = target(itemOf("Box"), spot("m0", 1), red, true)
    assert.strictEqual(t.key, "a")
    assert.isTrue(t.whole)
    assert.deepStrictEqual(
      edits(itemOf("Box"), spot("x0", 0), true),
      [0, 1, 2].map((slot) => ({
        component: 0,
        slot,
        material: RED
      }))
    )
  })

  it("creates the Main mesh component of an item with none, as a fresh piece has it", () => {
    const bare = itemOf("Box", { listed: null })
    const t = target(bare, spot("main", 2))
    assert.strictEqual(t.key, "a:0:2") // the same slot once the component exists and it draws as m0
    assert.deepStrictEqual(t.effect, {
      _tag: "Slots",
      edits: [{
        component: 0,
        slot: 2,
        material: RED,
        creates: mainMeshComponentOf(index.pieceByClass.get(classOf("Box"))!)
      }]
    })
  })

  it("never paints at or past the mesh's slot count, or a mesh the catalog doesn't know", () => {
    assert.deepStrictEqual(edits(itemOf("Box"), spot("m0", 3)), { _tag: "Blocked", reason: PAINT_BLOCKED.unknownSlots })
    const unknown = itemOf("Box", { mesh: "/Game/X/SM_Gone.SM_Gone" })
    assert.deepStrictEqual(edits(unknown, spot("m0", 0)), { _tag: "Blocked", reason: PAINT_BLOCKED.unknownSlots })
  })

  it("paints a mirrored item's slots as its source mesh's", () => {
    const mirrored = itemOf("Box", { mesh: "/Game/LevelEditor/Mirror/SM_BoxM.SM_BoxM" })
    assert.deepStrictEqual(edits(mirrored, spot("m0", 2)), [{ component: 0, slot: 2, material: RED }])
  })

  it("blocks paint on an item with a surface, but lets a surface replace it", () => {
    const iced = itemOf("Box", { surface: 2 })
    assert.deepStrictEqual(edits(iced, spot("m0", 0)), { _tag: "Blocked", reason: PAINT_BLOCKED.surfaceLocked })
    assert.deepStrictEqual(edits(iced, spot("m0", 0), true), { _tag: "Blocked", reason: PAINT_BLOCKED.surfaceLocked })
    const t = target(iced, spot("m0", 0), { _tag: "Surface", value: 0 })
    assert.deepStrictEqual([t.key, t.whole, t.effect], ["a", true, { _tag: "Surface", value: 0 }])
  })

  it("paints a piece the panel locks only on its off-panel slots", () => {
    const glass = itemOf("Glass")
    assert.deepStrictEqual(edits(glass, spot("m0", 1)), { _tag: "Blocked", reason: PAINT_BLOCKED.offPanel })
    assert.deepStrictEqual(edits(glass, spot("m0", 2)), [{ component: 0, slot: 2, material: RED }])
    assert.deepStrictEqual(
      edits(glass, spot("m0", 1), true),
      [0, 2].map((slot) => ({
        component: 0,
        slot,
        material: RED
      }))
    )
    const light = itemOf("Light")
    assert.deepStrictEqual(edits(light, spot("m0", 0)), { _tag: "Blocked", reason: PAINT_BLOCKED.notPainted })
    assert.deepStrictEqual(edits(light, spot("m0", 0), true), { _tag: "Blocked", reason: PAINT_BLOCKED.notPainted })
  })

  it("never paints an extra mesh, or a class the game only loads without components", () => {
    assert.deepStrictEqual(edits(itemOf("Box"), spot("x0", 0)), { _tag: "Blocked", reason: PAINT_BLOCKED.extra })
    assert.deepStrictEqual(edits(itemOf("Box"), spot(undefined, 0)), { _tag: "Blocked", reason: PAINT_BLOCKED.nothing })
    const pair = itemOf("BP_TwoCubeOneColor", { listed: null })
    assert.deepStrictEqual(edits(pair, spot("main", 0), true), {
      _tag: "Blocked",
      reason: PAINT_BLOCKED.noComponents
    })
  })

  it("gives a surface only to a piece the game offers one", () => {
    const ice: Brush = { _tag: "Surface", value: 2 }
    assert.deepStrictEqual(target(itemOf("Box"), spot("m0", 0), ice).effect, { _tag: "Surface", value: 2 })
    assert.deepStrictEqual(target(itemOf("Glass"), spot("m0", 0), ice).effect, {
      _tag: "Blocked",
      reason: PAINT_BLOCKED.noSurface
    })
    // a class the catalog doesn't know keeps the surface it saved
    const unknown = { ...itemOf("Box"), actorToSpawn: classOf("Gone") }
    assert.deepStrictEqual(target(unknown, spot("m0", 0), ice).effect, { _tag: "Surface", value: 2 })
  })
})

describe("the paint tool's eyedropper", () => {
  it("picks the material drawn at the slot, the item's own or the catalog's default", () => {
    const painted = itemOf("Box")
    const withRed = {
      ...painted,
      meshComponents: [{ ...painted.meshComponents[0]!, materials: [{ material: RED, materialIndex: 1 }] }]
    }
    assert.deepStrictEqual(pickedBrushOf(spot("m0", 1), withRed, index), red)
    assert.deepStrictEqual(pickedBrushOf(spot("m0", 2), withRed, index), {
      _tag: "Material",
      material: qualified(defaultOf("Box", 2))
    })
    assert.isUndefined(pickedBrushOf(spot("m0", 7), withRed, index))
  })

  it("picks the surface of an item that has one", () => {
    assert.deepStrictEqual(pickedBrushOf(spot("m0", 1), itemOf("Box", { surface: 3 }), index), {
      _tag: "Surface",
      value: 3
    })
  })
})

describe("the paint tool's hint", () => {
  it("names the keys the clicks are bound to", () => {
    assert.strictEqual(
      paintHintOf(defaultKeybinds),
      "Click or drag to paint a slot · Hold Shift for the whole piece · Alt + click picks"
    )
    assert.strictEqual(
      paintHintOf({ ...defaultKeybinds, paintWholePiece: [], pickPaint: ["Ctrl+Alt+Mouse0"] }),
      "Click or drag to paint a slot · Ctrl + Alt + click picks"
    )
  })
})
