/**
 * What changed between two versions of a map, in items (docs/DESKTOP.md § Backups). An item is the same item in both by
 * its stable key; what no key pairs, as in a map without a sidecar, is the same item by its class and position.
 */
import { classNameOf, type Item, type MapFile } from "./MapFile"
import { fingerprintOf } from "./sidecar"

/** A version of a map, with each item's stable key at its place. */
export interface MapVersion {
  readonly map: MapFile
  readonly ids: ReadonlyArray<string>
}

/** `moved` is any change of transform: a turned or scaled item counts too. */
export interface MapDiff {
  readonly added: number
  readonly removed: number
  readonly moved: number
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

/**
 * The items `after` gained, lost and moved since `before`. A key whose item changed class is a new item. Without a key,
 * an item that left its place can't be told from one removed and another added, so it counts as those. Unchanged items
 * pair before anything pairs by place, so two stacked items that differ only in rotation aren't swapped.
 */
export const diffMaps = (before: MapVersion, after: MapVersion): MapDiff => {
  const byKey = pairBy(keyedItemsOf(before), keyedItemsOf(after), (item) => `${item.key}|${classOf(item)}`)
  const same = pairBy(byKey.before, byKey.after, ({ print }) => print)
  const byPlace = pairBy(same.before, same.after, placeOf)
  return {
    added: byPlace.after.length,
    removed: byPlace.before.length,
    moved: movedIn(byKey.pairs) + movedIn(byPlace.pairs)
  }
}

/** "12 items", "1 item". */
export const itemCountOf = (count: number): string => `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`

/** "+2 items · −1 item · 3 moved", leaving out what didn't happen. */
export const mapDiffLabelOf = ({ added, moved, removed }: MapDiff): string =>
  [
    ...(added > 0 ? [`+${itemCountOf(added)}`] : []),
    ...(removed > 0 ? [`−${itemCountOf(removed)}`] : []),
    ...(moved > 0 ? [`${moved.toLocaleString()} moved`] : [])
  ].join(" · ") || "No items added, removed or moved"
