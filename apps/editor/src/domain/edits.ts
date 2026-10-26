/**
 * Edits on a MapFile. Pure functions returning a new MapFile (unchanged items are shared,
 * which keeps undo snapshots cheap). Inputs from the UI are validated with the domain
 * schemas before they reach the document.
 */
import { Option, Schema } from "effect"
import { Item, ItemTransform, type MapFile, Vector3 } from "./MapFile"

const decodeVector3 = Schema.decodeUnknownOption(Vector3)
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
        .map((p) => (sorted[0]! < p.itemIndex ? { ...p, itemIndex: shift(p.itemIndex) } : p))
    }
  }
}

export const replaceItem = (map: MapFile, index: number, item: Item): MapFile => {
  if (index < 0 || index >= map.items.length) return map
  const items = map.items.slice()
  items[index] = item
  return { ...map, items }
}

/** Sets an item's translation (UE cm). Returns None for invalid input (non-finite, wrong shape, bad index). */
export const setTranslation = (map: MapFile, index: number, translation: unknown): Option.Option<MapFile> => {
  const item = map.items[index]
  if (item === undefined) return Option.none()
  return Option.map(decodeVector3(translation), (t: Vector3) =>
    replaceItem(map, index, { ...item, itemTransform: { ...item.itemTransform, translation: t } }))
}

/**
 * Replaces an item's transform (rotation, translation, scale). The game rejects
 * non-normalized rotations, so the quaternion is renormalized; a zero-length quaternion
 * or any non-finite value is rejected.
 */
export const setTransform = (map: MapFile, index: number, transform: unknown): Option.Option<MapFile> => {
  const item = map.items[index]
  if (item === undefined) return Option.none()
  return Option.flatMap(decodeTransform(transform), (t: ItemTransform) => {
    const q = t.rotation
    const length = Math.hypot(q.x, q.y, q.z, q.w)
    if (!(length > 1e-9)) return Option.none()
    const rotation = { ...q, x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length }
    return Option.some(replaceItem(map, index, { ...item, itemTransform: { ...item.itemTransform, ...t, rotation } }))
  })
}

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
