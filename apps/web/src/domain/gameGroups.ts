/**
 * Between the structure tree and the game's flat `editorState.groups` (docs/FORMAT.md § Groups). The game holds an item
 * in at most one group and no group inside another, so only the outermost tree groups reach it.
 */
import { defaultEditorState, identityTransform } from "./factory"
import type { EditorGroup, Item, ItemTransform, MapFile } from "./MapFile"
import type { GroupNode, TreeNode } from "./MapSidecar"
import { DEFAULT_GROUP_NAME, freshKey, itemNode, type Structure, treeKeys } from "./structure"

const NAME_LENGTH = 64

/** A group's name as the game takes it: letters and digits, at most 64 of them; empty when none are left. */
export const gameGroupNameOf = (name: string): string => name.replace(/[^A-Za-z0-9]/g, "").slice(0, NAME_LENGTH)

const middleOf = (items: ReadonlyArray<Item>, axis: "x" | "y" | "z"): number => {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const item of items) {
    low = Math.min(low, item.itemTransform.translation[axis])
    high = Math.max(high, item.itemTransform.translation[axis])
  }
  return (low + high) / 2
}

/**
 * A game group's `frame`, the one place it is worked out: no turn or scale, at the centre of the box around the
 * members' positions. Only that a frame is there is known to matter in the game.
 */
const groupFrame = (members: ReadonlyArray<Item>): ItemTransform =>
  identityTransform({ x: middleOf(members, "x"), y: middleOf(members, "y"), z: middleOf(members, "z") })

/** The game's groups for `tree`: one for each outermost group with an item anywhere under it. */
export const gameGroupsOf = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  tree: ReadonlyArray<TreeNode>
): ReadonlyArray<EditorGroup> => {
  const indexOf = new Map(ids.map((key, index) => [key, index]))
  return tree.flatMap((node) => {
    if (node.kind !== "group") return []
    const members = treeKeys(node.children).flatMap((key) => indexOf.get(key) ?? []).sort((a, b) => a - b)
    return members.length === 0
      ? []
      : [{
        members,
        name: gameGroupNameOf(node.name),
        frame: groupFrame(members.flatMap((index) => map.items[index] ?? []))
      }]
  })
}

/** `map` as the game gets it: its `editorState.groups` made from `tree`. A map with no groups either way stays as it is. */
export const withGameGroups = (map: MapFile, ids: ReadonlyArray<string>, tree: ReadonlyArray<TreeNode>): MapFile => {
  const groups = gameGroupsOf(map, ids, tree)
  if (groups.length === 0 && (map.editorState?.groups.length ?? 0) === 0) return map
  return { ...map, editorState: { ...map.editorState ?? defaultEditorState(), groups } }
}

/**
 * The structure of a map with no sidecar: its items loose in document order, with each game group one tree group where
 * its first member is. Members the game would refuse (past the items, or in an earlier group) are left out of it.
 */
export const structureFromGame = (map: MapFile, keys: ReadonlyArray<string>): Structure => {
  const groupAt = new Map<number, number>()
  const members = (map.editorState?.groups ?? []).map((group, n) =>
    [...new Set(group.members)].flatMap((member) => {
      const key = keys[member]
      if (key === undefined || groupAt.has(member)) return []
      groupAt.set(member, n)
      return [key]
    })
  )
  const placed = new Set<number>()
  const groupNode = (n: number): GroupNode => ({
    kind: "group",
    id: freshKey(),
    name: map.editorState?.groups[n]?.name || DEFAULT_GROUP_NAME,
    tags: [],
    children: (members[n] ?? []).map(itemNode)
  })
  const tree = keys.flatMap((key, index): ReadonlyArray<TreeNode> => {
    const n = groupAt.get(index)
    if (n === undefined) return [itemNode(key)]
    if (placed.has(n)) return []
    placed.add(n)
    return [groupNode(n)]
  })
  return { tree, items: new Map() }
}
