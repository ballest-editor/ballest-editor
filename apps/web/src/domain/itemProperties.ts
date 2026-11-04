/**
 * Item properties: the typed `*Properties` lists on an item (air vent strength, decal size,
 * ...). The catalog says which properties a class exposes, in the game's order and with
 * the class defaults; an item may also carry properties the catalog doesn't know, which
 * are shown and edited as they are.
 */
import { Option, Predicate } from "effect"
import type { CatalogPiece } from "./Catalog"
import type { Item, PropertyList } from "./MapFile"
import { type FlipAxis, MIRROR_PROPERTIES, MIRROR_X, MIRROR_Y, mirrorFlagsOf } from "./mirror"
import { SURFACE_PROPERTY } from "./surface"

/** A property as the inspector shows it, across one or more items. */
export interface ItemProperty {
  readonly list: PropertyList
  readonly name: string
  /** The `propertyType` the game writes (`Float`, `Bool`, `Integer`, ...). */
  readonly type: string
  /** One value per item: what the item stores, else the class default. */
  readonly values: ReadonlyArray<unknown>
  /** The class default; undefined when the catalog doesn't list the property. */
  readonly default: unknown
  /** Left out of the game's own property panel (the decal's size follows its scale there). */
  readonly hidden: boolean
  /** Labels by value for an integer the game edits as a dropdown (null: not a choice); undefined for a plain number. */
  readonly options: Options | undefined
  /** A native property the game loads the item without (catalog `optional`): new items leave it out. */
  readonly optional?: boolean
}

/** Dropdown labels by value; null where a value isn't one of the game's choices. */
export type Options = ReadonlyArray<string | null>

/**
 * Dropdown labels for integer properties, by class and property name. None of them are in the
 * game data, so they come from in-game probe maps: the decal style names (0.4.0-playtest) are
 * the game's own dropdown labels; the shape decal's shape and fill are sliders in game, named
 * here after what each value draws; the elevator's speeds (0.4.1) are its dropdown's labels for
 * the values it saved. Larger values draw the last option.
 */
const PROPERTY_OPTIONS: Readonly<Record<string, Readonly<Record<string, Options>>>> = {
  BP_UGCCircuitDecal: { DecalStyle: ["Arrow", "Scratch Marks", "Stripes"] },
  BP_UGCShapeDecal: {
    DecalShapeType: ["Square", "Circle", "Hexagon", "Parallelogram", "Triangle"],
    DecalFillType: ["Filled", "Outline"]
  },
  BP_Elevator: { PhysicsElevatorSpeedTier: [null, "Slow", "Normal", "Fast"] }
}

/** Dropdowns every class shares: the item surface (0.4.1; values from the probe, names from materials.json). */
const SHARED_OPTIONS: Readonly<Record<string, Options>> = {
  [SURFACE_PROPERTY]: ["None", "Magnet", "Ice", "Grippy"]
}

/** The label for an option value: the game draws values past the end as the last option. */
export const optionLabel = (options: Options, value: number): string => {
  const label = options[value]
  if (typeof label === "string") return label
  const last = options.at(-1)
  return label === undefined && value > 0 && typeof last === "string"
    ? `${value} (draws as ${last})`
    : `${value} (unknown)`
}

const optionsOf = (piece: CatalogPiece | undefined, list: PropertyList, name: string) =>
  list !== "intProperties"
    ? undefined
    : (piece === undefined ? undefined : PROPERTY_OPTIONS[piece.className]?.[name]) ?? SHARED_OPTIONS[name]

export const PROPERTY_LISTS: ReadonlyArray<PropertyList> = [
  "boolProperties",
  "floatProperties",
  "intProperties",
  "textProperties",
  "nameProperties",
  "stringProperties"
]

const INT32_MIN = -(2 ** 31)
const INT32_MAX = 2 ** 31 - 1

/** A value of the right shape for its list, as the game would load it. */
export const validPropertyValue = (list: PropertyList, value: unknown): boolean => {
  switch (list) {
    case "boolProperties":
      return typeof value === "boolean"
    case "floatProperties":
      return typeof value === "number" && Number.isFinite(value)
    case "intProperties":
      return typeof value === "number" && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
    default:
      return typeof value === "string"
  }
}

/** The catalog's properties for a piece that the editor can write (known list, valid default). */
const knownProperties = (piece: CatalogPiece | undefined) =>
  (piece?.properties ?? []).flatMap((p) =>
    p.list !== null && p.type !== null && validPropertyValue(p.list, p.default)
      ? [{
        list: p.list,
        name: p.name,
        type: p.type,
        default: p.default,
        hidden: p.hidden === true,
        options: optionsOf(piece, p.list, p.name),
        optional: p.optional === true
      }]
      : []
  )

/**
 * The property lists a freshly placed piece carries: every exposed property at its default, as
 * the game saves them. Optional ones (native properties not yet seen on the class) are left out.
 */
