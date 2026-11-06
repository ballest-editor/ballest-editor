/**
 * Between a map's sidecar and the document (docs/PROJECTS.md § Source of truth): the sidecar written for a document, and
 * a document's keys and structure out of a sidecar, re-matching its entries when the `.balledit` isn't the one it was
 * written for.
 */
import type { CatalogIndex } from "./Catalog"
import { structureFromGame } from "./gameGroups"
import { classNameOf, type Item, type MapFile } from "./MapFile"
import type { MapSidecar, SidecarItem } from "./MapSidecar"
import { freshKey, freshKeys, type ItemMeta, itemNode, rewriteTree, type Structure } from "./structure"

/** The rounding in a fingerprint: 0.01 cm, and four places for a rotation or scale. */
const TRANSLATION_PLACES = 2
const UNIT_PLACES = 4

/** How far a transform may be from a fingerprint and still be the same item: each axis's difference, at most. */
const TOLERANCE = { translation: 1, rotation: 0.01, scale: 0.01 } as const

const rounded = (value: number, places: number) => {
  const factor = 10 ** places
  // adding 0 turns -0 into 0, which prints the same on both sides of a comparison
  return Math.round(value * factor) / factor + 0
}

/** `q` with the sign the two equal rotations `q` and `-q` agree on. */
const canonicalRotation = ({ w, x, y, z }: Item["itemTransform"]["rotation"]): ReadonlyArray<number> => {
  const sign = ([w, x, y, z].find((part) => Math.abs(part) > 1e-6) ?? 1) < 0 ? -1 : 1
  return [x, y, z, w].map((part) => part * sign)
}

/** An item's class and transform, rounded: `<class>|<x,y,z>|<qx,qy,qz,qw>|<sx,sy,sz>`. */
export const fingerprintOf = (item: Item): string => {
  const { rotation, scale3D, translation } = item.itemTransform
  const parts = (values: ReadonlyArray<number>, places: number) => values.map((v) => rounded(v, places)).join(",")
  return [
    classNameOf(item.actorToSpawn),
    parts([translation.x, translation.y, translation.z], TRANSLATION_PLACES),
    parts(canonicalRotation(rotation), UNIT_PLACES),
    parts([scale3D.x, scale3D.y, scale3D.z], UNIT_PLACES)
  ].join("|")
}

/** The sidecar of a document, written for the `.balledit` of hash `mapHash`. */
export const sidecarOf = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  structure: Structure,
  mapHash: string
): MapSidecar => ({
  formatVersion: 1,
  mapHash,
  items: Object.fromEntries(ids.flatMap((key, index) => {
    const item = map.items[index]
    return item === undefined ? [] : [[key, { index, fingerprint: fingerprintOf(item), ...structure.items.get(key) }]]
  })),
  tree: structure.tree
})

interface Fingerprint {
  readonly className: string
  readonly translation: ReadonlyArray<number>
  readonly rotation: ReadonlyArray<number>
  readonly scale: ReadonlyArray<number>
}

const numbersIn = (text: string | undefined, length: number): ReadonlyArray<number> | undefined => {
  const numbers = text?.split(",").map(Number) ?? []
  return numbers.length === length && numbers.every(Number.isFinite) ? numbers : undefined
}

/** A fingerprint's parts; undefined for text `fingerprintOf` didn't write, which then matches nothing but itself. */
const parseFingerprint = (text: string): Fingerprint | undefined => {
  const [className, t, r, s] = text.split("|")
  const translation = numbersIn(t, 3)
  const rotation = numbersIn(r, 4)
  const scale = numbersIn(s, 3)
  return className === undefined || translation === undefined || rotation === undefined || scale === undefined
    ? undefined
    : { className, translation, rotation, scale }
}

const largestDifference = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, sign = 1) =>
  a.reduce((largest, value, i) => Math.max(largest, Math.abs(value - sign * (b[i] ?? 0))), 0)

