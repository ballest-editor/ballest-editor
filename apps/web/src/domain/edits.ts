/**
 * Edits on a MapFile. Pure functions returning a new MapFile (unchanged items are shared,
 * which keeps undo snapshots cheap). Inputs from the UI are validated with the domain
 * schemas before they reach the document.
 */
import { Option, Schema } from "effect"
import { withEditTransform } from "./editTransform"
import { defaultEditorState, qualifyMaterialPath, userLevelNameOf } from "./factory"
import { appliedValue, linkedChanges, type PropertyChange, withProperty } from "./itemProperties"
import {
  Item,
  type ItemPivot,
  ItemTransform,
  type LevelData,
  type MapFile,
  type MeshComponent,
  objectPathOf
} from "./MapFile"
import { type Pivot, pivotAt } from "./pivot"
import { DEFAULT_LIGHT_ANGLE, type Lighting } from "./sunlight"

const decodeItem = Schema.decodeUnknownOption(Item)
const decodeTransform = Schema.decodeUnknownOption(ItemTransform)

export const addItem = (map: MapFile, item: Item): MapFile => ({ ...map, items: [...map.items, item] })

/**
 * Removes items and keeps `editorState` consistent: pivots and group members of removed
 * items are dropped and later indices shift down, and a group left empty goes too. A stale
 * index or an empty group makes the game discard the whole map (`gameLoadProblems`).
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
        }),
      groups: map.editorState.groups.flatMap((group) => {
        const members = group.members.filter((member) => !removed.has(member)).map(shift)
        return members.length === 0 ? [] : [{ ...group, members }]
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
 * Replaces the edit transforms (rotation, translation, scale; see editTransform.ts) of several items
 * at once, all or nothing: None when any index is out of range or any transform is invalid.
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
    items[index] = withEditTransform(item, t.value, pivotAt(map, index).localPosition)
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
    for (const change of changes) {
      if (item === undefined) return Option.none()
      const applied = { property: change.property, value: appliedValue(item, change) }
      for (const { property, value } of [applied, ...linkedChanges(item, applied)]) {
        const next = withProperty(item, property, value)
        if (Option.isNone(next)) return Option.none()
        item = next.value
      }
    }
    if (item === undefined) return Option.none()
    items[index] = item
  }
  return Option.some({ ...map, items })
}

/** One material slot of one item: `meshComponents[component].materials` entry `slot` (its materialIndex). */
export interface SlotMaterial {
  readonly index: number
  readonly component: number
  readonly slot: number
  /**
   * Class-qualified, as map files store it; a bare object path is qualified. Undefined takes the slot's entry out, so
   * the item draws and saves its catalog default there, as the game does for a slot a file leaves out.
   */
  readonly material: string | undefined
  /**
   * The slot's catalog default, for an undefined `material`: written in place of taking the entry out while a higher
   * slot keeps one, as the game lists a component's slots from 0 with none missing. Without it that entry stays.
   */
  readonly fallback?: string | undefined
  /**
   * The component to add when `component` is one past the item's last: an item with none draws its class's Main mesh,
   * and painting it saves that mesh (`mainMeshComponentOf`).
   */
  readonly creates?: MeshComponent | undefined
}

/** `mesh` listing `materials`, with `materialAssetPaths` kept in step where it has them (as the game writes it). */
const withMaterials = (mesh: MeshComponent, materials: MeshComponent["materials"]): MeshComponent =>
  mesh.materialAssetPaths === undefined
    ? { ...mesh, materials }
    : { ...mesh, materials, materialAssetPaths: materials.map((m) => objectPathOf(m.material)) }

/** A mesh component with `slot` set to `material`. */
const withSlotMaterial = (mesh: MeshComponent, slot: number, material: string): MeshComponent => {
  const existing = mesh.materials.some((m) => m.materialIndex === slot)
  const materials = existing
    ? mesh.materials.map((m) => (m.materialIndex === slot ? { ...m, material } : m))
    : [...mesh.materials, { material, materialIndex: slot }].sort((a, b) => a.materialIndex - b.materialIndex)
  return withMaterials(mesh, materials)
}

