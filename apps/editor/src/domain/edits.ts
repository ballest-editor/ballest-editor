/**
 * Edits on a MapFile. Pure functions returning a new MapFile (unchanged items are shared,
 * which keeps undo snapshots cheap). Inputs from the UI are validated with the domain
 * schemas before they reach the document.
 */
import { Option, Schema } from "effect"
import { type PropertyChange, withProperty } from "./itemProperties"
import { Item, type ItemPivot, ItemTransform, type MapFile } from "./MapFile"

const decodeItem = Schema.decodeUnknownOption(Item)
const decodeTransform = Schema.decodeUnknownOption(ItemTransform)

export const addItem = (map: MapFile, item: Item): MapFile => ({ ...map, items: [...map.items, item] })

/**
 * Removes items and keeps `editorState.pivots` consistent: pivots of removed items are
 * dropped and later indices shift down (the game rejects maps with invalid editor
 * metadata). `groups` has no known non-empty sample, so it is left untouched.
 */
export const removeItems = (map: MapFile, indices: ReadonlyArray<number>): MapFile => {
  const removed = new Set(indices)
  if (removed.size === 0) return map
  const sorted = [...removed].sort((a, b) => a - b)
  const shift = (index: number) => {
    let n = 0
    for (const r of sorted) if (r < index) n++
    return index - n
  }
  const items = map.items.filter((_, i) => !removed.has(i))
  if (map.editorState === undefined) return { ...map, items }
  return {
    ...map,
    items,
    editorState: {
      ...map.editorState,
      pivots: map.editorState.pivots
        .filter((p) => !removed.has(p.itemIndex))
        .map((p) => {
          const itemIndex = shift(p.itemIndex)
          return itemIndex === p.itemIndex ? p : { ...p, itemIndex }
        })
    }
  }
}

/**
 * A transform from the UI, as the game will accept it: the schema decodes it, and the
 * quaternion is renormalized (the game rejects non-normalized rotations). A zero-length
 * quaternion or any non-finite value is rejected.
 */
const validTransform = (transform: unknown): Option.Option<ItemTransform> =>
  Option.flatMap(decodeTransform(transform), (t: ItemTransform) => {
    const q = t.rotation
    const length = Math.hypot(q.x, q.y, q.z, q.w)
    if (!(length > 1e-9)) return Option.none()
    return Option.some({ ...t, rotation: { ...q, x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length } })
  })

/**
 * Replaces the transforms (rotation, translation, scale) of several items at once, all or
 * nothing: None when any index is out of range or any transform is invalid.
 */
export const setTransforms = (
  map: MapFile,
  entries: ReadonlyArray<readonly [index: number, transform: unknown]>
): Option.Option<MapFile> => {
  const items = map.items.slice()
  for (const [index, transform] of entries) {
    const item = items[index]
    const t = validTransform(transform)
    if (item === undefined || Option.isNone(t)) return Option.none()
    items[index] = { ...item, itemTransform: { ...item.itemTransform, ...t.value } }
  }
  return Option.some({ ...map, items })
}

/**
 * Sets properties to the same values on several items, all or nothing: None when any index
 * is out of range or any value doesn't fit its property's list.
 */
export const setProperties = (
  map: MapFile,
  indices: ReadonlyArray<number>,
  changes: ReadonlyArray<PropertyChange>
): Option.Option<MapFile> => {
  const items = map.items.slice()
  for (const index of indices) {
    let item = items[index]
    for (const { property, value } of changes) {
      const next = item === undefined ? Option.none() : withProperty(item, property, value)
      if (Option.isNone(next)) return Option.none()
      item = next.value
    }
    if (item === undefined) return Option.none()
    items[index] = item
  }
  return Option.some({ ...map, items })
}

/**
 * Copied items, detached from any map: each item as it was when copied (transform and
 * properties), and its `editorState.pivots` entry with `itemIndex` pointing into `items`.
 */
export interface Clip {
  readonly items: ReadonlyArray<Item>
  readonly pivots: ReadonlyArray<ItemPivot>
}

/** The items at `indices` (in that order, out-of-range ones skipped) with their pivots. */
export const copyItems = (map: MapFile, indices: ReadonlyArray<number>): Clip => {
  const sources = indices.filter((i) => map.items[i] !== undefined)
  const position = new Map(sources.map((source, n) => [source, n]))
  return {
    items: sources.flatMap((i) => map.items[i] ?? []),
    pivots: (map.editorState?.pivots ?? []).flatMap((p) => {
      const itemIndex = position.get(p.itemIndex)
      return itemIndex === undefined ? [] : [{ ...p, itemIndex }]
    })
  }
}

/**
 * Appends a clip's items where they were copied, with their pivots moved to the new
 * indices, so a copy keeps its original's pivot choice. A map without `editorState` (a
 * published .ballmap) has nowhere to keep pivots, so they are dropped.
 */
export const pasteItems = (map: MapFile, clip: Clip): MapFile => {
  if (clip.items.length === 0) return map
  const items = [...map.items, ...clip.items]
  if (map.editorState === undefined) return { ...map, items }
  const offset = map.items.length
  const pivots = clip.pivots.map((p) => ({ ...p, itemIndex: p.itemIndex + offset }))
  return { ...map, items, editorState: { ...map.editorState, pivots: [...map.editorState.pivots, ...pivots] } }
}

/** Appends copies of items (in the given order), pivots included: copy, then paste. */
export const duplicateItems = (map: MapFile, indices: ReadonlyArray<number>): MapFile =>
  pasteItems(map, copyItems(map, indices))

/** Validates a freshly built item against the schema before it enters the document. */
export const validateItem = (candidate: unknown): Option.Option<Item> => decodeItem(candidate)

export const setLevelNames = (map: MapFile, displayName: string, creatorName: string): MapFile => ({
  ...map,
  worldSettings: {
    ...map.worldSettings,
    levelData: {
      ...map.worldSettings.levelData,
      levelDisplayName: displayName,
      creatorName,
      userLevelName: `${displayName}_${creatorName}`
    }
  }
})
