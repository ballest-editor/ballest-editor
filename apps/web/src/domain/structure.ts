/**
 * A map's structure: the tree of groups and items, and each item's name and tags. It lives in the sidecar, not in the
 * game's file (docs/PROJECTS.md § The files). Pure functions, like `edits.ts`: an edit that changes nothing answers
 * undefined, so the store leaves no undo step for it. An item's key is its entry in the store's `ids`.
 */
import type { CatalogIndex } from "./Catalog"
import type { ConnectAt, SpotId } from "./connectorSpots"
import { classNameOf, type Item, type MapFile } from "./MapFile"
import type { Annotations, ChainGrowth, GroupNode, GroupPivot, ItemNode, PrefabLink, TreeNode } from "./MapSidecar"
import { pieceLabelOf } from "./pieceName"

/** What an item has beyond the game's data. An item with none of it has no entry. */
export interface ItemMeta {
  readonly name?: string
  readonly tags?: ReadonlyArray<string>
  /** Where its ends connect, when not where they were measured (docs/SNAPPING.md § Connectors). */
  readonly connectAt?: ConnectAt
  /** Hidden: not drawn, picked or snapped to (docs/DESKTOP.md § Hide, isolate and lock). */
  readonly hidden?: true
  /** Locked: drawn and snapped to, but not picked in the viewport. */
  readonly locked?: true
}

export interface Structure {
  readonly tree: ReadonlyArray<TreeNode>
  readonly items: ReadonlyMap<string, ItemMeta>
  /** Joints, construction geometry and measurements (docs/SNAPPING.md); undoable with the rest. Absent with none. */
  readonly annotations?: Annotations
}

/** A document, as the store and the sidecar hold it. */
export interface Doc {
  readonly map: MapFile
  /** Each item's stable key, in `map.items`' order. The sidecar keeps them across saves and loads. */
  readonly ids: ReadonlyArray<string>
  /** The groups and each item's name and tags, by those keys (docs/PROJECTS.md § Source of truth). */
  readonly structure: Structure
}

/** Each key's place in `ids`, kept per array: a selection, an edit or a drag can be of thousands of items. */
const keyIndices = new WeakMap<ReadonlyArray<string>, ReadonlyMap<string, number>>()

const keyIndicesOf = (ids: ReadonlyArray<string>): ReadonlyMap<string, number> => {
  const known = keyIndices.get(ids)
  if (known !== undefined) return known
  const indices = new Map(ids.map((id, i) => [id, i] as const))
  keyIndices.set(ids, indices)
  return indices
}

/** An item's place in `ids`; -1 for a key that isn't there. */
export const indexOfKey = (ids: ReadonlyArray<string>, key: string): number => keyIndicesOf(ids).get(key) ?? -1

/** 72 random bits, as 12 URL-safe characters. */
export const freshKey = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replaceAll("+", "-").replaceAll("/", "_")

export const freshKeys = (n: number): ReadonlyArray<string> => Array.from({ length: n }, freshKey)

const NO_ANNOTATIONS: Annotations = { joints: [], construction: [], measurements: [] }

/** A structure's annotations, empty when it has none. */
export const annotationsOf = (structure: Structure): Annotations => structure.annotations ?? NO_ANNOTATIONS

/** `structure` with `annotations`, or without any when they hold nothing. */
export const withAnnotations = (structure: Structure, annotations: Annotations): Structure => {
  const { annotations: _gone, ...rest } = structure
  const empty = annotations.joints.length + annotations.construction.length + annotations.measurements.length === 0
  return empty ? rest : { ...rest, annotations }
}

/** `structure` with no joint that touches `keys`. */
export const withoutJointsOf = (structure: Structure, keys: ReadonlySet<string>): Structure => {
  const annotations = annotationsOf(structure)
  const joints = annotations.joints.filter(({ a, b }) => !keys.has(a.item) && !keys.has(b.item))
  return joints.length === annotations.joints.length
    ? structure
    : withAnnotations(structure, { ...annotations, joints })
}

export const itemNode = (key: string): ItemNode => ({ kind: "item", key })

export const flatStructure = (keys: ReadonlyArray<string>): Structure => ({
  tree: keys.map(itemNode),
  items: new Map()
})

export const idOf = (node: TreeNode): string => node.kind === "item" ? node.key : node.id

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

