/**
 * Item properties: the typed `*Properties` lists on an item (air vent strength, decal size,
 * ...). The catalog says which properties a class saves, with their defaults, and which of
 * them the game's panel offers and how; an item may also carry properties the catalog doesn't
 * know, which are shown and edited as they are.
 */
import { Option, Predicate } from "effect"
import type { CatalogPiece, CatalogProperty } from "./Catalog"
import type { Item, PropertyList } from "./MapFile"
import { type FlipAxis, isMirrorFlag, MIRROR_X, MIRROR_Y, mirrorFlagsOf, PHYSICS_FLIP } from "./mirror"

/** A dropdown's choices in the game's order, by saved value. */
export type Options = ReadonlyArray<{ readonly value: number; readonly label: string }>

/** How the game's panel edits a number: a slider's range, and where a typed value stops. */
export interface PropertyRange {
  readonly min: number
  readonly max: number
  readonly step: number
  /** The highest value that can be typed: the slider's maximum unless the game allows more. */
  readonly typedMax: number
}

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
  /** Labels by value for what the game edits as a dropdown; undefined for a plain value. */
  readonly options: Options | undefined
  /** The game's label for it, when the catalog has one. */
  readonly label?: string | undefined
  /** The slider the game gives it; undefined for a value it doesn't edit as a number. */
  readonly range?: PropertyRange | undefined
  /** A native property the game loads the item without (catalog `optional`): new items leave it out. */
  readonly optional?: boolean
}

/** The label for a saved value. A value outside the choices is what the game moves it to on load. */
export const optionLabel = (options: Options, value: number): string => {
  const found = options.find((o) => o.value === value)
  if (found !== undefined) return found.label
  const values = options.map((o) => o.value)
  const nearest = value < Math.min(...values) ? Math.min(...values) : Math.max(...values)
  const label = options.find((o) => o.value === nearest)?.label
  return label === undefined ? String(value) : `${value} (the game loads this as ${label})`
}

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

const rangeOf = (p: CatalogProperty): PropertyRange | undefined =>
  p.control === "slider" && p.min !== undefined && p.max !== undefined
    ? { min: p.min, max: p.max, step: p.step ?? 1, typedMax: p.typedMax ?? p.max }
    : undefined

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
        row: p.row,
        label: p.label,
        range: rangeOf(p),
        options: p.options,
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
 * The properties of an item the inspector offers: the ones the game's panel has, in its order
 * (stored value, else the default), then any the catalog doesn't know, which the game would
 * refuse and so stay editable to put right. A hidden one is saved but never offered.
 */
const propertiesOfItem = (item: Item, piece: CatalogPiece | undefined): ReadonlyArray<ItemProperty> => {
  const known = knownProperties(piece)
  const isKnown = (list: PropertyList, name: string) => known.some((p) => p.list === list && p.name === name)
  const offered = known.filter((p) => !p.hidden).sort((a, b) => (a.row ?? Infinity) - (b.row ?? Infinity))
  return [
    ...offered.map(({ hidden: _hidden, row: _row, ...p }) => {
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
        options: undefined
      }))
    )
  ]
}

/** An item with its catalog piece, when the catalog knows the class. */
export interface PlacedItem {
  readonly item: Item
  readonly piece: CatalogPiece | undefined
}

/**
 * The properties every selected item has (same list, name and type), with each item's value.
 * The mirror flags aren't among them: the inspector edits those with its flip buttons.
 */