/**
 * `mesh` with the entries of `cleared` slots taken out, except where a slot that isn't cleared keeps a higher entry:
 * there the slot gets its fallback (the catalog default) instead, so the list stays contiguous.
 */
const withSlotsCleared = (mesh: MeshComponent, cleared: ReadonlyMap<number, string | undefined>): MeshComponent => {
  const top = Math.max(-1, ...mesh.materials.flatMap((m) => cleared.has(m.materialIndex) ? [] : [m.materialIndex]))
  let next = mesh
  for (const [slot, fallback] of cleared) {
    if (slot > top) next = withMaterials(next, next.materials.filter((m) => m.materialIndex !== slot))
    else if (fallback !== undefined) next = withSlotMaterial(next, slot, qualifyMaterialPath(fallback))
  }
  return next
}

const sameMaterials = (a: MeshComponent, b: MeshComponent): boolean =>
  a.materials.length === b.materials.length &&
  a.materials.every((m, i) => {
    const other = b.materials[i]
    return m.material === other?.material && m.materialIndex === other.materialIndex
  })

/**
 * Sets material slots on several items at once, all or nothing: None when an item or mesh component doesn't exist (and
 * the edit creates none). A slot set to undefined loses its entry (`SlotMaterial.material`), after every other edit,
 * and one on a component that doesn't exist has nothing to lose. Slots that already hold the material are left alone,
 * and the same map comes back when nothing changed.
 */
export const setSlotMaterials = (map: MapFile, edits: ReadonlyArray<SlotMaterial>): Option.Option<MapFile> => {
  const items = map.items.slice()
  let changed = false
  /** The slots to clear on each component, with their fallbacks, by `<index>:<component>`. */
  const cleared = new Map<
    string,
    { readonly index: number; readonly component: number; readonly slots: Map<number, string | undefined> }
  >()
  for (const { index, component, slot, material, fallback, creates } of edits) {
    const item = items[index]
    const mesh = item?.meshComponents[component] ??
      (component === item?.meshComponents.length ? creates : undefined)
    if (item === undefined || mesh === undefined || !Number.isInteger(slot) || slot < 0) return Option.none()
    if (material === undefined) {
      const key = `${index}:${component}`
      const entry = cleared.get(key) ?? { index, component, slots: new Map() }
      cleared.set(key, entry)
      entry.slots.set(slot, fallback)
      continue
    }
    const qualified = qualifyMaterialPath(material)
    if (mesh.materials.find((m) => m.materialIndex === slot)?.material === qualified) continue
    const meshComponents = item.meshComponents.slice()
    meshComponents[component] = withSlotMaterial(mesh, slot, qualified)
    items[index] = { ...item, meshComponents }
    changed = true
  }
  for (const { index, component, slots } of cleared.values()) {
    const item = items[index]
    const mesh = item?.meshComponents[component]
    if (item === undefined || mesh === undefined) continue
    const next = withSlotsCleared(mesh, slots)
    if (sameMaterials(next, mesh)) continue
    const meshComponents = item.meshComponents.slice()
    meshComponents[component] = next
    items[index] = { ...item, meshComponents }
    changed = true
  }
  return Option.some(changed ? { ...map, items } : map)
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
 * indices, so a copy keeps its original's pivot choice. A map without `editorState` (an
 * imported .ballmap) gets the empty one the exporter would add anyway, but only when there
 * are pivots to keep.
 */
