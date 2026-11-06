/**
 * What changed between two versions of a map, in items (docs/DESKTOP.md § Backups). An item is the same item in both by
 * its stable key; what no key pairs, as in a map without a sidecar, is the same item by its class and position.
 */
import { defaultEditorState } from "./factory"
import { classNameOf, type Item, type MapFile } from "./MapFile"
import { fingerprintOf } from "./sidecar"

/** A version of a map, with each item's stable key at its place. */
export interface MapVersion {
  readonly map: MapFile
  readonly ids: ReadonlyArray<string>
}

/**
 * `moved` is any change of transform: a turned or scaled item counts too. `edited` is any other change to an item (its
 * paint, its properties), `settings` any change to the map's own settings, and `pivots` any change to the items' chosen
 * pivots, which every save in the game drops (docs/qa/save-roundtrip.md) and which are kept nowhere else.
 */
export interface MapDiff {
  readonly added: number
  readonly removed: number
  readonly moved: number
  readonly edited: number
  readonly settings: boolean
  readonly pivots: boolean
}

interface KeyedItem {
  readonly key: string
  readonly item: Item
  readonly print: string
}

const keyedItemsOf = ({ ids, map }: MapVersion): ReadonlyArray<KeyedItem> =>
  map.items.map((item, index) => ({ key: ids[index] ?? "", item, print: fingerprintOf(item) }))

/** Pairs the items `identify` gives one name; what is left of each side has no partner. */
const pairBy = (
  before: ReadonlyArray<KeyedItem>,
  after: ReadonlyArray<KeyedItem>,
  identify: (item: KeyedItem) => string
) => {
  const free = new Map<string, Array<KeyedItem>>()
  for (const item of before) {
    const name = identify(item)
    const same = free.get(name)
    if (same === undefined) free.set(name, [item])
    else same.push(item)
  }
  const pairs: Array<readonly [KeyedItem, KeyedItem]> = []
  const unpaired: Array<KeyedItem> = []
  for (const item of after) {
    const partner = free.get(identify(item))?.pop()
    if (partner === undefined) unpaired.push(item)
    else pairs.push([partner, item])
  }
  return { pairs, before: [...free.values()].flat(), after: unpaired }
}

const classOf = ({ item }: KeyedItem) => classNameOf(item.actorToSpawn)

/** The class and rounded position a fingerprint opens with. */
const placeOf = ({ print }: KeyedItem) => print.split("|").slice(0, 2).join("|")

const movedIn = (pairs: ReadonlyArray<readonly [KeyedItem, KeyedItem]>) =>
  pairs.filter(([before, after]) => before.print !== after.print).length

/** What an item holds besides its transform, which `print` says. */
const contentOf = ({ item }: KeyedItem) => JSON.stringify({ ...item, itemTransform: null })

const editedIn = (pairs: ReadonlyArray<readonly [KeyedItem, KeyedItem]>) =>
  pairs.filter(([before, after]) => before.print === after.print && contentOf(before) !== contentOf(after)).length

/**
 * What the game rewrites in every save whether or not the player touched it (docs/qa/save-roundtrip.md), so a difference
 * here says nothing: the time it was opened, the sun's yaw, the tags it works out from the pieces, and two fields the
 * file doesn't need.
 */
const REWRITTEN_ON_SAVE: ReadonlySet<string> = new Set([
  "createdAt",
  "directionalLightAngle",
  "mapTags",
  "medalTimesByIndex",
  "metaData"
])

/** A map's settings with what `REWRITTEN_ON_SAVE` names left out, and a float's last digits, which saving moves. */
const settingsOf = (map: MapFile) =>
  JSON.stringify(
    map.worldSettings,
    (key, value: unknown) =>
      REWRITTEN_ON_SAVE.has(key) ? undefined : typeof value === "number" ? Number(value.toFixed(3)) : value
  )

const pivotsOf = (map: MapFile) => JSON.stringify(map.editorState?.pivots ?? [])

/**
 * The items `after` gained, lost and moved since `before`. A key whose item changed class is a new item. Without a key,
 * an item that left its place can't be told from one removed and another added, so it counts as those. Unchanged items
 * pair before anything pairs by place, so two stacked items that differ only in rotation aren't swapped.
 */
export const diffMaps = (before: MapVersion, after: MapVersion): MapDiff => {
  const byKey = pairBy(keyedItemsOf(before), keyedItemsOf(after), (item) => `${item.key}|${classOf(item)}`)
  const same = pairBy(byKey.before, byKey.after, ({ print }) => print)
  const byPlace = pairBy(same.before, same.after, placeOf)
  const paired = [...byKey.pairs, ...same.pairs, ...byPlace.pairs]
  return {
    added: byPlace.after.length,
    removed: byPlace.before.length,
    moved: movedIn(byKey.pairs) + movedIn(byPlace.pairs),
    edited: editedIn(paired),
    settings: settingsOf(before.map) !== settingsOf(after.map),
    pivots: pivotsOf(before.map) !== pivotsOf(after.map)
  }
}

/** Where the item at `index` of `from` is in `to`: by its key, or for a map without a sidecar by its fingerprint. */
const sameItemIn = (to: MapVersion, from: MapVersion, index: number) => {
  const byKey = to.ids.indexOf(from.ids[index] ?? "")
  const item = from.map.items[index]
  if (byKey !== -1 || item === undefined) return byKey
  const print = fingerprintOf(item)
  return to.map.items.findIndex((other) => fingerprintOf(other) === print)
}

/**
 * `to` with `from`'s pivots, on the items of the same stable key: what a version from the game needs, as every save there
 * drops them. A pivot whose item isn't in `to` stays behind, and a version with pivots of its own keeps those.
 */
export const withPivotsOf = (from: MapVersion, to: MapVersion): MapVersion => {
  const pivots = from.map.editorState?.pivots ?? []
  if (pivots.length === 0 || (to.map.editorState?.pivots.length ?? 0) > 0) return to
  const carried = pivots.flatMap((pivot) => {
    const itemIndex = sameItemIn(to, from, pivot.itemIndex)
    return itemIndex === -1 ? [] : [{ ...pivot, itemIndex }]
  })
  if (carried.length === 0) return to
  return {
    ...to,
    map: { ...to.map, editorState: { ...(to.map.editorState ?? defaultEditorState()), pivots: carried } }
  }
}

/** Whether a diff found nothing. */
export const isNoDiff = ({ added, edited, moved, pivots, removed, settings }: MapDiff): boolean =>
  added + removed + moved + edited === 0 && !settings && !pivots

/** "12 items", "1 item". */
export const itemCountOf = (count: number): string => `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`

/** "+2 items · −1 item · 3 moved · 1 edited · Settings changed · Pivots changed", leaving out what didn't happen. */
export const mapDiffLabelOf = ({ added, edited, moved, pivots, removed, settings }: MapDiff): string =>
  [
    ...(added > 0 ? [`+${itemCountOf(added)}`] : []),
    ...(removed > 0 ? [`−${itemCountOf(removed)}`] : []),
    ...(moved > 0 ? [`${moved.toLocaleString()} moved`] : []),
    ...(edited > 0 ? [`${edited.toLocaleString()} edited`] : []),
    ...(settings ? ["Settings changed"] : []),
    ...(pivots ? ["Pivots changed"] : [])
  ].join(" · ") || "No items or settings changed"
