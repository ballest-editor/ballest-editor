/**
 * What the game's loader rejects (docs/FORMAT.md, "Hard limits" and "Load-time validation").
 * One bad item makes the game discard the whole map, so exports are checked up front.
 */
import { isPlayerStart, type Item, type MapFile } from "./MapFile"

/** Constants recovered from the shipping exe (build 0.4.0-playtest). */
export const LIMITS = {
  itemsPerLevel: 100_000,
  meshComponentsPerItem: 64,
  propertiesPerList: 4096
} as const

/** UE's THRESH_QUAT_NORMALIZED: |1 - |q|^2| must be below this. */
const QUAT_NORMALIZED_THRESHOLD = 0.01

const PROPERTY_LISTS = [
  "boolProperties",
  "floatProperties",
  "intProperties",
  "textProperties",
  "nameProperties",
  "stringProperties"
] as const

export const isNormalizedRotation = (
  q: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
): boolean => Math.abs(1 - (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)) < QUAT_NORMALIZED_THRESHOLD

const itemProblems = (item: Item, index: number): Array<string> => {
  const out: Array<string> = []
  if (!isNormalizedRotation(item.itemTransform.rotation)) out.push(`Item ${index} has a non-normalized rotation.`)
  if (item.meshComponents.length > LIMITS.meshComponentsPerItem) {
    out.push(
      `Item ${index} has ${item.meshComponents.length} mesh components (maximum ${LIMITS.meshComponentsPerItem}).`
    )
  }
  for (const list of PROPERTY_LISTS) {
    if (item[list].length > LIMITS.propertiesPerList) {
      out.push(`Item ${index} has ${item[list].length} ${list} (maximum ${LIMITS.propertiesPerList}).`)
    }
  }
  return out
}

/**
 * Everything that would make the game reject `map`, as user-facing sentences; empty when
 * the map is loadable. Finite transforms are already guaranteed by the schema.
 */
export const gameLoadProblems = (map: MapFile): ReadonlyArray<string> => {
  const out: Array<string> = []
  const playerStarts = map.items.filter(isPlayerStart).length
  if (playerStarts !== 1) out.push(`The game needs exactly one MP_PlayerStart; this map has ${playerStarts}.`)
  if (map.items.length > LIMITS.itemsPerLevel) {
    out.push(`The map has ${map.items.length} items (maximum ${LIMITS.itemsPerLevel}).`)
  }
  map.items.forEach((item, index) => out.push(...itemProblems(item, index)))
  return out
}