/** How far apart two transforms are, in tolerances: at most 1 is the same item. */
const distanceBetween = (a: Fingerprint, b: Fingerprint): number =>
  Math.max(
    Math.hypot(...a.translation.map((value, i) => value - (b.translation[i] ?? 0))) / TOLERANCE.translation,
    Math.min(largestDifference(a.rotation, b.rotation), largestDifference(a.rotation, b.rotation, -1)) /
      TOLERANCE.rotation,
    largestDifference(a.scale, b.scale) / TOLERANCE.scale
  )

/** A place a tolerance wide for fingerprints of one class, `dx`, `dy` and `dz` cells over from `print`'s. */
const cellOf = ({ className, translation }: Fingerprint, dx = 0, dy = 0, dz = 0) => {
  const [x = 0, y = 0, z = 0] = translation.map((value) => Math.floor(value / TOLERANCE.translation))
  return `${className}|${x + dx},${y + dy},${z + dz}`
}

const NEAR = [-1, 0, 1]

const cellsAround = (print: Fingerprint): ReadonlyArray<string> =>
  NEAR.flatMap((dx) => NEAR.flatMap((dy) => NEAR.map((dz) => cellOf(print, dx, dy, dz))))

const addTo = <K, V>(lists: Map<K, Array<V>>, key: K, value: V) => {
  const list = lists.get(key)
  if (list === undefined) lists.set(key, [value])
  else list.push(value)
}

type Entry = readonly [key: string, item: SidecarItem]

/**
 * Gives `keys`' free places to the entries left over, nearest first: each entry takes the item of its class closest to
 * its fingerprint, within the tolerance. An entry only looks at the cells around it.
 */
const matchNearest = (
  entries: ReadonlyArray<Entry>,
  prints: ReadonlyArray<string>,
  keys: Array<string | undefined>
) => {
  const cells = new Map<string, Array<{ readonly index: number; readonly print: Fingerprint }>>()
  prints.forEach((text, index) => {
    const print = keys[index] === undefined ? parseFingerprint(text) : undefined
    if (print !== undefined) addTo(cells, cellOf(print), { index, print })
  })
  const pairs = entries.flatMap(([key, { fingerprint, index: from }]) => {
    const print = parseFingerprint(fingerprint)
    if (print === undefined) return []
    return cellsAround(print).flatMap((cell) =>
      (cells.get(cell) ?? []).flatMap((candidate) => {
        const distance = distanceBetween(print, candidate.print)
        return distance <= 1 ? [{ key, from, index: candidate.index, distance }] : []
      })
    )
  }).sort((a, b) => a.distance - b.distance || a.from - b.from || a.index - b.index)
  const placed = new Set<string>()
  for (const { index, key } of pairs) {
    if (keys[index] === undefined && !placed.has(key)) {
      keys[index] = key
      placed.add(key)
    }
  }
}

/** Each item's key by fingerprint: the same class and transform first, in document order, then the nearest. */
const keysByFingerprint = (map: MapFile, entries: ReadonlyArray<Entry>): ReadonlyArray<string | undefined> => {
  const prints = map.items.map(fingerprintOf)
  const free = new Map<string, Array<number>>()
  // last first, so `pop` hands out items of the same fingerprint in document order
  for (let index = prints.length - 1; index >= 0; index--) addTo(free, prints[index] ?? "", index)
  const keys = Array<string | undefined>(map.items.length).fill(undefined)
  const left = entries.filter(([key, { fingerprint }]) => {
    const index = free.get(fingerprint)?.pop()
    if (index === undefined) return true
    keys[index] = key
    return false
  })
  matchNearest(left, prints, keys)
  return keys
}

/** Each item's key by `index`, as written; undefined when two entries claim one place or an index is past the items. */
const keysByIndex = (map: MapFile, entries: ReadonlyArray<Entry>): ReadonlyArray<string | undefined> | undefined => {
  const keys = Array<string | undefined>(map.items.length).fill(undefined)
  for (const [key, { index }] of entries) {
    if (index >= keys.length || keys[index] !== undefined) return undefined
    keys[index] = key
  }
  return keys
}

/**
 * `sidecar`'s tree over the items that matched: what no item matched goes, every item is in one place, and the items
 * without a place join the root in document order. Repeated group ids get fresh ones.
 */