export const selectionProperties = (items: ReadonlyArray<PlacedItem>): ReadonlyArray<ItemProperty> => {
  const [first, ...rest] = items.map(({ item, piece }) => propertiesOfItem(item, piece))
  if (first === undefined) return []
  return first.filter((property) => !isMirrorFlag(property.name)).flatMap((property) => {
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

/**
 * The flag an item flips with on an axis: Flip Y is `PhysicsFlip` on a class that has it. None
 * where the game offers no flip (the catalog lists the flag hidden), or an unknown class doesn't
 * carry one.
 */
const flipFlagOf = ({ item, piece }: PlacedItem, axis: FlipAxis): string | undefined =>
  (axis === "x" ? [MIRROR_X] : [PHYSICS_FLIP, MIRROR_Y]).find((name) => {
    const listed = piece?.properties?.find((p) => p.name === name)
    return listed === undefined ? stored(item, "boolProperties", name) !== undefined : listed.hidden !== true
  })

/**
 * An axis's flip across a selection, counting only the items that flip on it. Every piece flips
 * on both except the player start, the goal and the checkpoints, which flip on neither.
 */
export type FlipState = "unavailable" | "off" | "on" | "mixed"

export const selectionFlip = (items: ReadonlyArray<PlacedItem>, axis: FlipAxis): FlipState => {
  const flipped = items.filter((placed) => flipFlagOf(placed, axis) !== undefined).map(({ item }) =>
    mirrorFlagsOf(item)[axis]
  )
  if (flipped.length === 0) return "unavailable"
  return flipped.every(Boolean) ? "on" : flipped.some(Boolean) ? "mixed" : "off"
}

/** The item flipped on an axis, as the game's flip buttons do; itself when it doesn't flip on that axis. */
export const withFlip = (placed: PlacedItem, axis: FlipAxis): Item => {
  const { item } = placed
  const name = flipFlagOf(placed, axis)
  if (name === undefined) return item
  const property = { list: "boolProperties", name, type: "Bool" } as const
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
    const label = red.label ?? labelFromName(prefixEnd === "" ? `${prefix}Color` : prefix)
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

/** A readable label for a name the catalog gives none for: `bFacingOnly` -> `Facing Only`. */
const labelFromName = (name: string): string => name.replace(/^b(?=[A-Z])/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2")

/** The label a property shows: the game's, else one made from its name. */
export const propertyLabel = (property: Pick<ItemProperty, "name" | "label">): string =>
  property.label ?? labelFromName(property.name)

/** A value as the game's panel takes it: a typed number stops at the range's ends. */
export const clampToRange = (property: Pick<ItemProperty, "range">, value: number): number => {
  const { range } = property
  return range === undefined ? value : Math.min(Math.max(value, range.min), range.typedMax)
}

/**
 * The step a dragged slider moves by. The game reports 0.01 for every float, but that's its
 * keyboard step; dragging is continuous, and Density's whole range is 0 to 0.01.
 */
export const sliderStep = ({ min, max, step }: PropertyRange): number =>
  step >= 1 ? step : Math.min(step, (max - min) / 1000)

const INNER_CONE = "LightInnerConeAngle"
const OUTER_CONE = "LightOuterConeAngle"
const EMISSIVE = "DecalEmissiveIntensity"
const USE_EMISSIVE = "bDecalUseEmissive"

const floatOf = (item: Item, name: string): number | undefined => {
  const value = stored(item, "floatProperties", name)?.currentValue
  return typeof value === "number" ? value : undefined
}

/**
 * The changes one edit makes on an item besides its own, as the game's panel makes them: a
 * spot light's inner cone never passes its outer, whichever is edited; a decal's emissive
 * strength turns emissive on.
 */
export const linkedChanges = (item: Item, change: PropertyChange): ReadonlyArray<PropertyChange> => {
  const { property, value } = change
  if (typeof value !== "number") return []
  if (property.name === EMISSIVE && value > 0) {
    return [{ property: { list: "boolProperties", name: USE_EMISSIVE, type: "Bool" }, value: true }]
  }
  const cone = { list: property.list, type: property.type }
  if (property.name === OUTER_CONE && value < (floatOf(item, INNER_CONE) ?? -Infinity)) {
    return [{ property: { ...cone, name: INNER_CONE }, value }]
  }
  return []
}

/** An edit as the game applies it: an inner cone wider than the outer stops at the outer. */
export const appliedValue = (item: Item, change: PropertyChange): unknown => {
  const { property, value } = change
  if (property.name !== INNER_CONE || typeof value !== "number") return value
  return Math.min(value, floatOf(item, OUTER_CONE) ?? Infinity)
}

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
        out.add(`${piece?.className} (${propertyLabel(p)})`)
      }
    }
  }
  return [...out]
}
