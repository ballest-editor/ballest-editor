import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { CatalogPiece } from "./Catalog"
import { setProperties } from "./edits"
import { identityTransform, itemFromPiece, newMapFile } from "./factory"
import {
  defaultProperties,
  type ItemProperty,
  optionLabel,
  propertyLabel,
  propertyRows,
  selectionFlip,
  selectionProperties,
  unconfirmedPropertiesIn,
  validPropertyValue,
  withFlip,
  withProperty
} from "./itemProperties"
import { Item, type MapFile } from "./MapFile"
import { mirrorFlagsOf } from "./mirror"

const decal = Schema.decodeSync(CatalogPiece)({
  classPath: "/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/Decals/BP_UGCCircuitDecal.BP_UGCCircuitDecal_C'",
  className: "BP_UGCCircuitDecal",
  meshAssetPath: null,
  materialSlots: [],
  bounds: null,
  properties: [
    { name: "DecalWidth", list: "floatProperties", type: "Float", default: 200, hidden: true },
    { name: "DecalStyle", list: "intProperties", type: "Integer", default: 0, hidden: false },
    { name: "bFacingOnly", list: "boolProperties", type: "Bool", default: true, hidden: false },
    // a native property the extractor couldn't type: never written or shown
    { name: "Mystery", list: null, type: null, default: null }
  ]
})

const placed = () => itemFromPiece(decal, identityTransform())
const width = { list: "floatProperties", name: "DecalWidth", type: "Float" } as const

const mapOf = (items: ReadonlyArray<Item>): MapFile => ({
  ...newMapFile({ displayName: "T", creatorName: "C", createdAt: "" }),
  items
})

