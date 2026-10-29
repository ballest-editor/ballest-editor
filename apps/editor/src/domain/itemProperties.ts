/**
 * Item properties: the typed `*Properties` lists on an item (air vent strength, decal size,
 * ...). The catalog says which properties a class exposes, in the game's order and with
 * the class defaults; an item may also carry properties the catalog doesn't know, which
 * are shown and edited as they are.
 */
import { Option, Predicate } from "effect"
import type { CatalogPiece } from "./Catalog"
import type { Item, PropertyList } from "./MapFile"

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
  /** Labels by value for an integer the game edits as a dropdown; undefined for a plain number. */
  readonly options: ReadonlyArray<string> | undefined
}

/**
 * Dropdown labels for integer properties, by class and property name. None of them are in the
 * game data, so they come from in-game probe maps (build 0.4.0-playtest): the decal style
 * names are the game's own dropdown labels; the shape decal's shape and fill are sliders in
 * game, named here after what each value draws. Larger values draw the last option.
 */
const PROPERTY_OPTIONS: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>> = {
  BP_UGCCircuitDecal: { DecalStyle: ["Arrow", "Scratch Marks", "Stripes"] },
  BP_UGCShapeDecal: {
    DecalShapeType: ["Square", "Circle", "Hexagon", "Parallelogram", "Triangle"],
    DecalFillType: ["Filled", "Outline"]
  }
}

/** The label for an option value: the game draws values past the end as the last option. */
export const optionLabel = (options: ReadonlyArray<string>, value: number): string => {
  const label = options[value]
  if (label !== undefined) return label
  const last = options.at(-1)
  return value > 0 && last !== undefined ? `${value} (draws as ${last})` : `${value} (unknown)`
}

const optionsOf = (piece: CatalogPiece | undefined, list: PropertyList, name: string) =>
  list === "intProperties" && piece !== undefined ? PROPERTY_OPTIONS[piece.className]?.[name] : undefined

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
        options: optionsOf(piece, p.list, p.name)
      }]
      : []
  )

/** The property lists a freshly placed piece carries: every exposed property at its default, as the game saves them. */
export const defaultProperties = (piece: CatalogPiece): Pick<Item, PropertyList> => {
  const known = knownProperties(piece)
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

/** The properties every selected item has (same list, name and type), with each item's value. */
export const selectionProperties = (
  items: ReadonlyArray<{ readonly item: Item; readonly piece: CatalogPiece | undefined }>
): ReadonlyArray<ItemProperty> => {
  const [first, ...rest] = items.map(({ item, piece }) => propertiesOfItem(item, piece))
  if (first === undefined) return []
  return first.flatMap((property) => {
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

/** A readable label for a property name: `bFacingOnly` -> `Facing Only`, `DecalWidth` -> `Decal Width`. */
export const propertyLabel = (name: string): string =>
  name.replace(/^b(?=[A-Z])/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
