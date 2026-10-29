/**
 * Edits on a MapFile. Pure functions returning a new MapFile (unchanged items are shared,
 * which keeps undo snapshots cheap). Inputs from the UI are validated with the domain
 * schemas before they reach the document.
 */
import { Option, Schema } from "effect"
import { qualifyMaterialPath } from "./factory"
import { Item, ItemTransform, type MapFile, type MeshComponent, objectPathOf } from "./MapFile"

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
 * Appends copies of items (in the given order) and copies their `editorState.pivots`
 * entries to the new indices, so a copy keeps its original's pivot choice.
 */
export const duplicateItems = (map: MapFile, indices: ReadonlyArray<number>): MapFile => {
  const sources = indices.filter((i) => map.items[i] !== undefined)
  if (sources.length === 0) return map
  const items = [...map.items, ...sources.flatMap((i) => map.items[i] ?? [])]
  if (map.editorState === undefined) return { ...map, items }
  const copyOf = new Map(sources.map((source, n) => [source, map.items.length + n]))
  const copied = map.editorState.pivots.flatMap((p) => {
    const itemIndex = copyOf.get(p.itemIndex)
    return itemIndex === undefined ? [] : [{ ...p, itemIndex }]
  })
  return { ...map, items, editorState: { ...map.editorState, pivots: [...map.editorState.pivots, ...copied] } }
}

/** One material slot of one item: `meshComponents[component].materials` entry `slot` (its materialIndex). */
export interface SlotMaterial {
  readonly index: number
  readonly component: number
  readonly slot: number
  /** Class-qualified, as map files store it; a bare object path is qualified. */
  readonly material: string
}

/** A mesh component with `slot` set to `material`, and `materialAssetPaths` kept in step (as the game writes it). */
const withSlotMaterial = (mesh: MeshComponent, slot: number, material: string): MeshComponent => {
  const existing = mesh.materials.some((m) => m.materialIndex === slot)
  const materials = existing
    ? mesh.materials.map((m) => (m.materialIndex === slot ? { ...m, material } : m))
    : [...mesh.materials, { material, materialIndex: slot }].sort((a, b) => a.materialIndex - b.materialIndex)
  return mesh.materialAssetPaths === undefined
    ? { ...mesh, materials }
    : { ...mesh, materials, materialAssetPaths: materials.map((m) => objectPathOf(m.material)) }
}

/**
 * Sets material slots on several items at once, all or nothing: None when an item or mesh
 * component doesn't exist. Slots that already hold the material are left alone, and the same
 * map comes back when nothing changed.
 */
export const setSlotMaterials = (map: MapFile, edits: ReadonlyArray<SlotMaterial>): Option.Option<MapFile> => {
  const items = map.items.slice()
  let changed = false
  for (const { index, component, slot, material } of edits) {
    const item = items[index]
    const mesh = item?.meshComponents[component]
    if (item === undefined || mesh === undefined || !Number.isInteger(slot) || slot < 0) return Option.none()
    const qualified = qualifyMaterialPath(material)
    if (mesh.materials.find((m) => m.materialIndex === slot)?.material === qualified) continue
    const meshComponents = item.meshComponents.slice()
    meshComponents[component] = withSlotMaterial(mesh, slot, qualified)
    items[index] = { ...item, meshComponents }
    changed = true
  }
  return Option.some(changed ? { ...map, items } : map)
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
