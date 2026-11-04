/**
 * What to draw for a map item, derived from the item and the catalog index. Pure data: no
 * three.js, no React, so the inspector and the preloader can share it with ItemObject.
 */
import { type CatalogIndex, type MeshInfo, slotDefaultsOf, visibleExtras } from "../domain/Catalog"
import { type Tuple3, type Tuple4, ueToScene } from "../domain/coords"
import type { Item } from "../domain/MapFile"
import { sourceMeshOf } from "../domain/mirror"
import { surfaceMaterialOf, type Surfaces } from "../domain/surface"
import { assetUrl } from "./assetUrl"

/** URL of a catalog glb (`pieces/...`); undefined when there is none. */
export const glbUrl = (glb: string | null | undefined): string | undefined =>
  glb === undefined || glb === null || glb.length === 0 ? undefined : assetUrl(glb)

export interface Visual {
  readonly key: string
  readonly mesh: MeshInfo | undefined
  /** Game material path per UE slot index. */
  readonly slotMaterials: ReadonlyArray<string | undefined>
  readonly relative?: { readonly position: Tuple3; readonly quaternion: Tuple4; readonly scale: Tuple3 }
}

/**
 * An item's own mesh components, plus the class's visible extra meshes. An item with no
 * components has the class's Main mesh, as the game draws it. A baked mirror mesh draws as its
 * source (ItemObject applies the mirroring); an item with a surface draws every slot with the
 * surface's material, like the game.
 */
export const visualsOf = (item: Item, index: CatalogIndex | null, surfaces: Surfaces = []): ReadonlyArray<Visual> => {
  const visuals: Array<Visual> = []
  const surface = surfaceMaterialOf(item, surfaces)
  const withSurface = (slots: ReadonlyArray<string | undefined>) =>
    surface === undefined ? slots : Array.from({ length: Math.max(slots.length, 1) }, () => surface)
  const piece = index?.pieceByClass.get(item.actorToSpawn)
  if (item.meshComponents.length === 0 && typeof piece?.meshAssetPath === "string") {
    const mesh = index?.meshes.get(piece.meshAssetPath)
    visuals.push({ key: "main", mesh, slotMaterials: withSurface(slotDefaultsOf(piece.materialSlots)) })
  }
  item.meshComponents.forEach((mc, i) => {
    const saved = mc.meshAssetPath
    if (saved === undefined || saved.length === 0) return
    const path = sourceMeshOf(index, saved)
    const mesh = index?.meshes.get(path) ?? { meshAssetPath: path, glb: undefined, bounds: undefined, slotDefaults: [] }
    // The item's own materials win; slots it doesn't set use the catalog defaults.
    const slotMaterials = [...mesh.slotDefaults]
    for (const m of mc.materials) slotMaterials[m.materialIndex] = m.material
    visuals.push({ key: `m${i}`, mesh, slotMaterials: withSurface(slotMaterials) })
  })
  visibleExtras(piece).forEach((extra, i) => {
    const t = extra.transformRelativeToMain
    const rel = ueToScene({
      translation: { x: t.location[0], y: t.location[1], z: t.location[2] },
      rotation: { x: t.quat[0], y: t.quat[1], z: t.quat[2], w: t.quat[3] },
      scale3D: { x: t.scale[0], y: t.scale[1], z: t.scale[2] }
    })
    const mesh = index?.meshes.get(extra.meshAssetPath ?? "") ??
      {
        meshAssetPath: extra.meshAssetPath ?? "",
        glb: extra.glb ?? undefined,
        bounds: extra.bounds ?? undefined,
        slotDefaults: []
      }
    // The component's own slot materials: the same engine cube is the vent's air beam and the
    // checkpoint's glow panel, so the mesh-level defaults (first piece to use it) are not enough.
    const own = slotDefaultsOf(extra.materialSlots)
    visuals.push({
      key: `x${i}`,
      mesh,
      slotMaterials: withSurface(own.length > 0 ? own : mesh.slotDefaults),
      relative: rel
    })
  })
  return visuals
}
