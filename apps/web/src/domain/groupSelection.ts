/**
 * What a click reaches in a tree of groups, and which groups a selection makes up. The selection itself stays a list of
 * item keys, so everything that acts on it works on groups unchanged (docs/DESKTOP.md § Groups and selection).
 */
import type { GroupNode, TreeNode } from "./MapSidecar"
import { findGroup, findNode, idOf, type NumberedName, treeKeys, wholeNodes } from "./structure"

/** The groups a node is in, outermost first; empty at the root and for a node that isn't in the tree. */
export const groupPathOf = (tree: ReadonlyArray<TreeNode>, id: string): ReadonlyArray<string> =>
  findNode(tree, id)?.path.map((group) => group.id) ?? []

/** The item keys a node stands for: an item's own, or every one under a group. */
export const nodeKeys = (tree: ReadonlyArray<TreeNode>, id: string): ReadonlyArray<string> => {
  const node = findNode(tree, id)?.node
  return node === undefined ? [] : treeKeys([node])
}

/** The entered group and the groups around it: from inside, none of them is a thing to select. */
export const enteredScopeOf = (
  tree: ReadonlyArray<TreeNode>,
  enteredGroupId: string | null
): ReadonlyArray<string> => enteredGroupId === null ? [] : [...groupPathOf(tree, enteredGroupId), enteredGroupId]

/** Every item in the tree, or in the entered group: what a box or lasso looks at, before hidden and locked ones leave. */
export const selectableKeys = (
  tree: ReadonlyArray<TreeNode>,
  enteredGroupId: string | null
): ReadonlyArray<string> => enteredGroupId === null ? treeKeys(tree) : nodeKeys(tree, enteredGroupId)

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
  const scope = enteredScopeOf(tree, enteredGroupId)
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

/** The nodes the selected items make up, in tree order. Inside the entered group, all of it selected is its members. */
export const selectedNodes = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): ReadonlyArray<TreeNode> => {
  const scope = enteredScopeOf(tree, enteredGroupId)
  const opened = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<TreeNode> =>
    nodes.flatMap((node) => node.kind === "group" && scope.includes(node.id) ? opened(node.children) : [node])
  return opened(wholeNodes(tree, new Set(selectedIds)))
}

/** What grouping or dragging a selection moves: the nodes it makes up. */
export const selectionNodeIds = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): ReadonlyArray<string> => selectedNodes(tree, selectedIds, enteredGroupId).map(idOf)

/** The groups among the nodes the selected items make up: what Ungroup dissolves. */
export const selectedGroupIds = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): ReadonlyArray<string> =>
  selectedNodes(tree, selectedIds, enteredGroupId).flatMap((node) => node.kind === "group" ? node.id : [])

/** The group the selection is exactly, if it is: the one case where the game's gizmo sits on a group's frame. */
export const soleGroupOf = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): GroupNode | undefined => {
  const [first, second] = selectedNodes(tree, selectedIds, enteredGroupId)
  return first?.kind === "group" && second === undefined ? first : undefined
}

/** "1 group", "2 groups". */
export const counted = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`

/**
 * What the status bar says of a selection, null when it's empty. A lone item or whole group is named from `names`, which
 * has the items' by key and the groups' by id; several whole groups are counted ("2 groups"); anything else says how many
 * items it has and how many groups are among them ("3 items · 1 group").
 */
export const selectionSummaryOf = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null,
  names: ReadonlyMap<string, NumberedName>
): NumberedName | null => {
  if (selectedIds.length === 0) return null
  const nodes = selectedNodes(tree, selectedIds, enteredGroupId)
  const groups = nodes.filter((node) => node.kind === "group")
  const [only] = nodes
  const lone = nodes.length !== 1 || only === undefined ? undefined : names.get(idOf(only))
  if (lone !== undefined) return lone
  if (groups.length > 0 && groups.length === nodes.length) {
    return { name: counted(groups.length, "group"), ordinal: undefined }
  }
  const items = counted(selectedIds.length, "item")
  return { name: groups.length === 0 ? items : `${items} · ${counted(groups.length, "group")}`, ordinal: undefined }
}

/** A group drawn as a box in the viewport. `entered` is the quiet one, standing for the group clicks are inside. */
export interface GroupBoxTarget {
  readonly id: string
  readonly keys: ReadonlyArray<string>
  readonly entered: boolean
}

/** The groups the viewport boxes: every one whole in the selection, and the entered group, selected or not. */
export const groupBoxTargets = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): ReadonlyArray<GroupBoxTarget> => {
  const selected = selectedGroupIds(tree, selectedIds, enteredGroupId)
  const quiet = enteredGroupId === null ? [] : [enteredGroupId]
  return [
    ...selected.map((id) => ({ id, keys: nodeKeys(tree, id), entered: false })),
    ...quiet.map((id) => ({ id, keys: nodeKeys(tree, id), entered: true }))
  ]
}

/** Whether grouping the selection would change anything: one whole group is a group already. */
export const canGroupSelection = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): boolean => {
  const [first, ...others] = selectedNodes(tree, selectedIds, enteredGroupId)
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

/** Item pivot presets apply only when every selected unit is an item. Enter a group to edit its members. */
export const canSetItemPivots = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): boolean => {
  const nodes = selectedNodes(tree, selectedIds, enteredGroupId)
  return nodes.length > 0 && nodes.every((node) => node.kind === "item")
}

/**
 * A selection counted by what it's made of, when that holds a group among other things: "1 group and 2 items", as the
 * gizmo takes them. Undefined when every unit is an item, where a count of items already says it.
 */
export const unitSummaryOf = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): string | undefined => {
  const nodes = selectedNodes(tree, selectedIds, enteredGroupId)
  const groups = nodes.filter((node) => node.kind === "group").length
  const items = nodes.length - groups
  if (groups === 0 || nodes.length < 2) return undefined
  return items === 0 ? counted(groups, "group") : `${counted(groups, "group")} and ${counted(items, "item")}`
}
