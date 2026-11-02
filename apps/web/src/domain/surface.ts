/**
 * Item surfaces (0.4.1): the physics surface the level editor assigns per item, saved as the
 * integer item property `SurfaceAssignment`: 0 none, 1 magnet, 2 ice, 3 grippy, the order of
 * `surfaces` in assets/materials.json (tools/extract). A surface leaves the item's saved
 * materials alone; the game draws the item with the surface's material instead.
 */
import { Option, Schema } from "effect"
import type { Item } from "./MapFile"
import { open } from "./schema"

export const SURFACE_PROPERTY = "SurfaceAssignment"

export const Surface = open({ name: Schema.String, material: Schema.NullOr(Schema.String) })
export type Surface = typeof Surface.Type

/** Surfaces by saved value. */
export type Surfaces = ReadonlyArray<Surface>

const decodeSurface = Schema.decodeUnknownOption(Surface)

/** The surfaces from a materials.json; a missing key gives none, an entry that doesn't decode ends the list. */
export const parseSurfaces = (json: unknown): Surfaces => {
  const list = typeof json === "object" && json !== null && "surfaces" in json ? json.surfaces : undefined
  if (!Array.isArray(list)) return []
  const out: Array<Surface> = []
  for (const value of list) {
    const surface = decodeSurface(value)
    // values are positions in the list, so one that doesn't decode leaves the rest unnamed
    if (Option.isNone(surface)) break
    out.push(surface.value)
  }
  return out
}

/** The item's saved surface value; 0 (none) when it has none. */
export const surfaceOf = (item: Item): number =>
  item.intProperties.find((p) => p.propertyName === SURFACE_PROPERTY)?.currentValue ?? 0

/** The material the game draws the item with for its surface; undefined for none or an unknown value. */
export const surfaceMaterialOf = (item: Item, surfaces: Surfaces): string | undefined => {
  const value = surfaceOf(item)
  return value === 0 ? undefined : surfaces[value]?.material ?? undefined
}

/** `magnet` -> `Magnet`. */
export const surfaceLabel = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)
