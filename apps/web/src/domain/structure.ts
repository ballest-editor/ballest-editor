/**
 * A map's structure: the tree of groups and items, and each item's name and tags. It lives in the sidecar, not in the
 * game's file (docs/PROJECTS.md § The files). Pure functions, like `edits.ts`: an edit that changes nothing answers
 * undefined, so the store leaves no undo step for it. An item's key is its entry in the store's `ids`.
 */
import { type CatalogIndex, pieceLabelOf } from "./Catalog"
import { classNameOf, type MapFile } from "./MapFile"
import type { GroupNode, ItemNode, TreeNode } from "./MapSidecar"

/** What an item has beyond the game's data. An item with neither has no entry. */
export interface ItemMeta {
  readonly name?: string
  readonly tags?: ReadonlyArray<string>
}

export interface Structure {
  readonly tree: ReadonlyArray<TreeNode>
  readonly items: ReadonlyMap<string, ItemMeta>
}

/** 72 random bits, as 12 URL-safe characters. */
export const freshKey = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replaceAll("+", "-").replaceAll("/", "_")

export const freshKeys = (n: number): ReadonlyArray<string> => Array.from({ length: n }, freshKey)

export const itemNode = (key: string): ItemNode => ({ kind: "item", key })

/** Items loose at the root, nothing else. */
export const flatStructure = (keys: ReadonlyArray<string>): Structure => ({
  tree: keys.map(itemNode),
  items: new Map()
})

const idOf = (node: TreeNode): string => node.kind === "item" ? node.key : node.id

/** The item keys under `nodes`, depth first. */
export const treeKeys = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<string> =>
  nodes.flatMap((node) => node.kind === "item" ? [node.key] : treeKeys(node.children))

interface FoundNode {
  readonly node: TreeNode
  /** The groups it is in, outermost first. */
  readonly path: ReadonlyArray<GroupNode>
  /** Its place among its siblings. */
  readonly index: number
}

const findNode = (
  nodes: ReadonlyArray<TreeNode>,
  id: string,
  path: ReadonlyArray<GroupNode> = []
): FoundNode | undefined => {
  for (const [index, node] of nodes.entries()) {
    if (idOf(node) === id) return { node, path, index }
    if (node.kind === "group") {
      const found = findNode(node.children, id, [...path, node])
      if (found !== undefined) return found
    }
  }
  return undefined
}

const findGroup = (nodes: ReadonlyArray<TreeNode>, id: string): GroupNode | undefined => {
  const found = findNode(nodes, id)?.node
  return found?.kind === "group" ? found : undefined
}

/**
 * `nodes` with each node swapped for what `replace` gives, children before their group (what `replace` gives isn't
 * visited again). A group that loses its last child goes too, like a game group left empty (`removeItems`); one that
 * was empty already stays.
 */
export const rewriteTree = (
  nodes: ReadonlyArray<TreeNode>,
  replace: (node: TreeNode) => ReadonlyArray<TreeNode>
): ReadonlyArray<TreeNode> =>
  nodes.flatMap((node) => {
    if (node.kind === "item") return replace(node)
    const children = rewriteTree(node.children, replace)
    return children.length === 0 && node.children.length > 0 ? [] : replace({ ...node, children })
  })

/** Adds new items, loose at the end of the root. */
export const withNewItems = (structure: Structure, keys: ReadonlyArray<string>): Structure => ({
  ...structure,
  tree: [...structure.tree, ...keys.map(itemNode)]
})

/** Drops items from the tree and their names and tags. */
export const withoutKeys = (structure: Structure, keys: ReadonlySet<string>): Structure => ({
  tree: rewriteTree(structure.tree, (node) => node.kind === "item" && keys.has(node.key) ? [] : [node]),
  items: new Map([...structure.items].filter(([key]) => !keys.has(key)))
})

const withMeta = (structure: Structure, key: string, meta: ItemMeta): Structure => {
  const items = new Map(structure.items)
  if (meta.name === undefined && meta.tags === undefined) items.delete(key)
  else items.set(key, meta)
  return { ...structure, items }
}

/** An item's user name: `name`, trimmed; null (or nothing left) clears it. */
export const withItemName = (structure: Structure, key: string, name: string | null): Structure | undefined => {
  if (findNode(structure.tree, key)?.node.kind !== "item") return undefined
  const trimmed = name?.trim() ?? ""
  const { name: current, tags } = structure.items.get(key) ?? {}
  if (trimmed === (current ?? "")) return undefined
  return withMeta(structure, key, {
    ...(trimmed.length > 0 && { name: trimmed }),
    ...(tags !== undefined && { tags })
  })
}

