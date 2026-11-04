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
 * What the game checks in `editorState`. Any of these makes it discard the whole map and open a blank one, without a
 * message; each was opened in the game on 0.4.1 (docs/qa/save-roundtrip.md).
 */
const editorStateProblems = (map: MapFile): Array<string> => {
  if (map.editorState === undefined) return []
  const out: Array<string> = []
  const inMap = (index: number) => index >= 0 && index < map.items.length
  for (const { itemIndex } of map.editorState.pivots) {
    if (!inMap(itemIndex)) out.push(`A pivot belongs to item ${itemIndex}, which isn't in the map.`)
  }
  const grouped = new Set<number>()
  map.editorState.groups.forEach((group, index) => {
    if (group.members.length === 0) out.push(`Group ${index} is empty.`)
    if (group.frame === undefined) out.push(`Group ${index} has no frame.`)
    for (const member of group.members) {
      if (!inMap(member)) out.push(`Group ${index} has item ${member}, which isn't in the map.`)
      if (grouped.has(member)) out.push(`Item ${member} is in two groups.`)
      grouped.add(member)
    }
  })
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
  out.push(...editorStateProblems(map))
  if (map.items.length > LIMITS.itemsPerLevel) {
    out.push(`The map has ${map.items.length} items (maximum ${LIMITS.itemsPerLevel}).`)
  }
  map.items.forEach((item, index) => out.push(...itemProblems(item, index)))
  return out
}
