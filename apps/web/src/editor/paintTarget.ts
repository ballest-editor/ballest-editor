/**
 * The paint tool (#97): what the pointer is over, and what a click there does with the tool's paint, by the game's rules
 * (docs/FORMAT.md § Materials, docs/qa/materials.md). The viewport raycasts; everything after the hit is here.
 *
 * A glb primitive is one mesh per UE material slot (`slotIndexOf`), under the visual it belongs to (`VISUAL_KEY`:
 * `main`, `m<i>`, `x<i>`), under the item (`userData.itemId`).
 */
import type * as THREE from "three"
import type { CatalogIndex } from "../domain/Catalog"
import { mainMeshComponentOf, qualifyMaterialPath } from "../domain/factory"
import { refusesMeshComponents } from "../domain/gameRules"
import { formatClick, formatModifiers, type Keybinds } from "../domain/Keybinds"
import type { Item, MeshComponent } from "../domain/MapFile"
import { sourceMeshOf } from "../domain/mirror"
import { NOT_PAINTED, offPanelSlotsOf, SURFACE_LOCKED } from "../domain/Paint"
import { SURFACE_PROPERTY, surfaceOf } from "../domain/surface"
import { slotIndexOf } from "./materials"
import { isMesh } from "./threeGuards"
import { VISUAL_KEY, visualsOf } from "./visuals"

/** What the paint tool paints with: one of the picker's materials (or any other), or a surface by its saved value. */
export type Brush =
  | { readonly _tag: "Material"; readonly material: string }
  | { readonly _tag: "Surface"; readonly value: number }

/** Where on an item the pointer is: which of its visuals, and the UE slot of the primitive hit. */
export interface PaintSpot {
  readonly itemId: string
  /** The visual's key; undefined on a part of the item that isn't one of its meshes. */
  readonly visual: string | undefined
  readonly slot: number
}

/** One slot to paint: `SlotMaterial` without the item. */
export interface SlotEdit {
  readonly component: number
  readonly slot: number
  readonly material: string
  readonly creates?: MeshComponent
}

export type PaintEffect =
  | { readonly _tag: "Slots"; readonly edits: ReadonlyArray<SlotEdit> }
  | { readonly _tag: "Surface"; readonly value: number }
  | { readonly _tag: "Blocked"; readonly reason: string }

export interface PaintTarget {
  readonly spot: PaintSpot
  /** The whole item (a surface, or the whole-piece modifier); otherwise the spot's slot alone. */
  readonly whole: boolean
  /** A stroke paints each key once. */
  readonly key: string
  readonly effect: PaintEffect
}

/** Why the paint tool won't paint there, for the status bar. */
export const PAINT_BLOCKED = {
  surfaceLocked: SURFACE_LOCKED,
  notPainted: NOT_PAINTED,
  offPanel: "The game doesn't paint this slot of the piece.",
  extra: "The game doesn't paint this part of the piece.",
  nothing: "Nothing here takes paint.",
  noComponents: "The game discards a map with this piece painted.",
  unknownSlots: "The catalog doesn't know this mesh's slots.",
  noSurface: "The game gives this piece no surface."
} as const

/** What the paint tool's clicks do, for the status bar, in the keys they are bound to. */
export const paintHintOf = (keybinds: Keybinds): string => {
  const whole = keybinds.paintWholePiece.map((binding) => formatModifiers(binding)).find((m) => m !== undefined)
  const pick = keybinds.pickPaint[0]
  return [
    "Click or drag to paint a slot",
    ...(whole === undefined ? [] : [`Hold ${whole} for the whole piece`]),
    ...(pick === undefined ? [] : [`${formatClick(pick)} picks`])
  ].join(" · ")
}

const itemIdOf = (object: THREE.Object3D): string | undefined => {
  const id: unknown = object.userData["itemId"]
  return typeof id === "string" ? id : undefined
}

