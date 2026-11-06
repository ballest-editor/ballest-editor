/**
 * Per-item pivots (`editorState.pivots`), as the game's editor sets them: a choice, and the
 * point it names in the item's local frame, in unscaled cm. The gizmo sits on the pivot and
 * turns and scales the item about it.
 *
 * The game writes `localPosition` as the matching point on the item's local bounds: the
 * centre of the box, or the centre of one face. Back is +X, Front -X, Right +Y, Left -Y,
 * Top +Z, Bottom -Z. Those bounds are the Main mesh's, or the visible components' for a piece
 * with no Main mesh; a few pieces differ (MEASURED_BOUNDS). Every pivot in `samples/` matches
 * this against the catalog (pivot.test.ts). Default is the item's origin, and items with no
 * entry are Default.
 */
import { type Bounds, type CatalogIndex, type CatalogPiece, visibleExtras } from "./Catalog"
import type { UeTransform, Vec3 } from "./coords"
import type { Item, ItemPivot, MapFile } from "./MapFile"
import { mirrorScaleOf } from "./mirror"
import { ORIGIN, rotateVec } from "./ueMath"

/** In the order the game's inspector lays them out. */
export const PIVOT_CHOICES = ["Default", "Center", "Bottom", "Top", "Left", "Right", "Back", "Front"] as const
export type PivotChoice = (typeof PIVOT_CHOICES)[number]

export interface Pivot {
  /** One of PIVOT_CHOICES in every known file, but kept as written. */
  readonly choice: string
  readonly localPosition: Vec3
}

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

const NO_SIZE: Bounds = { min: [0, 0, 0], max: [0, 0, 0] }

/** A decal's frame: a unit box, which its size scales (see editTransform.ts). */
const DECAL_BOX: Bounds = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }

/**
 * Pieces whose pivots the catalog can't give, by class name, as the game's editor measured
 * them on 0.4.1 (docs/FORMAT.md, "Pivots"): every pivot of a raw light is its origin, the
 * laser's box reaches along its beam (exact at scale 1 only: the game's box doesn't follow
 * the item's scale), and the elevator's is taller than its Main mesh. BP_Checkpoint isn't
 * here: its box moves as the goal animates.
 */
const MEASURED_BOUNDS: Readonly<Record<string, Bounds>> = {
  MP_RawPointLight: NO_SIZE,
  MP_RawSpotLight: NO_SIZE,
  MP_RawRectLight: NO_SIZE,
  BP_UGCCircuitDecal: DECAL_BOX,
  BP_UGCShapeDecal: DECAL_BOX,
  MP_LaserTerminal: { min: [-4.6541, -18.7124, -18.7124], max: [113, 18.7124, 18.7124] },
  BP_Elevator: { min: [-150, -150, -8.9917], max: [150, 150, 8.9602] }
}

/** The box around the bounds of `piece`'s visible components, in its local frame. */
const visibleExtrasBounds = (piece: CatalogPiece, index: CatalogIndex): Bounds | undefined => {
  const corners = visibleExtras(piece).flatMap((extra) => {
    const bounds = extra.bounds ?? index.meshes.get(extra.meshAssetPath ?? "")?.bounds
    if (bounds === undefined) return []
    const { location: [lx, ly, lz], quat: [qx, qy, qz, qw], scale: [sx, sy, sz] } = extra.transformRelativeToMain
    const t: UeTransform = {
      translation: { x: lx, y: ly, z: lz },
      rotation: { x: qx, y: qy, z: qz, w: qw },
      scale3D: { x: sx, y: sy, z: sz }
    }
    const [x0, y0, z0] = bounds.min
    const [x1, y1, z1] = bounds.max
    return [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => localToWorld(t, { x, y, z }))))
  })
  if (corners.length === 0) return undefined
  const along = (pick: (...v: Array<number>) => number) =>
    [pick(...corners.map((c) => c.x)), pick(...corners.map((c) => c.y)), pick(...corners.map((c) => c.z))] as const
  return { min: along(Math.min), max: along(Math.max) }
}

/** The class's bounds, unflipped: the measured box, else its Main mesh, else its visible components, else the item's first mesh. */
const unflippedBoundsOf = (item: Item, index: CatalogIndex | null): Bounds | undefined => {
  const piece = index?.pieceByClass.get(item.actorToSpawn)
  if (piece !== undefined && index !== null) {
    const bounds = MEASURED_BOUNDS[piece.className] ?? piece.bounds ?? visibleExtrasBounds(piece, index)
    if (bounds !== undefined) return bounds
  }
  const path = item.meshComponents[0]?.meshAssetPath
  return path === undefined ? undefined : index?.meshes.get(path)?.bounds
}

/** The local bounds a pivot and a group's frame are measured on, which a Flip X or Flip Y flips with the mesh. */
export const pivotBoundsOf = (item: Item, index: CatalogIndex | null): Bounds | undefined => {
  const bounds = unflippedBoundsOf(item, index)
  const flip = mirrorScaleOf(item, index)
  if (bounds === undefined || flip === undefined) return bounds
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const [fx, fy] = flip
  return {
    min: [fx < 0 ? -x1 : x0, fy < 0 ? -y1 : y0, z0],
    max: [fx < 0 ? -x0 : x1, fy < 0 ? -y0 : y1, z1]
  }
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