describe("item properties", () => {
  it("places a piece with every exposed property at its default, as the game saves them", () => {
    const item = placed()
    assert.deepStrictEqual(defaultProperties(decal).floatProperties, [
      { currentValue: 200, propertyName: "DecalWidth", propertyType: "Float" }
    ])
    assert.deepStrictEqual(item.intProperties, [{
      currentValue: 0,
      propertyName: "DecalStyle",
      propertyType: "Integer"
    }])
    assert.deepStrictEqual(item.boolProperties, [{
      currentValue: true,
      propertyName: "bFacingOnly",
      propertyType: "Bool"
    }])
    assert.deepStrictEqual(item.textProperties, [])
    assert.doesNotThrow(() => Schema.decodeSync(Item)(item))
  })

  it("shows the catalog's properties in its order, defaults for missing ones, then the item's others", () => {
    const item: Item = {
      ...placed(),
      floatProperties: [{ currentValue: 1, propertyName: "Extra", propertyType: "Float" }],
      boolProperties: [{ currentValue: false, propertyName: "bFacingOnly", propertyType: "Bool" }]
    }
    const shown = selectionProperties([{ item, piece: decal }])
    assert.deepStrictEqual(shown.map((p) => [p.name, p.values, p.default, p.hidden]), [
      ["DecalWidth", [200], 200, true],
      ["DecalStyle", [0], 0, false],
      ["bFacingOnly", [false], true, false],
      ["Extra", [1], undefined, false]
    ])
    // without a catalog entry, only what the item stores, list by list
    assert.deepStrictEqual(selectionProperties([{ item, piece: undefined }]).map((p) => p.name), [
      "bFacingOnly",
      "Extra",
      "DecalStyle"
    ])
  })

  it("shows only the properties every selected item has, with each item's value", () => {
    const a = placed()
    const b = Option.getOrThrow(withProperty(placed(), width, 350))
    const other: Item = { ...placed(), actorToSpawn: "other", intProperties: [] }
    const shown = selectionProperties([{ item: a, piece: decal }, { item: b, piece: decal }, {
      item: other,
      piece: undefined
    }])
    assert.deepStrictEqual(shown.map((p) => [p.name, p.values]), [["DecalWidth", [200, 350, 200]], [
      "bFacingOnly",
      [true, true, true]
    ]])
  })

  it("sets a stored value in place, or adds the entry the item lacks", () => {
    const item = { ...placed(), floatProperties: [] }
    const added = Option.getOrThrow(withProperty(item, width, 12.5))
    assert.deepStrictEqual(added.floatProperties, [{
      currentValue: 12.5,
      propertyName: "DecalWidth",
      propertyType: "Float"
    }])
    const kept = {
      ...placed(),
      floatProperties: [{ currentValue: 1, propertyName: "DecalWidth", propertyType: "Float", x: 1 }]
    }
    assert.deepStrictEqual(Option.getOrThrow(withProperty(kept, width, 2)).floatProperties, [
      { currentValue: 2, propertyName: "DecalWidth", propertyType: "Float", x: 1 }
    ])
  })

  it("rejects values the game wouldn't load, all or nothing", () => {
    assert.isTrue(validPropertyValue("intProperties", 3))
    assert.isFalse(validPropertyValue("intProperties", 1.5))
    assert.isFalse(validPropertyValue("intProperties", 2 ** 31))
    assert.isFalse(validPropertyValue("floatProperties", Number.POSITIVE_INFINITY))
    assert.isFalse(validPropertyValue("boolProperties", 1))
    assert.isTrue(validPropertyValue("stringProperties", ""))
    const map = mapOf([placed(), placed()])
    const set = (indices: ReadonlyArray<number>, value: unknown) =>
      setProperties(map, indices, [{ property: width, value }])
    assert.isTrue(Option.isNone(set([0, 1], Number.NaN)))
    assert.isTrue(Option.isNone(set([0, 5], 1)))
    const next = Option.getOrThrow(set([0, 1], 1))
    assert.deepStrictEqual(next.items.map((i) => i.floatProperties[0]?.currentValue), [1, 1])
    assert.strictEqual(map.items[0]!.floatProperties[0]!.currentValue, 200)
  })

  it("labels the decal style dropdown the way the game does", () => {
    const shown = selectionProperties([{ item: placed(), piece: decal }])
    assert.deepStrictEqual(shown.find((p) => p.name === "DecalStyle")?.options, ["Arrow", "Scratch Marks", "Stripes"])
    assert.isUndefined(shown.find((p) => p.name === "DecalWidth")?.options)
  })

  it("names option values past the end by what the game draws", () => {
    const styles = ["Arrow", "Scratch Marks", "Stripes"]
    assert.strictEqual(optionLabel(styles, 1), "Scratch Marks")
    assert.strictEqual(optionLabel(styles, 10), "10 (draws as Stripes)")
    assert.strictEqual(optionLabel(styles, -1), "-1 (unknown)")
  })

  it("labels property names readably", () => {
    assert.strictEqual(propertyLabel("bFacingOnly"), "Facing Only")
    assert.strictEqual(propertyLabel("QualifiedAirflowTargetSpeed"), "Qualified Airflow Target Speed")
    assert.strictEqual(propertyLabel("Field Magnitude"), "Field Magnitude")
    assert.strictEqual(propertyLabel("bool"), "bool")
  })

  it("groups a colour's three channels into one row where its red channel was", () => {
    const property = (name: string, list: ItemProperty["list"] = "floatProperties"): ItemProperty => ({
      list,
      name,
      type: "Float",
      values: [1],
      default: 1,
      hidden: false,
      options: undefined
    })
    const rowNames = (names: ReadonlyArray<ItemProperty>) =>
      propertyRows(names).map((row) =>
        row._tag === "Color"
          ? `${row.color.label}: ${row.color.channels.map((c) => c.name).join("/")}`
          : row.property.name
      )
    assert.deepStrictEqual(
      rowNames([
        property("bDecalEnabled", "boolProperties"),
        property("DecalWidth"),
        property("DecalRed"),
        property("DecalGreen"),
        property("DecalBlue"),
        property("DecalTileSpacing")
      ]),
      ["bDecalEnabled", "DecalWidth", "Decal Color: DecalRed/DecalGreen/DecalBlue", "DecalTileSpacing"]
    )
    assert.deepStrictEqual(
      rowNames([
        property("LightBrightness"),
        property("LightColorB"),
        property("LightColorR"),
        property("LightColorG")
      ]),
      ["LightBrightness", "Light Color: LightColorR/LightColorG/LightColorB"]
    )
    // not a colour: a channel missing, a single-letter suffix without "Color", or not floats
    assert.deepStrictEqual(rowNames([property("LightRed"), property("LightGreen")]), ["LightRed", "LightGreen"])
    assert.deepStrictEqual(rowNames([property("LightR"), property("LightG"), property("LightB")]), [
      "LightR",
      "LightG",
      "LightB"
    ])
    assert.deepStrictEqual(
      rowNames(["Red", "Green", "Blue"].map((c) => property(`Tint${c}`, "intProperties"))),
      ["TintRed", "TintGreen", "TintBlue"]
    )
  })
})