const visualKeyOf = (object: THREE.Object3D): string | undefined => {
  const key: unknown = object.userData[VISUAL_KEY]
  return typeof key === "string" ? key : undefined
}

/** The spot of the nearest hit on an item's mesh, if any. Lines and other parts that aren't meshes don't count. */
export const paintSpotOf = (hits: ReadonlyArray<THREE.Intersection>): PaintSpot | undefined => {
  for (const { object } of hits) {
    if (!isMesh(object)) continue
    let visual: string | undefined
    for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
      visual ??= visualKeyOf(o)
      const itemId = itemIdOf(o)
      if (itemId !== undefined) return { itemId, visual, slot: slotIndexOf(object) }
    }
  }
  return undefined
}

/**
 * Which meshes under an item's object show a target: all of them for the whole item, else the primitives of the spot's
 * slot in the spot's visual (one slot can span several primitives).
 */
export const showsTarget = (target: Pick<PaintTarget, "spot" | "whole">) => (mesh: THREE.Mesh): boolean => {
  if (target.whole) return true
  if (slotIndexOf(mesh) !== target.spot.slot) return false
  for (let o: THREE.Object3D | null = mesh; o !== null && itemIdOf(o) === undefined; o = o.parent) {
    const key = visualKeyOf(o)
    if (key !== undefined) return key === target.spot.visual
  }
  return false
}

/** The mesh component a visual draws: `main` is the one painting it creates. Undefined for an extra mesh. */
const componentOf = (visual: string | undefined): number | undefined => {
  if (visual === "main") return 0
  const match = visual === undefined ? null : /^m(\d+)$/.exec(visual)
  return match === null ? undefined : Number(match[1])
}

/** A mesh component the tool can paint, with what it needs to paint it as the game would save it. */
interface PaintableMesh {
  readonly component: number
  /** The mesh's slot count; 0 when the catalog doesn't know the mesh. */
  readonly slots: number
  readonly defaults: ReadonlyArray<string | undefined>
  /** The slots the component lists already. */
  readonly listed: ReadonlySet<number>
  readonly creates?: MeshComponent
}

/**
 * The item's paintable mesh components. An item with none draws its class's Main mesh (visuals.ts), and painting it
 * saves that mesh as the game writes it for a fresh piece. A mirrored component draws its source mesh, whose slots are
 * the same.
 */
const paintableMeshesOf = (item: Item, index: CatalogIndex | null): ReadonlyArray<PaintableMesh> => {
  if (item.meshComponents.length === 0) {
    const piece = index?.pieceByClass.get(item.actorToSpawn)
    if (typeof piece?.meshAssetPath !== "string") return []
    const creates = mainMeshComponentOf(piece)
    const defaults = creates.materials.map((m) => m.material)
    return [{ component: 0, slots: defaults.length, defaults, listed: new Set(defaults.keys()), creates }]
  }
  return item.meshComponents.flatMap((mesh, component) => {
    const path = mesh.meshAssetPath
    if (path === undefined || path.length === 0) return []
    const defaults = index?.meshes.get(sourceMeshOf(index, path))?.slotDefaults ?? []
    return [{
      component,
      slots: defaults.length,
      defaults,
      listed: new Set(mesh.materials.map((m) => m.materialIndex))
    }]
  })
}

/**
 * The edits that paint `slots` of `mesh` with `material`. A slot the component doesn't list yet comes with its default
 * for each unlisted slot below it, so the list stays contiguous from 0, as the game writes it.
 */
const editsFor = (mesh: PaintableMesh, slots: ReadonlyArray<number>, material: string): ReadonlyArray<SlotEdit> => {
  const { component, creates } = mesh
  const painted = new Set(slots)
  const top = Math.max(...slots)
  const fills = Array.from({ length: top }, (_, slot) => slot).flatMap((slot) => {
    const fill = mesh.defaults[slot]
    return painted.has(slot) || mesh.listed.has(slot) || fill === undefined ? [] : [{ slot, material: fill }]
  })
  return [...slots.map((slot) => ({ slot, material })), ...fills]
    .sort((a, b) => a.slot - b.slot)
    .map((edit) => ({ component, ...edit, ...(creates === undefined ? {} : { creates }) }))
}