export const findNode = (
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

export const findGroup = (nodes: ReadonlyArray<TreeNode>, id: string): GroupNode | undefined => {
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

/**
 * `tree` with every Item pivot whose member has left its group back at the Centre (`GroupPivot`): the pivot names a
 * member, so it goes when the member does, and a member that comes back doesn't bring it back unasked.
 */
const withoutStalePivots = (tree: ReadonlyArray<TreeNode>): ReadonlyArray<TreeNode> =>
  rewriteTree(tree, (node) => {
    if (node.kind !== "group" || node.pivot?.choice !== "item" || treeKeys([node]).includes(node.pivot.key)) {
      return [node]
    }
    const { pivot: _gone, ...centred } = node
    return [centred]
  })

/** Drops items from the tree, their names and tags, and the joints they were part of. */
export const withoutKeys = (structure: Structure, keys: ReadonlySet<string>): Structure => ({
  ...withoutJointsOf(structure, keys),
  tree: withoutStalePivots(
    rewriteTree(structure.tree, (node) => node.kind === "item" && keys.has(node.key) ? [] : [node])
  ),
  items: new Map([...structure.items].filter(([key]) => !keys.has(key)))
})

export const withMeta = (structure: Structure, key: string, meta: ItemMeta): Structure => {
  const items = new Map(structure.items)
  if (Object.values(meta).every((value) => value === undefined)) items.delete(key)
  else items.set(key, meta)
  return { ...structure, items }
}

/** An item's user name: `name`, trimmed; null (or nothing left) clears it. */
export const withItemName = (structure: Structure, key: string, name: string | null): Structure | undefined => {
  if (findNode(structure.tree, key)?.node.kind !== "item") return undefined
  const trimmed = name?.trim() ?? ""
  const { name: current, ...rest } = structure.items.get(key) ?? {}
  if (trimmed === (current ?? "")) return undefined
  return withMeta(structure, key, { ...(trimmed.length > 0 && { name: trimmed }), ...rest })
}

/**
 * Where end `end` of the item `key` connects: the spot `spot`, or the measured point for undefined. Which spots the end
 * has is the catalog's, so the caller offers only those.
 */
export const withConnectAt = (
  structure: Structure,
  key: string,
  end: number,
  spot: SpotId | undefined
): Structure | undefined => {
  if (findNode(structure.tree, key)?.node.kind !== "item") return undefined
  const { connectAt = {}, ...rest } = structure.items.get(key) ?? {}
  const slot = String(end)
  if (connectAt[slot] === spot) return undefined
  const { [slot]: _gone, ...others } = connectAt
  const next = spot === undefined ? others : { ...others, [slot]: spot }
  return withMeta(structure, key, { ...rest, ...(Object.keys(next).length > 0 && { connectAt: next }) })
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

/** Makes group `id` an instance of a prefab, or a plain group (undefined). */
export const withPrefabLink = (
  structure: Structure,
  id: string,
  link: PrefabLink | undefined
): Structure | undefined => {
  const group = findGroup(structure.tree, id)
  if (group === undefined || group.prefab === link) return undefined
  return withGroupNode(structure, id, ({ prefab: _, ...node }) => link === undefined ? node : { ...node, prefab: link })
}

/** Sets where group `id` pivots; undefined is the centre of its items' box. A prefab instance pivots on its origin, so it takes none. */
export const withGroupPivot = (
  structure: Structure,
  id: string,
  pivot: GroupPivot | undefined
): Structure | undefined => {
  const group = findGroup(structure.tree, id)
  if (group === undefined || group.prefab !== undefined || sameGroupPivot(group.pivot, pivot)) return undefined
  return withGroupNode(structure, id, ({ pivot: _, ...node }) => pivot === undefined ? node : { ...node, pivot })
}

const sameGroupPivot = (a: GroupPivot | undefined, b: GroupPivot | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b
  if (a.choice !== b.choice) return false
  if (a.choice === "item" && b.choice === "item") return a.key === b.key
  if (a.choice === "point" && b.choice === "point") {
    return a.world.x === b.world.x && a.world.y === b.world.y && a.world.z === b.world.z
  }
  return true
}

/** What a chain is called until the user names it, as `DEFAULT_GROUP_NAME` for a group. */
export const DEFAULT_CHAIN_NAME = "Chain"

/**
 * Makes group `id` a chain of its children in their order, or a plain group again. A chain pivots on its first link,
 * but its group pivot stays on it unused, so Unchain gives it back; a chain that becomes a group loses its growth. A
 * group still called Group becomes Chain, and back; a name the user gave stays.
 */
export const withChain = (structure: Structure, id: string, chain: boolean): Structure | undefined => {
  const group = findGroup(structure.tree, id)
  if (group === undefined || group.prefab !== undefined || (group.chain === true) === chain) return undefined
  const [was, becomes] = chain ? [DEFAULT_GROUP_NAME, DEFAULT_CHAIN_NAME] : [DEFAULT_CHAIN_NAME, DEFAULT_GROUP_NAME]
  return withGroupNode(structure, id, ({ chain: _, growth: __, ...node }) => ({
    ...node,
    name: node.name === was ? becomes : node.name,
    ...(chain && { chain: true })
  }))
}

/** Sets how chain `id` grows as it bends (`ChainGrowth`); undefined turns every link alike. */
export const withChainGrowth = (
  structure: Structure,
  id: string,
  growth: ChainGrowth | undefined
): Structure | undefined => {
  const group = findGroup(structure.tree, id)
  const same = growth === undefined
    ? group?.growth === undefined
    : group?.growth?.curve === growth.curve && group.growth.percent === growth.percent
  if (group?.chain !== true || same) return undefined
  return withGroupNode(structure, id, ({ growth: _, ...node }) => growth === undefined ? node : { ...node, growth })
}

/** Puts group `id`'s children in `order`, each a place among them as they are; undefined when nothing moves. */
export const withChildOrder = (
  structure: Structure,
  id: string,
  order: ReadonlyArray<number>
): Structure | undefined => {
  const group = findGroup(structure.tree, id)
  if (group === undefined || order.every((i, k) => i === k)) return undefined
  const children = order.flatMap((i) => group.children[i] ?? [])
  return children.length === group.children.length && new Set(order).size === order.length
    ? withGroupNode(structure, id, (node) => ({ ...node, children }))
    : undefined
}

/** Turns chain `id` round: its last link becomes the root. */
export const withReversedChain = (structure: Structure, id: string): Structure | undefined => {
  const group = findGroup(structure.tree, id)
  if (group?.chain !== true || group.children.length < 2) return undefined
  return withGroupNode(structure, id, (node) => ({ ...node, children: node.children.toReversed() }))
}

export const sameStrings = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i])

/** The tags of the item or group `target`: free strings, trimmed, each once, in the order given. */
export const withTags = (structure: Structure, target: string, tags: ReadonlyArray<string>): Structure | undefined => {
  const node = findNode(structure.tree, target)?.node
  if (node === undefined) return undefined
  const clean = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
  if (node.kind === "group") {
    if (sameStrings(clean, node.tags)) return undefined
    return withGroupNode(structure, target, (group) => ({ ...group, tags: clean }))
  }
  const { tags: current = [], ...rest } = structure.items.get(target) ?? {}
  if (sameStrings(clean, current)) return undefined
  return withMeta(structure, target, { ...rest, ...(clean.length > 0 && { tags: clean }) })
}

/** What a group is called until the user names it. Its ordinal tells it from the others (`groupNames`). */
export const DEFAULT_GROUP_NAME = "Group"

/** The nodes `ids` that are in the tree, each once, in that order, without those inside another of them. */
const outermostNodes = (tree: ReadonlyArray<TreeNode>, ids: ReadonlyArray<string>): ReadonlyArray<FoundNode> => {
  const found = [...new Set(ids)].flatMap((id) => findNode(tree, id) ?? [])
  const given = new Set(found.map(({ node }) => idOf(node)))
  return found.filter(({ path }) => !path.some((group) => given.has(group.id)))
}

/**
 * Groups the nodes `ids` (items and groups), in that order, as a new group `id` where the first one was. Nodes in other
 * groups are pulled out of them. Undefined when none of `ids` is in the tree.
 */
export const withGroup = (
  structure: Structure,
  ids: ReadonlyArray<string>,
  id: string,
  name?: string
): Structure | undefined => {
  const nodes = outermostNodes(structure.tree, ids).map(({ node }) => node)
  const [first] = nodes
  if (first === undefined) return undefined
  const group: GroupNode = {
    kind: "group",
    id,
    name: name?.trim() || DEFAULT_GROUP_NAME,
    tags: [],
    children: nodes
  }
  const pulled = new Set(nodes.map(idOf))
  const tree = rewriteTree(structure.tree, (node) => {
    if (!pulled.has(idOf(node))) return [node]
    return idOf(node) === idOf(first) ? [group] : []
  })
  return { ...structure, tree }
}

/** Dissolves groups: each one's children take its place in its parent. */
export const withoutGroups = (structure: Structure, ids: ReadonlyArray<string>): Structure | undefined => {
  const gone = new Set(ids.filter((id) => findGroup(structure.tree, id) !== undefined))
  return gone.size === 0 ? undefined : {
    ...structure,
    tree: rewriteTree(structure.tree, (node) => node.kind === "group" && gone.has(node.id) ? node.children : [node])
  }
}

/**
 * Moves nodes, in that order, to position `index` (clamped) among `parentId`'s children once they have left them; null
 * is the root. A node inside another of them moves with it. A group can't go into itself, and a group the move leaves
 * empty goes too.
 */
export const withMovedNodes = (
  structure: Structure,
  nodeIds: ReadonlyArray<string>,
  parentId: string | null,
  index: number
): Structure | undefined => {
  const found = outermostNodes(structure.tree, nodeIds)
  const nodes = found.map(({ node }) => node)
  if (found.length === 0) return undefined
  if (parentId !== null) {
    const insideOne = findNode(nodes, parentId) !== undefined
    if (insideOne || findGroup(structure.tree, parentId) === undefined) return undefined
  }
  const moving = new Set(nodes.map(idOf))
  const rebuilt = (siblings: ReadonlyArray<TreeNode>, parent: string | null): ReadonlyArray<TreeNode> => {
    const kept = siblings.filter((node) => !moving.has(idOf(node))).map((node) =>
      node.kind === "group" ? { ...node, children: rebuilt(node.children, node.id) } : node
    )
    if (parent !== parentId) return kept
    const at = Math.max(0, Math.min(index, kept.length))
    return [...kept.slice(0, at), ...nodes, ...kept.slice(at)]
  }
  const moved = rebuilt(structure.tree, null)
  const childIds = (tree: ReadonlyArray<TreeNode>) =>
    (parentId === null ? tree : findGroup(tree, parentId)?.children ?? []).map(idOf)
  if (childIds(moved).join() === childIds(structure.tree).join()) return undefined
  const left = new Set(found.flatMap(({ path }) => path.map((group) => group.id)))
  return {
    ...structure,
    tree: withoutStalePivots(
      rewriteTree(
        moved,
        (node) => node.kind === "group" && node.children.length === 0 && left.has(node.id) ? [] : [node]
      )
    )
  }
}

/** The nodes the items `keys` make up, in tree order: a group with all its items among them whole, else its members. */
export const wholeNodes = (nodes: ReadonlyArray<TreeNode>, keys: ReadonlySet<string>): ReadonlyArray<TreeNode> =>
  nodes.flatMap((node) => {
    if (node.kind === "item") return keys.has(node.key) ? [node] : []
    const inside = treeKeys([node])
    return inside.length > 0 && inside.every((key) => keys.has(key)) ? [node] : wholeNodes(node.children, keys)
  })

/**
 * The structure of the items `keys`, for a clip: a group with all its items among them is kept whole, and the others
 * leave their copied items loose. It holds the source keys and ids until `withPasted`.
 */
export const copyStructure = (structure: Structure, keys: ReadonlySet<string>): Structure => ({
  tree: wholeNodes(structure.tree, keys),
  items: new Map([...structure.items].filter(([key]) => keys.has(key)))
})

/** The ids of every group in `nodes`, nested ones included. */
export const treeGroupIds = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<string> =>
  nodes.flatMap((node) => node.kind === "group" ? [node.id, ...treeGroupIds(node.children)] : [])

/**
 * Adds a clip's items to `structure`, under the new keys `keyOf` gives for their source keys, keeping their names and
 * tags. The copies of nodes the tree still has go in beside them, in the same group: all of one group's copies as one
 * block after the last of their sources, in order, so a copied row stays a row rather than interleaving with the
 * original. Copies of nodes that have gone land at the end of the root. A group's copy is a new group of the same name
 * and shape, under the id `freshId` gives for its source's.
 */
export const withPasted = (
  structure: Structure,
  clip: Structure,
  keyOf: ReadonlyMap<string, string>,
  freshId: (sourceId: string) => string = freshKey
): Structure => {
  const copyOf = (node: TreeNode): ReadonlyArray<TreeNode> => {
    if (node.kind === "group") {
      // an Item pivot names a member, which the copy has under a new key
      const member = node.pivot?.choice === "item" ? keyOf.get(node.pivot.key) : undefined
      const pivot = member === undefined ? node.pivot : { choice: "item" as const, key: member }
      return [{
        ...node,
        id: freshId(node.id),
        children: node.children.flatMap(copyOf),
        ...(pivot !== undefined && { pivot })
      }]
    }
    const key = keyOf.get(node.key)
    return key === undefined ? [] : [itemNode(key)]
  }
  const waiting = new Map(clip.tree.map((node) => [idOf(node), copyOf(node)]))
  // the copies of one group's children go in as a block after the last of their sources, in order
  const place = (siblings: ReadonlyArray<TreeNode>): ReadonlyArray<TreeNode> => {
    const kept = siblings.map((node) => node.kind === "group" ? { ...node, children: place(node.children) } : node)
    const last = siblings.findLastIndex((node) => waiting.has(idOf(node)))
    if (last < 0) return kept
    const copies = siblings.flatMap((node) => {
      const copy = waiting.get(idOf(node)) ?? []
      waiting.delete(idOf(node))
      return copy
    })
    return [...kept.slice(0, last + 1), ...copies, ...kept.slice(last + 1)]
  }
  const tree = place(structure.tree)
  const items = new Map(structure.items)
  for (const [source, meta] of clip.items) {
    const key = keyOf.get(source)
    if (key !== undefined) items.set(key, meta)
  }
  return { ...structure, tree: [...tree, ...[...waiting.values()].flat()], items }
}

/** A name as it's shown: `ordinal` tells apart what shares `name`, and something with a name of its own has none. */
export interface NumberedName {
  readonly name: string
  readonly ordinal: number | undefined
}

/** `names` by key, numbering in the order given each name that's used more than once. */
const numbered = (names: ReadonlyArray<readonly [string, string]>): ReadonlyMap<string, NumberedName> => {
  const totals = new Map<string, number>()
  for (const [, name] of names) totals.set(name, (totals.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return new Map(names.map(([key, name]): readonly [string, NumberedName] => {
    if (totals.get(name) === 1) return [key, { name, ordinal: undefined }]
    const ordinal = (seen.get(name) ?? 0) + 1
    seen.set(name, ordinal)
    return [key, { name, ordinal }]
  }))
}

/** A numbered name as plain text ("Cube 3"), for what can't style the ordinal. */
export const numberedNameText = ({ name, ordinal }: NumberedName): string =>
  ordinal === undefined ? name : `${name} ${ordinal}`

/** An item's piece as the Pieces panel names it; without a catalog entry, the class written out. */
export const pieceNameOf = (item: Item, catalog: CatalogIndex | null): string => {
  const piece = catalog?.pieceByClass.get(item.actorToSpawn)
  return pieceLabelOf(piece ?? { className: classNameOf(item.actorToSpawn) })
}

/**
 * Every item's name, by key: the user's, else the catalog's for its class (without a catalog, the class written out).
 * Items with the same name are numbered among themselves in document order.
 */
export const itemNames = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  items: Structure["items"],
  catalog: CatalogIndex | null
): ReadonlyMap<string, NumberedName> =>
  numbered(ids.flatMap((key, index) => {
    const item = map.items[index]
    if (item === undefined) return []
    return [[key, items.get(key)?.name ?? pieceNameOf(item, catalog)] as const]
  }))

/** Every group's name, by id, numbered among the groups with the same name in tree order. */
export const groupNames = (tree: ReadonlyArray<TreeNode>): ReadonlyMap<string, NumberedName> => {
  const groups = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<readonly [string, string]> =>
    nodes.flatMap((node) => node.kind === "group" ? [[node.id, node.name] as const, ...groups(node.children)] : [])
  return numbered(groups(tree))
}