describe("0.4.1 native properties", () => {
  const elevator = Schema.decodeSync(CatalogPiece)({
    classPath: "/Script/Engine.BlueprintGeneratedClass'/Game/X/BP_Elevator.BP_Elevator_C'",
    className: "BP_Elevator",
    meshAssetPath: null,
    materialSlots: [],
    bounds: null,
    properties: [
      { name: "bMirror", list: "boolProperties", type: "Bool", default: false, source: "native" },
      { name: "PhysicsElevatorSpeedTier", list: "intProperties", type: "Integer", default: 1 },
      { name: "SurfaceAssignment", list: "intProperties", type: "Integer", default: 0, source: "native" }
    ]
  })
  // a class no 0.4.1 save has shown: its native properties are optional
  const track = Schema.decodeSync(CatalogPiece)({
    ...elevator,
    classPath: "/Script/Engine.BlueprintGeneratedClass'/Game/X/BP_Track_Curve1.BP_Track_Curve1_C'",
    className: "BP_Track_Curve1",
    properties: [
      { name: "bMirror", list: "boolProperties", type: "Bool", default: false, optional: true },
      { name: "SurfaceAssignment", list: "intProperties", type: "Integer", default: 0, optional: true }
    ]
  })

  it("writes them on new items where a save showed them, and leaves optional ones out", () => {
    assert.deepStrictEqual(defaultProperties(elevator).intProperties.map((p) => p.propertyName), [
      "PhysicsElevatorSpeedTier",
      "SurfaceAssignment"
    ])
    const fresh = defaultProperties(track)
    assert.deepStrictEqual([...fresh.boolProperties, ...fresh.intProperties], [])
  })

  it("still lists optional ones, so setting one writes it", () => {
    const item = itemFromPiece(track, identityTransform())
    const surface = selectionProperties([{ item, piece: track }]).find((p) => p.name === "SurfaceAssignment")!
    assert.deepStrictEqual(surface.values, [0])
    assert.deepStrictEqual(surface.options, ["None", "Magnet", "Ice", "Grippy"])
    const set = Option.getOrThrow(withProperty(item, surface, 2))
    assert.deepStrictEqual(set.intProperties, [{
      currentValue: 2,
      propertyName: "SurfaceAssignment",
      propertyType: "Integer"
    }])
    // export warns about it until a game save shows the class with one
    assert.deepStrictEqual(unconfirmedPropertiesIn([item, set], [track, elevator]), ["BP_Track_Curve1 (Surface)"])
  })

  it("names the elevator's speeds from 1, and the game's labels", () => {
    const item = itemFromPiece(elevator, identityTransform())
    const speed = selectionProperties([{ item, piece: elevator }]).find((p) => p.name === "PhysicsElevatorSpeedTier")!
    assert.deepStrictEqual(speed.options, [null, "Slow", "Normal", "Fast"])
    assert.strictEqual(optionLabel(speed.options!, 1), "Slow")
    assert.strictEqual(optionLabel(speed.options!, 0), "0 (unknown)")
    assert.strictEqual(optionLabel(speed.options!, 4), "4 (draws as Fast)")
    assert.deepStrictEqual(
      ["bMirror", "bMirrorX", "SurfaceAssignment", "PhysicsElevatorExtensionLength"].map(propertyLabel),
      ["Flip Y", "Flip X", "Surface", "Travel Height"]
    )
  })
})

describe("flips", () => {
  const pieceWith = (className: string, flags: ReadonlyArray<string>) =>
    Schema.decodeSync(CatalogPiece)({
      classPath: `/Script/Engine.BlueprintGeneratedClass'/Game/X/${className}.${className}_C'`,
      className,
      meshAssetPath: null,
      materialSlots: [],
      bounds: null,
      properties: flags.map((name) => ({ name, list: "boolProperties", type: "Bool", default: false, optional: true }))
    })
  const bevel = pieceWith("Bevel", ["bMirror", "bMirrorX"])
  const paddle = pieceWith("BP_PhysicsPaddle", ["bMirrorX"])
  const checkpoint = pieceWith("BP_Checkpoint", [])
  const plain = (piece: CatalogPiece) => ({ item: itemFromPiece(piece, identityTransform()), piece })
  const flipped = (piece: CatalogPiece) => ({ ...plain(piece), item: withFlip(plain(piece), "x") })

  it("toggles an item from its own state, writing the flag on a class that left it out", () => {
    const once = flipped(bevel)
    assert.deepStrictEqual(mirrorFlagsOf(once.item), { x: true, y: false })
    assert.deepStrictEqual(mirrorFlagsOf(withFlip(once, "x")), { x: false, y: false })
    assert.deepStrictEqual(mirrorFlagsOf(withFlip(once, "y")), { x: true, y: true })
  })

  it("leaves an item alone on an axis its class doesn't flip on, as the game's button does", () => {
    const start = plain(paddle)
    assert.strictEqual(withFlip(start, "y"), start.item)
    const unknown = { item: start.item, piece: undefined }
    assert.strictEqual(withFlip(unknown, "x"), start.item)
    // a class the catalog doesn't know still flips on a flag the item carries
    assert.isFalse(mirrorFlagsOf(withFlip({ item: flipped(paddle).item, piece: undefined }, "x")).x)
  })

  it("reads an axis across a selection, counting only the items that flip on it", () => {
    assert.strictEqual(selectionFlip([plain(bevel)], "x"), "off")
    assert.strictEqual(selectionFlip([flipped(bevel), flipped(paddle)], "x"), "on")
    assert.strictEqual(selectionFlip([flipped(bevel), plain(paddle)], "x"), "mixed")
    assert.strictEqual(selectionFlip([flipped(bevel), plain(checkpoint)], "x"), "on")
    assert.strictEqual(selectionFlip([plain(paddle)], "y"), "unavailable")
    assert.strictEqual(selectionFlip([plain(checkpoint)], "x"), "unavailable")
  })

  it("keeps the flags out of the listed properties: the flip buttons edit them", () => {
    assert.deepStrictEqual(selectionProperties([plain(bevel)]), [])
  })
})