export const pasteItems = (map: MapFile, clip: Clip): MapFile => {
  if (clip.items.length === 0) return map
  const items = [...map.items, ...clip.items]
  if (clip.pivots.length === 0) return { ...map, items }
  const editorState = map.editorState ?? defaultEditorState()
  const offset = map.items.length
  const pivots = clip.pivots.map((p) => ({ ...p, itemIndex: p.itemIndex + offset }))
  // sorted by item index, as the game writes them (a clip lists them in selection order)
  const all = [...editorState.pivots, ...pivots].sort((x, y) => x.itemIndex - y.itemIndex)
  return { ...map, items, editorState: { ...editorState, pivots: all } }
}

/**
 * Sets the pivots of several items (by index; out-of-range indices are skipped). Default
 * drops the item's entry, as items without one are Default. A map without `editorState`
 * (an imported `.ballmap`) gets the empty one the exporter would add anyway. Entries stay
 * sorted by item index, as the game writes them.
 */
export const setPivots = (
  map: MapFile,
  entries: ReadonlyArray<readonly [index: number, pivot: Pivot]>
): MapFile => {
  const valid = entries.filter(([index]) => map.items[index] !== undefined)
  if (valid.length === 0) return map
  const changed = new Map(valid)
  const editorState = map.editorState ?? defaultEditorState()
  const kept = editorState.pivots.filter((p) => !changed.has(p.itemIndex))
  const added: Array<ItemPivot> = [...changed].flatMap(([itemIndex, pivot]) =>
    pivot.choice === "Default"
      ? []
      : [{ itemIndex, pivot: { choice: pivot.choice, localPosition: { ...pivot.localPosition } } }]
  )
  const pivots = [...kept, ...added].sort((a, b) => a.itemIndex - b.itemIndex)
  return { ...map, editorState: { ...editorState, pivots } }
}

/** Validates a freshly built item against the schema before it enters the document. */
export const validateItem = (candidate: unknown): Option.Option<Item> => decodeItem(candidate)

export const setLevelData = (map: MapFile, levelData: LevelData): MapFile => ({
  ...map,
  worldSettings: { ...map.worldSettings, levelData }
})

export const setLevelNames = (map: MapFile, displayName: string, creatorName: string): MapFile =>
  setLevelData(map, withLevelNames(map.worldSettings.levelData, displayName, creatorName))

export { isNeverPublished } from "@ballest/contracts"

/**
 * The map as a draft that was never published (`levelPublishedFileId` -1), the only kind the plugin manager races: Play's
 * "save as a new draft" for a published map's draft.
 */
export const asNewDraft = (map: MapFile): MapFile =>
  setLevelData(map, { ...map.worldSettings.levelData, levelPublishedFileId: -1 })

/** The map as one just made, for Duplicate: its first export stamps `createdAt`. */
export const asNewMap = (map: MapFile): MapFile => setLevelData(map, { ...map.worldSettings.levelData, createdAt: "" })

/** The display and creator names, and `userLevelName` (`<displayName>_<creator>`) kept in step with them. */
export const withLevelNames = (levelData: LevelData, displayName: string, creatorName: string): LevelData => ({
  ...levelData,
  levelDisplayName: displayName,
  creatorName,
  userLevelName: userLevelNameOf(displayName, creatorName)
})

/**
 * Sets the sun's time of day, brightness and yaw; None when any value isn't finite.
 * `directionalLightAngle` is only added to files that lack it (older saves) when the yaw
 * moves off the game's default, so an untouched map exports as it came in.
 */
export const setLighting = (map: MapFile, lighting: Lighting): Option.Option<MapFile> => {
  const { timeOfDay, brightness, angle } = lighting
  if (![timeOfDay, brightness, angle].every(Number.isFinite)) return Option.none()
  const world = map.worldSettings
  const keepsAngle = world.directionalLightAngle !== undefined || angle !== DEFAULT_LIGHT_ANGLE
  return Option.some({
    ...map,
    worldSettings: {
      ...world,
      directionalLight: { ...world.directionalLight, timeOfDay, brightness },
      ...(keepsAngle ? { directionalLightAngle: angle } : {})
    }
  })
}
