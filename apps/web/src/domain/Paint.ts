/**
 * The in-game editor's material picker ("Paint"), from the `paint` key of
 * `assets/materials.json` (tools/extract): finishes (smooth, rough, glossy, ...) in the game's
 * order, each listing its colours and the class-qualified material a map file stores for
 * that choice. A slot's material is one of these, or anything else a map or catalog default
 * carries (which the picker can't show as a choice). Every paintable piece offers the same
 * picker on every slot; docs/qa/materials.md has what was measured.
 */
import { Option, Schema } from "effect"
import type { CatalogIndex } from "./Catalog"
import { type Item, objectPathOf } from "./MapFile"
import { assetNameOf, type MaterialSpec, NEUTRAL } from "./Materials"
import { open } from "./schema"
import { surfaceOf } from "./surface"

const Rgb = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

export const PaintColor = open({
  color: Schema.String,
  material: Schema.String,
  /** Linear RGB swatch colour, where the game sets one explicitly. */
  displayColor: Schema.optionalKey(Rgb)
})
export type PaintColor = typeof PaintColor.Type

export const PaintFinish = open({ name: Schema.String, colors: Schema.Array(PaintColor) })
export type PaintFinish = typeof PaintFinish.Type

export type PaintPicker = ReadonlyArray<PaintFinish>

const decodeFinish = Schema.decodeUnknownOption(PaintFinish)

/** The picker from a materials.json; finishes that don't decode are dropped, a missing key gives none. */
export const parsePaint = (json: unknown): PaintPicker => {
  const list = typeof json === "object" && json !== null && "paint" in json ? json.paint : undefined
  return Array.isArray(list) ? list.flatMap((value) => Option.toArray(decodeFinish(value))) : []
}

/** A selected item, with whatever the caller needs to keep beside it. */
interface HasItem {
  readonly item: Item
}

export interface PaintTargets<T extends HasItem> {
  /** A selected item has a surface: the game lists no slots at all, for any of the selection. */
  readonly surfaceLocked: boolean
  /** The items with slots to paint. A piece the catalog doesn't know keeps its paint editable. */
  readonly items: ReadonlyArray<T>
}

/**
 * An item's off-panel slots: the ones its piece's panel doesn't offer, which a map file can still paint and the game
 * then draws (docs/qa/materials.md). Undefined when the panel offers the piece's slots itself.
 */
export const offPanelSlotsOf = (item: Item, index: CatalogIndex | null): ReadonlySet<number> | undefined => {
  const piece = index?.pieceByClass.get(item.actorToSpawn)
  return piece?.paintable === false ? new Set(piece.offPanelPaint) : undefined
}

/**
 * What can be painted in a selection: nothing while a selected item has a surface, as the game's panel lists nothing
 * then (`AreSelectionMaterialSlotsEditable`) and draws the surface over the paint anyway. Otherwise the items whose
 * piece allows paint, or has off-panel slots.
 */
export const paintTargets = <T extends HasItem>(
  selected: ReadonlyArray<T>,
  index: CatalogIndex | null
): PaintTargets<T> =>
  selected.some(({ item }) => surfaceOf(item) !== 0)
    ? { surfaceLocked: true, items: [] }
    : {
      surfaceLocked: false,
      items: selected.filter(({ item }) => {
        const offPanel = offPanelSlotsOf(item, index)
        return offPanel === undefined || offPanel.size > 0
      })
    }

/** Items the panel edits together: the same class, whatever their meshes (a mirrored one saves a baked mesh). */
export const paintGroups = <T extends HasItem>(items: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> => {
  const groups = new Map<string, Array<T>>()
  for (const entry of items) {
    const group = groups.get(entry.item.actorToSpawn)
    if (group === undefined) groups.set(entry.item.actorToSpawn, [entry])
    else group.push(entry)
  }
  return [...groups.values()]
}

export interface PaintChoice {
  readonly finish: PaintFinish
  readonly color: PaintColor
}

/**
 * The picker choice a stored material corresponds to: the same object path, else the same
 * asset name (a moved or redirected asset). Undefined for materials the picker doesn't offer.
 */
export const choiceOf = (picker: PaintPicker, material: string | undefined): PaintChoice | undefined => {
  if (material === undefined) return undefined
  const all = picker.flatMap((finish) => finish.colors.map((color) => ({ finish, color })))
  const path = objectPathOf(material)
  const name = assetNameOf(material)
  return all.find(({ color }) => objectPathOf(color.material) === path) ??
    all.find(({ color }) => assetNameOf(color.material) === name)
}

/** The panel's colour for a slot that isn't on a picker choice: EBallestMaterialColors' first value. */
const UNSET_COLOR = "Grey"

/**
 * The colour a change of finish paints: the slot's colour, when the new finish has it. An unpainted slot counts as
 * Grey, so `special` paints it, and every other finish paints nothing until a colour is picked.
 */
export const colorForFinish = (finish: PaintFinish, choice: PaintChoice | undefined): PaintColor | undefined =>
  finish.colors.find((c) => c.color === (choice?.color.color ?? UNSET_COLOR))

type Linear = readonly [number, number, number]

const brightness = (c: Linear) => Math.max(...c)

/**
 * The colour a swatch shows for a material, linear RGB: the game's own display colour when
 * it has one, else what the renderer draws, i.e. the emissive colour when it outshines the
 * base colour (scaled into range), else the base colour.
 */
export const swatchColor = (spec: MaterialSpec | undefined, displayColor?: Linear): Linear => {
  if (displayColor !== undefined) return displayColor
  const base = spec?.baseColor ?? NEUTRAL.baseColor
  const emissive = spec?.emissive ?? NEUTRAL.emissive
  const glow = brightness(emissive)
  if (glow <= brightness(base)) return base
  return glow > 1 ? [emissive[0] / glow, emissive[1] / glow, emissive[2] / glow] : emissive
}

const toSrgb = (c: number) => {
  const x = Math.min(1, Math.max(0, c))
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055
}

/** Linear RGB -> CSS `#rrggbb` (sRGB). */
export const cssColor = (c: Linear): string =>
  `#${c.map((x) => Math.round(toSrgb(x) * 255).toString(16).padStart(2, "0")).join("")}`
