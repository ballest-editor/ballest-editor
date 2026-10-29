/**
 * Per-item pivots (`editorState.pivots`), as the game's editor sets them: a choice, and the
 * point it names in the item's local frame, in unscaled cm. The gizmo sits on the pivot and
 * turns and scales the item about it.
 *
 * The game writes `localPosition` as the matching point on the Main mesh's local bounds:
 * the centre of the box, or the centre of one face. Back is +X, Front -X, Right +Y, Left -Y,
 * Top +Z, Bottom -Z. Every pivot in `samples/` matches this against the catalog's bounds
 * (pivot.test.ts). Default is the item's origin, and items with no entry are Default.
 */
import type { Bounds, CatalogIndex } from "./Catalog"
import type { UeTransform, Vec3 } from "./coords"
import type { Item, ItemPivot, MapFile } from "./MapFile"
import { rotateVec } from "./ueMath"

/** In the order the game's inspector lays them out. */
export const PIVOT_CHOICES = ["Default", "Center", "Bottom", "Top", "Left", "Right", "Back", "Front"] as const
export type PivotChoice = (typeof PIVOT_CHOICES)[number]

export interface Pivot {
  /** One of PIVOT_CHOICES in every known file, but kept as written. */
  readonly choice: string
  readonly localPosition: Vec3
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }
export const DEFAULT_PIVOT: Pivot = { choice: "Default", localPosition: ORIGIN }

/** The point `choice` names on local `bounds` (cm, unscaled). */
export const pivotPointOnBounds = (bounds: Bounds, choice: PivotChoice): Vec3 => {
  if (choice === "Default") return ORIGIN
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }
  switch (choice) {
    case "Center":
      return c
    case "Bottom":
      return { ...c, z: z0 }
    case "Top":
      return { ...c, z: z1 }
    case "Left":
      return { ...c, y: y0 }
    case "Right":
      return { ...c, y: y1 }
    case "Back":
      return { ...c, x: x1 }
    case "Front":
      return { ...c, x: x0 }
  }
}

/** The local bounds a pivot is measured on: the class's Main mesh, else the item's first mesh. */
export const pivotBoundsOf = (item: Item, index: CatalogIndex | null): Bounds | undefined => {
  const piece = index?.pieceByClass.get(item.actorToSpawn)
  if (piece?.bounds !== undefined && piece.bounds !== null) return piece.bounds
  const path = item.meshComponents[0]?.meshAssetPath
  return path === undefined ? undefined : index?.meshes.get(path)?.bounds
}

/** The pivot `choice` for `item`; undefined when its bounds are unknown (only Default works then). */
export const pivotFor = (item: Item, index: CatalogIndex | null, choice: PivotChoice): Pivot | undefined => {
  if (choice === "Default") return DEFAULT_PIVOT
  const bounds = pivotBoundsOf(item, index)
  return bounds === undefined ? undefined : { choice, localPosition: pivotPointOnBounds(bounds, choice) }
}

const byIndexCache = new WeakMap<ReadonlyArray<ItemPivot>, ReadonlyMap<number, Pivot>>()
const NO_PIVOTS: ReadonlyArray<ItemPivot> = []

/**
 * Each item's pivot by document index (the first entry wins if a file lists one twice).
 * Cached per pivots array, which edits replace rather than mutate.
 */
export const pivotsByIndex = (map: MapFile): ReadonlyMap<number, Pivot> => {
  const pivots = map.editorState?.pivots ?? NO_PIVOTS
  const cached = byIndexCache.get(pivots)
  if (cached !== undefined) return cached
  const out = new Map<number, Pivot>()
  for (const p of pivots) if (!out.has(p.itemIndex)) out.set(p.itemIndex, p.pivot)
  byIndexCache.set(pivots, out)
  return out
}

/** An item's pivot; Default when it has no entry. */
export const pivotAt = (map: MapFile, index: number): Pivot => pivotsByIndex(map).get(index) ?? DEFAULT_PIVOT

/** Where a local point (unscaled cm) ends up in the world under `t`. */
export const localToWorld = (t: UeTransform, local: Vec3): Vec3 => {
  const s = t.scale3D
  const r = rotateVec(t.rotation, { x: local.x * s.x, y: local.y * s.y, z: local.z * s.z })
  return { x: t.translation.x + r.x, y: t.translation.y + r.y, z: t.translation.z + r.z }
}