const treeOver = (sidecar: MapSidecar, ids: ReadonlyArray<string>): Structure["tree"] => {
  const known = new Set(ids)
  const placed = new Set<string>()
  const groups = new Set<string>()
  const tree = rewriteTree(sidecar.tree, (node) => {
    if (node.kind === "group") {
      const id = groups.has(node.id) ? freshKey() : node.id
      groups.add(id)
      return [{ ...node, id }]
    }
    if (!known.has(node.key) || placed.has(node.key)) return []
    placed.add(node.key)
    return [node]
  })
  return [...tree, ...ids.filter((key) => !placed.has(key)).map(itemNode)]
}

/** What a sidecar adds to a `.balledit`, once they are put together. */
export interface LoadedStructure {
  readonly ids: ReadonlyArray<string>
  readonly structure: Structure
  /** Sidecar entries no item matched: dropped, and worth reporting. */
  readonly unmatched: number
  /** The `.balledit` wasn't the one the sidecar was written for, so it no longer says what is on disk. */
  readonly rematched: boolean
}

/** A map's structure from nothing but itself: fresh keys, and its game groups as tree groups. */
export const structureOfMap = (map: MapFile, catalog: CatalogIndex | null = null): LoadedStructure => {
  const ids = freshKeys(map.items.length)
  return { ids, structure: structureFromGame(map, ids, catalog), unmatched: 0, rematched: false }
}

/**
 * Puts a map's `.balledit` (of hash `mapHash`) and its sidecar together. The hash the sidecar was written for means its
 * indices are right. Otherwise the file was rewritten, and each entry finds its item by fingerprint; items left over
 * get fresh keys, and entries left over are dropped and counted. Without a sidecar the map stands on its own.
 */
export const loadStructure = (
  map: MapFile,
  mapHash: string,
  sidecar: MapSidecar | null,
  catalog: CatalogIndex | null = null
): LoadedStructure => {
  if (sidecar === null) return structureOfMap(map, catalog)
  const entries = Object.entries(sidecar.items).sort(([, a], [, b]) => a.index - b.index)
  const byIndex = sidecar.mapHash === mapHash ? keysByIndex(map, entries) : undefined
  const keys = byIndex ?? keysByFingerprint(map, entries)
  const matched = new Set(keys.flatMap((key) => key ?? []))
  const ids = keys.map((key) => key ?? freshKey())
  const items = new Map(entries.flatMap(([key, { name, tags }]) => {
    const meta: ItemMeta = {
      ...(name !== undefined && { name }),
      ...(tags !== undefined && tags.length > 0 && { tags })
    }
    return matched.has(key) && Object.keys(meta).length > 0 ? [[key, meta] as const] : []
  }))
  return {
    ids,
    structure: { tree: treeOver(sidecar, ids), items },
    unmatched: entries.length - matched.size,
    rematched: byIndex === undefined
  }
}

const classOfPrint = (print: string | undefined) => print?.split("|")[0]

/**
 * Whether `map` holds the items `sidecar` was written for, in their order: the same class at every place, and no item
 * that left its place showing up unchanged at another's, which is a delete and an add of that class and not a move.
 */
const sameItemsInOrder = (map: MapFile, sidecar: MapSidecar) => {
  const entries = Object.values(sidecar.items)
  if (entries.length !== map.items.length) return false
  const prints = map.items.map(fingerprintOf)
  const moved = entries.filter(({ fingerprint, index }) => prints[index] !== fingerprint)
  const landed = new Set(moved.map(({ index }) => prints[index]))
  return moved.every(({ fingerprint, index }) =>
    classOfPrint(prints[index]) === classOfPrint(fingerprint) && !landed.has(fingerprint)
  )
}

/**
 * `loadStructure` for a version the game saved. The game keeps items in their order, so the same items in the same order
 * are those items wherever they moved to, and they keep their keys, names and groups. Otherwise it is any rewritten file.
 */
export const loadGameStructure = (map: MapFile, mapHash: string, sidecar: MapSidecar | null): LoadedStructure =>
  sidecar !== null && sameItemsInOrder(map, sidecar)
    ? { ...loadStructure(map, sidecar.mapHash, sidecar), rematched: true }
    : loadStructure(map, mapHash, sidecar)
