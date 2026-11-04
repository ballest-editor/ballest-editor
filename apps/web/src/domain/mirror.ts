/**
 * Mirroring (0.4.1): the game's Flip X and Flip Y flip an item's geometry along its local x and
 * y axes. The map file keeps the item's transform as it was and stores the flags as the bool
 * properties `bMirrorX` and `bMirror`. An item mirrored on one axis saves its mesh as the
 * game's baked mirror of it (catalog `mirrors`); on both, which is a half turn about local z,
 * the original. Some pieces also swap a slot material (the spinning cylinder's cap). From the
 * "new pieces probe" saved in game; see docs/FORMAT.md.
 *
 * The editor draws a mirrored item as the original mesh scaled by -1 along the flipped axes;
 * one that swaps materials instead is drawn with the swapped materials only.
 */
import type { CatalogIndex } from "./Catalog"
import type { Tuple3 } from "./coords"
import { type Item, MESH_COMPONENT_TAG, objectPathOf } from "./MapFile"

export const MIRROR_X = "bMirrorX"
export const MIRROR_Y = "bMirror"
/** Flip Y on the spinning cylinder and paddle, which have no `bMirror` (measured: docs/qa/exposed-properties.md). */
export const PHYSICS_FLIP = "PhysicsFlip"

/** Whether a property is one of the flags that change how an item is mirrored. */
export const isMirrorFlag = (name: string): boolean => name === MIRROR_X || name === MIRROR_Y || name === PHYSICS_FLIP

export interface MirrorFlags {
  readonly x: boolean
  readonly y: boolean
}

export type FlipAxis = keyof MirrorFlags

const flag = (item: Item, name: string): boolean =>
  item.boolProperties.some((p) => p.propertyName === name && p.currentValue)

export const mirrorFlagsOf = (item: Item): MirrorFlags => ({
  x: flag(item, MIRROR_X),
  y: flag(item, MIRROR_Y) || flag(item, PHYSICS_FLIP)
})

/** The mesh a saved mesh path draws: a baked mirror's source, else the path itself. */
export const sourceMeshOf = (index: CatalogIndex | null, meshAssetPath: string): string =>
  index?.mirrorSources.get(meshAssetPath) ?? meshAssetPath

const mainComponent = (item: Item) => item.meshComponents.find((mc) => mc.meshComponentTag === MESH_COMPONENT_TAG)

/** The material swap a stored slot material takes part in, if any. */
const swapOf = (index: CatalogIndex, stored: string) => {
  const path = objectPathOf(stored)
  return index.mirrorMaterials.find((s) => s.material === path || s.mirrored === path)
}

/**
 * A piece that mirrors by swapping materials (the spinning cylinder's cap) keeps its mesh,
 * even when a bake of it exists: the probe's mirrored cylinder saved its own mesh.
 */
const swapsMaterials = (item: Item, index: CatalogIndex): boolean =>
  mainComponent(item)?.materials.some((m) => swapOf(index, m.material) !== undefined) === true

/**
 * The local (UE) scale that draws the item's mirroring, or undefined when it draws as it is:
 * not mirrored, or its mesh has no baked mirror (the game keeps such a mesh, like the
 * spinning cylinder's, and only swaps materials).
 */
export const mirrorScaleOf = (item: Item, index: CatalogIndex | null): Tuple3 | undefined => {
  const { x, y } = mirrorFlagsOf(item)
  if (!x && !y) return undefined
  // Nothing saved to bake: the game flips the actor it built from the class (measured on the two-cube classes and the
  // orange sign, which only load this way).
  if (item.meshComponents.length === 0) return [x ? -1 : 1, y ? -1 : 1, 1]
  const path = mainComponent(item)?.meshAssetPath
  if (path === undefined || index === null || swapsMaterials(item, index)) return undefined
  const source = sourceMeshOf(index, path)
  if (!index.mirrorMeshes.has(source)) return undefined
  return [x ? -1 : 1, y ? -1 : 1, 1]
}

/**
 * The item's Main mesh and slot materials for its current flags, as the game saves them: the
 * baked mirror on one axis, the source on none or both; swapped materials likewise. Call it
 * after a flag changes.
 */
export const withMirrorMesh = (item: Item, index: CatalogIndex | null): Item => {
  if (index === null) return item
  const { x, y } = mirrorFlagsOf(item)
  const odd = x !== y
  const keepMesh = swapsMaterials(item, index)
  const material = (stored: string): string => {
    const path = objectPathOf(stored)
    const swap = swapOf(index, stored)
    if (swap === undefined) return stored
    const wanted = odd ? swap.mirrored : swap.material
    // the pair are instances of one master, so the stored class prefix stays right
    return wanted === path ? stored : stored.replace(path, wanted)
  }
  const meshComponents = item.meshComponents.map((mc) => {
    if (mc.meshComponentTag !== MESH_COMPONENT_TAG) return mc
    const path = mc.meshAssetPath
    const source = path === undefined ? undefined : sourceMeshOf(index, path)
    const mirror = source === undefined ? undefined : index.mirrorMeshes.get(source)
    const meshAssetPath = source === undefined ? undefined : odd && mirror !== undefined && !keepMesh ? mirror : source
    const materials = mc.materials.map((m) => ({ ...m, material: material(m.material) }))
    const materialChanged = materials.some((m, i) => m.material !== mc.materials[i]?.material)
    if (meshAssetPath === path && !materialChanged) return mc
    // materialAssetPaths repeats the materials as object paths; older maps leave it empty
    const listsMaterials = mc.materialAssetPaths !== undefined && mc.materialAssetPaths.length === mc.materials.length
    return {
      ...mc,
      ...(meshAssetPath === undefined ? {} : { meshAssetPath }),
      materials,
      ...(listsMaterials ? { materialAssetPaths: materials.map((m) => objectPathOf(m.material)) } : {})
    }
  })
  return meshComponents.some((mc, i) => mc !== item.meshComponents[i]) ? { ...item, meshComponents } : item
}