const blocked = (reason: string): PaintEffect => ({ _tag: "Blocked", reason })

/** Whether the game offers the item a surface: its class lists the property unhidden, or an unknown class saved one. */
const takesSurface = (item: Item, index: CatalogIndex | null): boolean => {
  const listed = index?.pieceByClass.get(item.actorToSpawn)?.properties?.find((p) => p.name === SURFACE_PROPERTY)
  return listed === undefined
    ? item.intProperties.some((p) => p.propertyName === SURFACE_PROPERTY)
    : listed.hidden !== true
}

const materialEffect = (
  spot: PaintSpot,
  item: Item,
  index: CatalogIndex | null,
  material: string,
  whole: boolean
): PaintEffect => {
  if (surfaceOf(item) !== 0) return blocked(PAINT_BLOCKED.surfaceLocked)
  if (item.meshComponents.length === 0 && refusesMeshComponents(item.actorToSpawn)) {
    return blocked(PAINT_BLOCKED.noComponents)
  }
  const offPanel = offPanelSlotsOf(item, index)
  const allowed = (slot: number) => offPanel === undefined || offPanel.has(slot)
  const lockedReason = offPanel === undefined || offPanel.size === 0 ? PAINT_BLOCKED.notPainted : PAINT_BLOCKED.offPanel
  const meshes = paintableMeshesOf(item, index)
  if (whole) {
    const edits = meshes.flatMap((mesh) => {
      const slots = Array.from({ length: mesh.slots }, (_, slot) => slot).filter(allowed)
      return slots.length === 0 ? [] : editsFor(mesh, slots, material)
    })
    return edits.length > 0 ? { _tag: "Slots", edits } : blocked(lockedReason)
  }
  const component = componentOf(spot.visual)
  if (component === undefined) return blocked(spot.visual === undefined ? PAINT_BLOCKED.nothing : PAINT_BLOCKED.extra)
  const mesh = meshes.find((m) => m.component === component)
  if (mesh === undefined) return blocked(PAINT_BLOCKED.nothing)
  if (!allowed(spot.slot)) return blocked(lockedReason)
  // a slot at or past the mesh's count makes the game discard the map
  if (spot.slot >= mesh.slots) return blocked(PAINT_BLOCKED.unknownSlots)
  return { _tag: "Slots", edits: editsFor(mesh, [spot.slot], material) }
}

/**
 * What painting `brush` at `spot` on `item` does. A surface is the item's, so it always covers the whole item; paint
 * covers the spot's slot, or with `wholePiece` every slot the item can take.
 */
export const paintTargetOf = (
  spot: PaintSpot,
  item: Item,
  index: CatalogIndex | null,
  brush: Brush,
  wholePiece: boolean
): PaintTarget => {
  const whole = wholePiece || brush._tag === "Surface"
  const key = whole ? spot.itemId : `${spot.itemId}:${componentOf(spot.visual) ?? spot.visual}:${spot.slot}`
  const effect = brush._tag === "Surface"
    ? takesSurface(item, index) ? { _tag: "Surface" as const, value: brush.value } : blocked(PAINT_BLOCKED.noSurface)
    : materialEffect(spot, item, index, brush.material, whole)
  return { spot, whole, key, effect }
}

/** The eyedropper: the item's surface when it has one (that's what shows), else the material drawn at the spot. */
export const pickedBrushOf = (spot: PaintSpot, item: Item, index: CatalogIndex | null): Brush | undefined => {
  const surface = surfaceOf(item)
  if (surface !== 0) return { _tag: "Surface", value: surface }
  const material = visualsOf(item, index).find((v) => v.key === spot.visual)?.slotMaterials[spot.slot]
  return material === undefined ? undefined : { _tag: "Material", material: qualifyMaterialPath(material) }
}
