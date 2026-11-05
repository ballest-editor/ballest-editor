/**
 * What a click reaches in a tree of groups, and which groups a selection makes up. The selection itself stays a list of
 * item keys, so everything that acts on it works on groups unchanged (docs/DESKTOP.md § Groups and selection).
 */
import type { TreeNode } from "./MapSidecar"
import { findGroup, findNode, idOf, treeKeys, wholeNodes } from "./structure"

/** The groups a node is in, outermost first; empty at the root and for a node that isn't in the tree. */
export const groupPathOf = (tree: ReadonlyArray<TreeNode>, id: string): ReadonlyArray<string> =>
  findNode(tree, id)?.path.map((group) => group.id) ?? []

/** The item keys a node stands for: an item's own, or every one under a group. */
export const nodeKeys = (tree: ReadonlyArray<TreeNode>, id: string): ReadonlyArray<string> => {
  const node = findNode(tree, id)?.node
  return node === undefined ? [] : treeKeys([node])
}

/** Where a click on an item lands. */
export interface ClickLevel {
  /** The node it selects: the item, or the group of it that is one level inside `enteredGroupId`. */
  readonly nodeId: string
  /** The entered group the click leaves in place: the deepest of the old one and its parents that holds the item. */
  readonly enteredGroupId: string | null
}

/**
 * Outside any entered group a click reaches the item's outermost group, as in the game. Inside one it reaches that
 * group's children, and an item outside it is reached from the nearest parent group that holds it.
 */
export const clickLevelOf = (
  tree: ReadonlyArray<TreeNode>,
  key: string,
  enteredGroupId: string | null
): ClickLevel => {
  const path = groupPathOf(tree, key)
  const scope = enteredGroupId === null ? [] : [...groupPathOf(tree, enteredGroupId), enteredGroupId]
  let depth = 0
  while (depth < scope.length && path[depth] === scope[depth]) depth++
  return { nodeId: path[depth] ?? key, enteredGroupId: path[depth - 1] ?? null }
}

/**
 * A double-click on an item: enters the group a click on it reaches, and lands on that group's child on the way to the
 * item. Undefined when a click reaches the item itself, so there's no group left to enter.
 */
export const enteredLevelOf = (
  tree: ReadonlyArray<TreeNode>,
  key: string,
  enteredGroupId: string | null
): ClickLevel | undefined => {
  const { nodeId } = clickLevelOf(tree, key, enteredGroupId)
  return nodeId === key ? undefined : clickLevelOf(tree, key, nodeId)
}

/** The nodes the selected items make up, in tree order: what grouping or dragging a selection moves. */
export const selectionNodeIds = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>
): ReadonlyArray<string> => wholeNodes(tree, new Set(selectedIds)).map(idOf)

/** The groups among the nodes the selected items make up: what Ungroup dissolves. */
export const selectedGroupIds = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>
): ReadonlyArray<string> =>
  wholeNodes(tree, new Set(selectedIds)).flatMap((node) => node.kind === "group" ? node.id : [])

/** Whether grouping the selection would change anything: one whole group is a group already. */
export const canGroupSelection = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>
): boolean => {
  const [first, ...others] = wholeNodes(tree, new Set(selectedIds))
  return first !== undefined && (others.length > 0 || first.kind === "item")
}

/**
 * The group the selection is exactly, if any: its items and no others. Of nested groups holding the same items it is
 * the outermost one inside the entered group, as a click would have picked.
 */
export const exactSelectedGroup = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
) => {
  const [first] = selectedIds
  if (first === undefined) return undefined
  const selected = new Set(selectedIds)
  const path = findNode(tree, first)?.path ?? []
  const below = path.findIndex((group) => group.id === enteredGroupId) + 1
  return path.slice(below).find((group) => {
    const keys = treeKeys([group])
    return keys.length === selected.size && keys.every((key) => selected.has(key))
  })
}

/** How much of each group is selected; a group with nothing selected has no entry. */
export const groupSelectionStates = (
  tree: ReadonlyArray<TreeNode>,
  selected: ReadonlySet<string>
): ReadonlyMap<string, "all" | "some"> => {
  const states = new Map<string, "all" | "some">()
  /** Counts the items under `nodes`, and how many of them are selected. */
  const visit = (nodes: ReadonlyArray<TreeNode>): readonly [number, number] => {
    let items = 0
    let chosen = 0
    for (const node of nodes) {
      const [inside, picked] = node.kind === "item"
        ? [1, selected.has(node.key) ? 1 : 0] as const
        : visit(node.children)
      items += inside
      chosen += picked
      if (node.kind === "group" && picked > 0) states.set(node.id, picked === inside ? "all" : "some")
    }
    return [items, chosen]
  }
  visit(tree)
  return states
}

/**
 * The node standing for the active (last) selected item, and the groups around it that must be open to show it: the
 * outermost whole group it is in, else the item.
 */
export const activeNodeOf = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>
): { readonly id: string; readonly parents: ReadonlyArray<string> } | undefined => {
  const active = selectedIds.at(-1)
  if (active === undefined) return undefined
  const found = findNode(tree, active)
  if (found === undefined) return undefined
  const selected = new Set(selectedIds)
  const whole = found.path.findIndex((group) => treeKeys([group]).every((key) => selected.has(key)))
  const ids = found.path.map((group) => group.id)
  return whole < 0 ? { id: active, parents: ids } : { id: ids[whole] ?? active, parents: ids.slice(0, whole) }
}

/** The groups from the root down to `groupId`, for showing where the entered group is. */
export const groupTrail = (tree: ReadonlyArray<TreeNode>, groupId: string | null) => {
  const group = groupId === null ? undefined : findGroup(tree, groupId)
  return group === undefined ? [] : [...findNode(tree, group.id)?.path ?? [], group]
}
