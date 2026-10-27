/**
 * What to draw for a map item, derived from the item and the catalog index. Pure data: no
 * three.js, no React, so the inspector and the preloader can share it with ItemObject.
 */
import { type CatalogIndex, type MeshInfo, visibleExtras } from "../domain/Catalog"
import { type Tuple3, type Tuple4, ueToScene } from "../domain/coords"
import type { Item } from "../domain/MapFile"

/** URL of a catalog glb (`pieces/...`) under the served assets dir; undefined when there is none. */
export const glbUrl = (glb: string | null | undefined): string | undefined =>
  glb === undefined || glb === null || glb.length === 0 ? undefined : `/assets/${glb}`

export interface Visual {
  readonly key: string
  readonly mesh: MeshInfo | undefined
  /** Game material path per UE slot index. */
  readonly slotMaterials: ReadonlyArray<string | undefined>
  readonly relative?: { readonly position: Tuple3; readonly quaternion: Tuple4; readonly scale: Tuple3 }
}

/** An item's own mesh components, plus the class's visible extra meshes. */
export const visualsOf = (item: Item, index: CatalogIndex | null): ReadonlyArray<Visual> => {
  const visuals: Array<Visual> = []
  item.meshComponents.forEach((mc, i) => {
    const path = mc.meshAssetPath
    if (path === undefined || path.length === 0) return
    const mesh = index?.meshes.get(path) ?? { meshAssetPath: path, glb: undefined, bounds: undefined, slotDefaults: [] }
    // The item's own materials win; slots it doesn't set use the catalog defaults.
    const slotMaterials = [...mesh.slotDefaults]
    for (const m of mc.materials) slotMaterials[m.materialIndex] = m.material
    visuals.push({ key: `m${i}`, mesh, slotMaterials })
  })
  visibleExtras(index?.pieceByClass.get(item.actorToSpawn)).forEach((extra, i) => {
    const t = extra.transformRelativeToMain
    const rel = ueToScene({
      translation: { x: t.location[0], y: t.location[1], z: t.location[2] },
      rotation: { x: t.quat[0], y: t.quat[1], z: t.quat[2], w: t.quat[3] },
      scale3D: { x: t.scale[0], y: t.scale[1], z: t.scale[2] }
    })
    const mesh = index?.meshes.get(extra.meshAssetPath ?? "") ??
      { meshAssetPath: extra.meshAssetPath ?? "", glb: extra.glb ?? undefined, bounds: extra.bounds ?? undefined, slotDefaults: [] }
    visuals.push({ key: `x${i}`, mesh, slotMaterials: mesh.slotDefaults, relative: rel })
  })
  return visuals
}