const withGroupNode = (structure: Structure, id: string, change: (group: GroupNode) => GroupNode): Structure => ({
  ...structure,
  tree: rewriteTree(structure.tree, (node) => node.kind === "group" && node.id === id ? [change(node)] : [node])
})

/** A group's name, trimmed; a group always has one, so a blank name changes nothing. */
export const withGroupName = (structure: Structure, id: string, name: string): Structure | undefined => {
  const trimmed = name.trim()
  const group = findGroup(structure.tree, id)
  if (group === undefined || trimmed.length === 0 || trimmed === group.name) return undefined
  return withGroupNode(structure, id, (node) => ({ ...node, name: trimmed }))
}

const sameTags = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((tag, i) => tag === b[i])

/** The tags of the item or group `target`: free strings, trimmed, each once, in the order given. */
export const withTags = (structure: Structure, target: string, tags: ReadonlyArray<string>): Structure | undefined => {
  const node = findNode(structure.tree, target)?.node
  if (node === undefined) return undefined
  const clean = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
  if (node.kind === "group") {
    return sameTags(clean, node.tags) ? undefined : withGroupNode(structure, target, (group) => ({
      ...group,
      tags: clean
    }))
  }
  const { name, tags: current = [] } = structure.items.get(target) ?? {}
  if (sameTags(clean, current)) return undefined
  return withMeta(structure, target, {
    ...(name !== undefined && { name }),
    ...(clean.length > 0 && { tags: clean })
  })
}

/** `Group N` for the lowest N no group in `tree` is called. */
export const nextGroupName = (tree: ReadonlyArray<TreeNode>): string => {
  const taken = new Set<string>()
  const collect = (nodes: ReadonlyArray<TreeNode>) => {
    for (const node of nodes) {
      if (node.kind === "group") {
        taken.add(node.name)
        collect(node.children)
      }
    }
  }
  collect(tree)
  for (let n = 1;; n++) {
    const name = `Group ${n}`
    if (!taken.has(name)) return name
  }
}

/**
 * Groups the items `keys`, in that order, as a new group `id` where the first key's node was. Keys in other groups are
 * pulled out of them. Undefined when none of `keys` is an item in the tree.
 */
export const withGroup = (
  structure: Structure,
  keys: ReadonlyArray<string>,
  id: string,
  name?: string
): Structure | undefined => {
  const [first, ...others] = [...new Set(keys)].filter((key) => findNode(structure.tree, key)?.node.kind === "item")
  if (first === undefined) return undefined
  const group: GroupNode = {
    kind: "group",
    id,
    name: name?.trim() || nextGroupName(structure.tree),
    tags: [],
    children: [first, ...others].map(itemNode)
  }
  const pulled = new Set(others)
  const tree = rewriteTree(structure.tree, (node) => {
    if (node.kind !== "item") return [node]
    return node.key === first ? [group] : pulled.has(node.key) ? [] : [node]
  })
  return { ...structure, tree }
}

/** Dissolves a group: its children take its place in its parent. */
export const withoutGroup = (structure: Structure, id: string): Structure | undefined =>
  findGroup(structure.tree, id) === undefined ? undefined : {
    ...structure,
    tree: rewriteTree(structure.tree, (node) => node.kind === "group" && node.id === id ? node.children : [node])
  }

/** `nodes` with `edit` applied to the children of group `parentId`, or to `nodes` itself for null. */
const editChildren = (
  nodes: ReadonlyArray<TreeNode>,
  parentId: string | null,
  edit: (children: ReadonlyArray<TreeNode>) => ReadonlyArray<TreeNode>
): ReadonlyArray<TreeNode> =>
  parentId === null ? edit(nodes) : nodes.map((node) => {
    if (node.kind !== "group") return node
    return {
      ...node,
      children: node.id === parentId ? edit(node.children) : editChildren(node.children, parentId, edit)
    }
  })

/**
 * Moves a node to position `index` (clamped) among `parentId`'s children once it has left them; null is the root. A
 * group can't go into itself. A group the move leaves empty goes too.
 */