export const defaultProperties = (piece: CatalogPiece): Pick<Item, PropertyList> => {
  const known = knownProperties(piece).filter((p) => !p.optional)
  const entries = <A>(list: PropertyList, is: (value: unknown) => value is A) =>
    known.flatMap((p) =>
      p.list === list && is(p.default)
        ? [{ currentValue: p.default, propertyName: p.name, propertyType: p.type }]
        : []
    )
  return {
    boolProperties: entries("boolProperties", Predicate.isBoolean),
    floatProperties: entries("floatProperties", Predicate.isNumber),
    intProperties: entries("intProperties", Predicate.isNumber),
    textProperties: entries("textProperties", Predicate.isString),
    nameProperties: entries("nameProperties", Predicate.isString),
    stringProperties: entries("stringProperties", Predicate.isString)
  }
}

const stored = (item: Item, list: PropertyList, name: string) => item[list].find((p) => p.propertyName === name)

/**
 * The properties of an item: the class's exposed ones in the game's order (stored value,
 * else the default), then any others the item carries.
 */
const propertiesOfItem = (item: Item, piece: CatalogPiece | undefined): ReadonlyArray<ItemProperty> => {
  const known = knownProperties(piece)
  const isKnown = (list: PropertyList, name: string) => known.some((p) => p.list === list && p.name === name)
  return [
    ...known.map((p) => {
      const entry = stored(item, p.list, p.name)
      return {
        ...p,
        type: entry?.propertyType ?? p.type,
        values: [entry === undefined ? p.default : entry.currentValue]
      }
    }),
    ...PROPERTY_LISTS.flatMap((list) =>
      item[list].filter((p) => !isKnown(list, p.propertyName)).map((p) => ({
        list,
        name: p.propertyName,
        type: p.propertyType,
        values: [p.currentValue],
        default: undefined,
        hidden: false,
        options: optionsOf(piece, list, p.propertyName)
      }))
    )
  ]
}

/** An item with its catalog piece, when the catalog knows the class. */
export interface PlacedItem {
  readonly item: Item
  readonly piece: CatalogPiece | undefined
}

const isMirrorFlag = (property: ItemProperty) => property.name === MIRROR_X || property.name === MIRROR_Y

/**
 * The properties every selected item has (same list, name and type), with each item's value.
 * The mirror flags aren't among them: the inspector edits those with its flip buttons.
 */
export const selectionProperties = (items: ReadonlyArray<PlacedItem>): ReadonlyArray<ItemProperty> => {
  const [first, ...rest] = items.map(({ item, piece }) => propertiesOfItem(item, piece))
  if (first === undefined) return []
  return first.filter((property) => !isMirrorFlag(property)).flatMap((property) => {
    const values = [...property.values]
    for (const other of rest) {
      const match = other.find((p) => p.list === property.list && p.name === property.name && p.type === property.type)
      if (match === undefined) return []
      values.push(...match.values)
    }
    return [{ ...property, values }]
  })
}

/**
 * Sets one property on an item: the stored entry's value (keeping anything else on it), or
 * a new entry when the item didn't carry it. None when the value doesn't fit the list.
 */
export const withProperty = (
  item: Item,
  property: Pick<ItemProperty, "list" | "name" | "type">,
  value: unknown
): Option.Option<Item> => {
  if (!validPropertyValue(property.list, value)) return Option.none()
  const entries = item[property.list]
  const index = entries.findIndex((p) => p.propertyName === property.name)
  const next = index < 0
    ? [...entries, { currentValue: value, propertyName: property.name, propertyType: property.type }]
    : entries.map((p, i) => (i === index ? { ...p, currentValue: value } : p))
  return Option.some({ ...item, [property.list]: next })
}

/** Whether an item flips on an axis: its class has the flag (not all do), or the item carries it. */
const flipsOn = ({ item, piece }: PlacedItem, axis: FlipAxis): boolean => {
  const name = MIRROR_PROPERTIES[axis]
  return stored(item, "boolProperties", name) !== undefined || (piece?.properties ?? []).some((p) => p.name === name)
}

/**
 * An axis's flip across a selection, counting only the items that flip on it. Every piece has
 * x and y except the physics props (x only), and the player start and checkpoints (neither).
 */
export type FlipState = "unavailable" | "off" | "on" | "mixed"

export const selectionFlip = (items: ReadonlyArray<PlacedItem>, axis: FlipAxis): FlipState => {
  const flipped = items.filter((placed) => flipsOn(placed, axis)).map(({ item }) => mirrorFlagsOf(item)[axis])
  if (flipped.length === 0) return "unavailable"
  return flipped.every(Boolean) ? "on" : flipped.some(Boolean) ? "mixed" : "off"
}

