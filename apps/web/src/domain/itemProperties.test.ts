import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { CatalogPiece } from "./Catalog"
import { setProperties } from "./edits"
import { identityTransform, itemFromPiece, newMapFile } from "./factory"
import {
  clampToRange,
  defaultProperties,
  type ItemProperty,
  optionLabel,
  propertyLabel,
  propertyRows,
  selectionFlip,
  selectionProperties,
  sliderStep,
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
    {
      name: "DecalStyle",
      list: "intProperties",
      type: "Integer",
      default: 0,
      hidden: false,
      label: "Style",
      control: "dropdown",
      row: 3,
      min: 0,
      max: 2,
      options: [
        { value: 0, label: "Arrow" },
        { value: 1, label: "Scratch marks" },
        { value: 2, label: "Stripes" }
      ]
    },
    {
      name: "bFacingOnly",
      list: "boolProperties",
      type: "Bool",
      default: true,
      hidden: false,
      label: "Facing Only",
      control: "toggle",
      row: 4
    },
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

  it("offers the game's rows in its order, defaults for missing ones, then what the catalog doesn't know", () => {
    const item: Item = {
      ...placed(),
      floatProperties: [{ currentValue: 1, propertyName: "Extra", propertyType: "Float" }],
      boolProperties: [{ currentValue: false, propertyName: "bFacingOnly", propertyType: "Bool" }]
    }
    const shown = selectionProperties([{ item, piece: decal }])
    assert.deepStrictEqual(shown.map((p) => [p.name, p.values, p.default]), [
      ["DecalStyle", [0], 0],
      ["bFacingOnly", [false], true],
      ["Extra", [1], undefined]
    ])
    // without a catalog entry, only what the item stores, list by list
    assert.deepStrictEqual(selectionProperties([{ item, piece: undefined }]).map((p) => p.name), [
      "bFacingOnly",
      "Extra",
      "DecalStyle"
    ])
  })

  it("keeps a hidden property in the file but never offers it", () => {
    const item = placed()
    assert.deepStrictEqual(item.floatProperties.map((p) => p.propertyName), ["DecalWidth"])
    assert.isUndefined(selectionProperties([{ item, piece: decal }]).find((p) => p.name === "DecalWidth"))
  })

  it("shows only the properties every selected item has, with each item's value", () => {
    const a = placed()
    const facing = { list: "boolProperties", name: "bFacingOnly", type: "Bool" } as const
    const b = Option.getOrThrow(withProperty(placed(), facing, false))
    const other: Item = { ...placed(), actorToSpawn: "other", intProperties: [] }
    const shown = selectionProperties([{ item: a, piece: decal }, { item: b, piece: decal }, {
      item: other,
      piece: undefined
    }])
    assert.deepStrictEqual(shown.map((p) => [p.name, p.values]), [["bFacingOnly", [true, false, true]]])
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
    const style = shown.find((p) => p.name === "DecalStyle")
    assert.deepStrictEqual(style?.options?.map((o) => o.label), ["Arrow", "Scratch marks", "Stripes"])
    assert.strictEqual(style === undefined ? "" : propertyLabel(style), "Style")
  })

  it("says what the game makes of a value outside the choices: it loads the nearest", () => {
    const styles = [{ value: 0, label: "Arrow" }, { value: 1, label: "Scratch marks" }, { value: 2, label: "Stripes" }]
    assert.strictEqual(optionLabel(styles, 1), "Scratch marks")
    assert.strictEqual(optionLabel(styles, 7), "7 (the game loads this as Stripes)")
    assert.strictEqual(optionLabel(styles, -1), "-1 (the game loads this as Arrow)")
  })

  it("makes a label from the name when the catalog has none", () => {
    const named = (name: string) => propertyLabel({ name })
    assert.strictEqual(named("bFacingOnly"), "Facing Only")
    assert.strictEqual(named("QualifiedAirflowTargetSpeed"), "Qualified Airflow Target Speed")
    assert.strictEqual(named("Field Magnitude"), "Field Magnitude")
    assert.strictEqual(named("bool"), "bool")
    assert.strictEqual(propertyLabel({ name: "EntryAssistMinSpeed", label: "Entry Boost Speed" }), "Entry Boost Speed")
  })

  it("stops a typed number where the game does, which can be past the slider", () => {
    const magnitude = { range: { min: 1000, max: 2250000, step: 0.01, typedMax: 2250000 } }
    assert.strictEqual(clampToRange(magnitude, 5), 1000)
    assert.strictEqual(clampToRange(magnitude, 4500001), 2250000)
    assert.strictEqual(clampToRange(magnitude, 10000), 10000)
    const travel = { range: { min: 0, max: 2000, step: 0.01, typedMax: 10000 } }
    assert.strictEqual(clampToRange(travel, 9000), 9000)
    assert.strictEqual(clampToRange(travel, 10000000), 10000)
    assert.strictEqual(clampToRange(travel, -5), 0)
    assert.strictEqual(clampToRange({ range: undefined }, 9), 9)
  })

  it("drags a slider finely even where the game's step is the whole range", () => {
    const density = { min: 0, max: 0.01, step: 0.01, typedMax: 0.02 }
    assert.isBelow(sliderStep(density), 0.0001)
    assert.strictEqual(sliderStep({ min: 0, max: 5000, step: 0.01, typedMax: 5000 }), 0.01)
    assert.strictEqual(sliderStep({ min: 1, max: 32, step: 1, typedMax: 32 }), 1)
  })

  it("keeps a spot light's inner cone inside its outer, whichever is edited", () => {
    const float = (name: string, currentValue: number) => ({ currentValue, propertyName: name, propertyType: "Float" })
    const cone = (name: string) => ({ list: "floatProperties", name, type: "Float" }) as const
    const spot: Item = {
      ...placed(),
      floatProperties: [float("LightInnerConeAngle", 20), float("LightOuterConeAngle", 45)]
    }
    const angles = (map: MapFile) => map.items[0]?.floatProperties.map((p) => p.currentValue)
    const set = (name: string, value: number, item = spot) =>
      Option.getOrThrow(setProperties(mapOf([item]), [0], [{ property: cone(name), value }]))
    // measured: inner 161 stops at the outer 45; outer 5 pulls the inner down to 5
    assert.deepStrictEqual(angles(set("LightInnerConeAngle", 161)), [45, 45])
    assert.deepStrictEqual(angles(set("LightOuterConeAngle", 5)), [5, 5])
    assert.deepStrictEqual(angles(set("LightInnerConeAngle", 30)), [30, 45])
    assert.deepStrictEqual(angles(set("LightOuterConeAngle", 60)), [20, 60])
  })

  it("turns a decal's emissive on when its strength is set", () => {
    const shape: Item = {
      ...placed(),
      boolProperties: [{ currentValue: false, propertyName: "bDecalUseEmissive", propertyType: "Bool" }],
      floatProperties: [{ currentValue: 0, propertyName: "DecalEmissiveIntensity", propertyType: "Float" }]
    }
    const emissive = { list: "floatProperties", name: "DecalEmissiveIntensity", type: "Float" } as const
    const next = Option.getOrThrow(setProperties(mapOf([shape]), [0], [{ property: emissive, value: 410 }]))
    assert.deepStrictEqual(next.items[0]?.boolProperties.map((p) => p.currentValue), [true])
  })

  it("groups a colour's three channels into one row where its red channel was", () => {
    const property = (name: string, list: ItemProperty["list"] = "floatProperties"): ItemProperty => ({
      list,
      name,
      type: "Float",
      values: [1],
      default: 1,
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
      {
        name: "SurfaceAssignment",
        list: "intProperties",
        type: "Integer",
        default: 0,
        optional: true,
        label: "Surfaces"
      }
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
    const set = Option.getOrThrow(withProperty(item, surface, 2))
    assert.deepStrictEqual(set.intProperties, [{
      currentValue: 2,
      propertyName: "SurfaceAssignment",
      propertyType: "Integer"
    }])
    // export warns about it until a game save shows the class with one
    assert.deepStrictEqual(unconfirmedPropertiesIn([item, set], [track, elevator]), ["BP_Track_Curve1 (Surfaces)"])
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
  const paddle = pieceWith("BP_PhysicsPaddle", ["PhysicsFlip", "bMirrorX"])
  const checkpoint = pieceWith("BP_Checkpoint", [])
  // the goal saves the flags but its panel has no flip buttons
  const goal = Schema.decodeSync(CatalogPiece)({
    ...bevel,
    className: "BP_Checkpoint",
    properties: ["bMirror", "bMirrorX"].map((name) => ({
      name,
      list: "boolProperties",
      type: "Bool",
      default: false,
      hidden: true
    }))
  })
  const plain = (piece: CatalogPiece) => ({ item: itemFromPiece(piece, identityTransform()), piece })
  const flipped = (piece: CatalogPiece) => ({ ...plain(piece), item: withFlip(plain(piece), "x") })

  it("toggles an item from its own state, writing the flag on a class that left it out", () => {
    const once = flipped(bevel)
    assert.deepStrictEqual(mirrorFlagsOf(once.item), { x: true, y: false })
    assert.deepStrictEqual(mirrorFlagsOf(withFlip(once, "x")), { x: false, y: false })
    assert.deepStrictEqual(mirrorFlagsOf(withFlip(once, "y")), { x: true, y: true })
  })

  it("writes PhysicsFlip for Flip Y on a physics prop, which has no bMirror", () => {
    const flippedY = withFlip(plain(paddle), "y")
    assert.deepStrictEqual(flippedY.boolProperties, [{
      currentValue: true,
      propertyName: "PhysicsFlip",
      propertyType: "Bool"
    }])
    assert.deepStrictEqual(mirrorFlagsOf(flippedY), { x: false, y: true })
    assert.strictEqual(selectionFlip([plain(paddle)], "y"), "off")
    assert.strictEqual(selectionFlip([{ ...plain(paddle), item: flippedY }], "y"), "on")
  })

  it("leaves an item alone where the game offers no flip", () => {
    const start = plain(goal)
    assert.strictEqual(withFlip(start, "x"), start.item)
    assert.strictEqual(withFlip(start, "y"), start.item)
    assert.strictEqual(selectionFlip([start], "y"), "unavailable")
    const bare = plain(paddle)
    const unknown = { item: bare.item, piece: undefined }
    assert.strictEqual(withFlip(unknown, "x"), bare.item)
    // a class the catalog doesn't know still flips on a flag the item carries
    assert.isFalse(mirrorFlagsOf(withFlip({ item: flipped(paddle).item, piece: undefined }, "x")).x)
  })

  it("reads an axis across a selection, counting only the items that flip on it", () => {
    assert.strictEqual(selectionFlip([plain(bevel)], "x"), "off")
    assert.strictEqual(selectionFlip([flipped(bevel), flipped(paddle)], "x"), "on")
    assert.strictEqual(selectionFlip([flipped(bevel), plain(paddle)], "x"), "mixed")
    assert.strictEqual(selectionFlip([flipped(bevel), plain(checkpoint)], "x"), "on")
    assert.strictEqual(selectionFlip([plain(checkpoint)], "x"), "unavailable")
  })

  it("keeps the flags out of the listed properties: the flip buttons edit them", () => {
    assert.deepStrictEqual(selectionProperties([plain(bevel)]), [])
    assert.deepStrictEqual(selectionProperties([plain(paddle)]), [])
  })
})