export const withMovedNode = (
  structure: Structure,
  nodeId: string,
  parentId: string | null,
  index: number
): Structure | undefined => {
  const found = findNode(structure.tree, nodeId)
  if (found === undefined) return undefined
  if (parentId !== null) {
    const insideItself = findNode([found.node], parentId) !== undefined
    if (insideItself || findGroup(structure.tree, parentId) === undefined) return undefined
  }
  const from = found.path.at(-1)?.id ?? null
  const siblings = from === null ? structure.tree : found.path.at(-1)?.children ?? []
  if (from === parentId && Math.max(0, Math.min(index, siblings.length - 1)) === found.index) return undefined
  const without = (nodes: ReadonlyArray<TreeNode>) => nodes.filter((node) => idOf(node) !== nodeId)
  const moved = editChildren(editChildren(structure.tree, from, without), parentId, (children) => {
    const at = Math.max(0, Math.min(index, children.length))
    return [...children.slice(0, at), found.node, ...children.slice(at)]
  })
  const left = new Set(found.path.map((group) => group.id))
  return {
    ...structure,
    tree: rewriteTree(
      moved,
      (node) => node.kind === "group" && node.children.length === 0 && left.has(node.id) ? [] : [node]
    )
  }
}

/** Whether every item under `group` is in `keys`, and it has one. */
const isWhole = (group: GroupNode, keys: ReadonlySet<string>) => {
  const inside = treeKeys([group])
  return inside.length > 0 && inside.every((key) => keys.has(key))
}

const copiedNodes = (nodes: ReadonlyArray<TreeNode>, keys: ReadonlySet<string>): ReadonlyArray<TreeNode> =>
  nodes.flatMap((node) => {
    if (node.kind === "item") return keys.has(node.key) ? [node] : []
    return isWhole(node, keys) ? [node] : copiedNodes(node.children, keys)
  })

/**
 * The structure of the items `keys`, for a clip: a group with all its items among them is kept whole, and the others
 * leave their copied items loose. It holds the source keys and ids until `withPasted`.
 */
export const copyStructure = (structure: Structure, keys: ReadonlySet<string>): Structure => ({
  tree: copiedNodes(structure.tree, keys),
  items: new Map([...structure.items].filter(([key]) => keys.has(key)))
})

/**
 * Adds a clip's items to `structure`, under the new keys `keyOf` gives for their source keys, keeping their names and
 * tags. A copied node lands right after its source if the tree still has it, which puts a copied item in the same group
 * as its source; else at the end of the root. A group's copy is a new group of the same name and shape.
 */
export const withPasted = (
  structure: Structure,
  clip: Structure,
  keyOf: ReadonlyMap<string, string>,
  freshId: () => string = freshKey
): Structure => {
  const copyOf = (node: TreeNode): ReadonlyArray<TreeNode> => {
    if (node.kind === "group") return [{ ...node, id: freshId(), children: node.children.flatMap(copyOf) }]
    const key = keyOf.get(node.key)
    return key === undefined ? [] : [itemNode(key)]
  }
  const waiting = new Map(clip.tree.map((node) => [idOf(node), copyOf(node)]))
  const tree = rewriteTree(structure.tree, (node) => {
    const copy = waiting.get(idOf(node))
    if (copy === undefined) return [node]
    waiting.delete(idOf(node))
    return [node, ...copy]
  })
  const items = new Map(structure.items)
  for (const [source, meta] of clip.items) {
    const key = keyOf.get(source)
    if (key !== undefined) items.set(key, meta)
  }
  return { tree: [...tree, ...[...waiting.values()].flat()], items }
}

/**
 * Every item's display name, by key: the user's, else the catalog's name for its class (the class's own without a
 * catalog) and an ordinal among the items of that class, in document order ("Cube 3").
 */
export const itemDisplayNames = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  items: Structure["items"],
  catalog: CatalogIndex | null
): ReadonlyMap<string, string> => {
  const counts = new Map<string, number>()
  return new Map(ids.flatMap((key, index) => {
    const item = map.items[index]
    if (item === undefined) return []
    const piece = catalog?.pieceByClass.get(item.actorToSpawn)
    const ordinal = (counts.get(item.actorToSpawn) ?? 0) + 1
    counts.set(item.actorToSpawn, ordinal)
    const label = piece === undefined ? classNameOf(item.actorToSpawn) : pieceLabelOf(piece)
    return [[key, items.get(key)?.name ?? `${label} ${ordinal}`] as const]
  }))
}