/** The item flipped on an axis, as the game's flip buttons do; itself when it doesn't flip on that axis. */
export const withFlip = (placed: PlacedItem, axis: FlipAxis): Item => {
  const { item } = placed
  if (!flipsOn(placed, axis)) return item
  const property = { list: "boolProperties", name: MIRROR_PROPERTIES[axis], type: "Bool" } as const
  return Option.getOrElse(withProperty(item, property, !mirrorFlagsOf(item)[axis]), () => item)
}

/** A value to set on one property; several are set together as one edit. */
export interface PropertyChange {
  readonly property: Pick<ItemProperty, "list" | "name" | "type">
  readonly value: unknown
}

/**
 * A colour the game edits with one swatch: three float properties, one per linear channel
 * (`DecalRed/Green/Blue`, `LightRed/Green/Blue`, `LightColorR/G/B`).
 */
export interface ColorProperty {
  readonly label: string
  readonly channels: readonly [red: ItemProperty, green: ItemProperty, blue: ItemProperty]
}

/** An inspector row: one property, or a colour made of three. */
export type PropertyRow =
  | { readonly _tag: "Property"; readonly property: ItemProperty }
  | { readonly _tag: "Color"; readonly color: ColorProperty }

/** Channel name suffixes, and what the name before them must end with (so `LightR` alone isn't one). */
const CHANNEL_SUFFIXES: ReadonlyArray<
  { readonly names: readonly [string, string, string]; readonly prefixEnd: string }
> = [
  { names: ["Red", "Green", "Blue"], prefixEnd: "" },
  { names: ["R", "G", "B"], prefixEnd: "Color" }
]

/** The colour a red channel starts, when its green and blue are in the same list. */
const colorAt = (properties: ReadonlyArray<ItemProperty>, red: ItemProperty): ColorProperty | undefined => {
  if (red.list !== "floatProperties") return undefined
  for (const { names: [r, g, b], prefixEnd } of CHANNEL_SUFFIXES) {
    const prefix = red.name.slice(0, -r.length)
    if (!red.name.endsWith(r) || prefix === "" || !prefix.endsWith(prefixEnd)) continue
    const channel = (suffix: string) => properties.find((p) => p.list === red.list && p.name === prefix + suffix)
    const green = channel(g)
    const blue = channel(b)
    if (green === undefined || blue === undefined) continue
    const label = propertyLabel(prefixEnd === "" ? `${prefix}Color` : prefix)
    return { label, channels: [red, green, blue] }
  }
  return undefined
}

/** The properties as inspector rows: each colour's channels become one row where its red channel was. */
export const propertyRows = (properties: ReadonlyArray<ItemProperty>): ReadonlyArray<PropertyRow> => {
  const colors = properties.flatMap((p) => colorAt(properties, p) ?? [])
  const inColor = new Set(colors.flatMap((c) => c.channels))
  return properties.flatMap((property): ReadonlyArray<PropertyRow> => {
    const color = colors.find((c) => c.channels[0] === property)
    if (color !== undefined) return [{ _tag: "Color", color }]
    return inColor.has(property) ? [] : [{ _tag: "Property", property }]
  })
}

/** The game's own labels where a name doesn't read as one (its property panel, 0.4.1). */
const PROPERTY_LABELS: Readonly<Record<string, string>> = {
  [SURFACE_PROPERTY]: "Surface",
  [MIRROR_X]: "Flip X",
  [MIRROR_Y]: "Flip Y",
  PhysicsElevatorExtensionLength: "Travel Height",
  PhysicsElevatorSpeedTier: "Speed",
  PhysicsCylinderSpinSpeed: "Spin Speed",
  PhysicsPaddleSpeedMultiplier: "Paddle Speed",
  PhysicsVariantCount: "Paddles / Doors"
}

/** A readable label for a property name: `bFacingOnly` -> `Facing Only`, `DecalWidth` -> `Decal Width`. */
export const propertyLabel = (name: string): string =>
  PROPERTY_LABELS[name] ?? name.replace(/^b(?=[A-Z])/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2")

/**
 * Pieces in a map carrying a native property no game save of their class has shown yet
 * (catalog `optional`), as `Class (Property)`: the game rejects an item with a property its
 * class doesn't have, and then discards the whole map.
 */
export const unconfirmedPropertiesIn = (
  items: ReadonlyArray<Item>,
  pieces: ReadonlyArray<CatalogPiece>
): ReadonlyArray<string> => {
  const byClass = new Map(pieces.map((p) => [p.classPath, p]))
  const out = new Set<string>()
  for (const item of items) {
    const piece = byClass.get(item.actorToSpawn)
    const optional = (piece?.properties ?? []).filter((p) => p.optional === true)
    for (const p of optional) {
      if (p.list !== null && item[p.list].some((entry) => entry.propertyName === p.name)) {
        out.add(`${piece?.className} (${propertyLabel(p.name)})`)
      }
    }
  }
  return [...out]
}
