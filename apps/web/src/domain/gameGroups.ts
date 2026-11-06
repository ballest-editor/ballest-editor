/**
 * Between the structure tree and the game's flat `editorState.groups` (docs/FORMAT.md § Groups). The game holds an item
 * in at most one group and no group inside another, so only the outermost tree groups reach it.
 */
import type { CatalogIndex } from "./Catalog"
import { defaultEditorState, identityTransform } from "./factory"
import { boxCentreOf, itemsBoxOf } from "./itemBounds"
import type { EditorGroup, MapFile } from "./MapFile"
import type { GroupNode, TreeNode } from "./MapSidecar"
import { DEFAULT_GROUP_NAME, freshKey, itemNode, type Structure, treeKeys } from "./structure"

/** A group's name as the game takes it: letters and digits, at most 64 of them; empty when none are left. */
export const gameGroupNameOf = (name: string): string => name.replace(/[^A-Za-z0-9]/g, "").slice(0, 64)

/**
 * `map` as the game gets it: its `editorState.groups` made from `tree`, one for each outermost group with an item
 * anywhere under it. A group's `frame` is what Ctrl+G makes, no turn or scale, at the centre of the box around the
 * members' bounds; only that a frame is there is known to matter in the game. A map with no groups either way stays as
 * it is.
 */
export const withGameGroups = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  tree: ReadonlyArray<TreeNode>,
  catalog: CatalogIndex | null
): MapFile => {
  const indexOf = new Map(ids.map((key, index) => [key, index]))
  const groups = tree.flatMap((node): ReadonlyArray<EditorGroup> => {
    if (node.kind !== "group") return []
    const members = treeKeys(node.children).flatMap((key) => indexOf.get(key) ?? []).sort((a, b) => a - b)
    if (members.length === 0) return []
    const box = itemsBoxOf(members.flatMap((index) => map.items[index] ?? []), catalog)
    return [{
      members,
      name: gameGroupNameOf(node.prefab?.name ?? node.name),
      frame: identityTransform(box === undefined ? undefined : boxCentreOf(box))
    }]
  })
  if (groups.length === 0 && (map.editorState?.groups.length ?? 0) === 0) return map
  return { ...map, editorState: { ...map.editorState ?? defaultEditorState(), groups } }
}

/**
 * The structure of a map with no sidecar: its items loose in document order, with each game group one tree group where
 * its first member is. Members the game would refuse (past the items, or in an earlier group) are left out of it.
 */
export const structureFromGame = (map: MapFile, keys: ReadonlyArray<string>): Structure => {
  const grouped = new Set<number>()
  const groupAt = new Map<number, GroupNode>()
  for (const { members, name } of map.editorState?.groups ?? []) {
    const own = [...new Set(members)].filter((member) => keys[member] !== undefined && !grouped.has(member))
    if (own.length === 0) continue
    for (const member of own) grouped.add(member)
    groupAt.set(own.reduce((first, member) => Math.min(first, member)), {
      kind: "group",
      id: freshKey(),
      name: name || DEFAULT_GROUP_NAME,
      tags: [],
      children: own.flatMap((member) => keys[member] ?? []).map(itemNode)
    })
  }
  const tree = keys.flatMap((key, index): TreeNode | ReadonlyArray<TreeNode> =>
    groupAt.get(index) ?? (grouped.has(index) ? [] : itemNode(key))
  )
  return { tree, items: new Map() }
}
