/**
 * The Outline panel's data: the tree as a flat list of rows, the filter, where a drop lands and which rows a scroll
 * shows. Pure, so the panel only draws and handles events (docs/DESKTOP.md § Outline).
 */
import { nodeKeys } from "./groupSelection"
import { classNameOf, type MapFile } from "./MapFile"
import type { TreeNode } from "./MapSidecar"
import { findGroup, idOf, type NumberedName, numberedNameText, type Structure, treeKeys } from "./structure"

export interface OutlineRow {
  /** An item's key, or a group's id. */
  readonly id: string
  readonly kind: "item" | "group"
  readonly depth: number
  /** The group it is in; null at the root. */
  readonly parentId: string | null
  /** Its place among its parent's children, shown or not. */
  readonly index: number
  readonly name: string
  /** Tells it from others of the same name; those of a name to themselves have none. */
  readonly ordinal: number | undefined
  /** An item's `actorToSpawn`; empty for a group. */
  readonly actorClass: string
  /** An item's class, short; empty for a group. */
  readonly className: string
  readonly tags: ReadonlyArray<string>
  /** A group's direct children, and all the items under it; 0 for an item. */
  readonly childCount: number
  readonly itemCount: number
  /** A group whose children aren't shown. */
  readonly collapsed: boolean
  /** A group that is a prefab instance. */
  readonly instance: boolean
  /** A group that is a chain of its children. */
  readonly chain: boolean
  /** Inside a chain, which link this is, from 1; undefined elsewhere. */
  readonly link: number | undefined
}

export const itemClasses = (map: MapFile, ids: ReadonlyArray<string>): ReadonlyMap<string, string> =>
  new Map(ids.flatMap((key, index) => {
    const item = map.items[index]
    return item === undefined ? [] : [[key, item.actorToSpawn] as const]
  }))

/** A search box's words, lower-cased: what a row has to hold all of. */
export const termsOf = (query: string): ReadonlyArray<string> =>
  query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)

const rowMatches = (row: OutlineRow, terms: ReadonlyArray<string>) => {
  const haystack = `${numberedNameText(row)} ${row.className} ${row.tags.join(" ")}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/** The rows to show, in tree order (docs/DESKTOP.md § Outline). `names` has the items' by key and the groups' by id. */
export const outlineRows = (
  structure: Structure,
  names: ReadonlyMap<string, NumberedName>,
  classes: ReadonlyMap<string, string>,
  collapsedGroups: ReadonlySet<string>,
  query: string
): ReadonlyArray<OutlineRow> => {
  const terms = termsOf(query)
  const filtering = terms.length > 0
  const rows: Array<OutlineRow> = []
  const visit = (nodes: ReadonlyArray<TreeNode>, depth: number, parentId: string | null, chained = false) => {
    for (const [index, node] of nodes.entries()) {
      const place = { depth, parentId, index, link: chained ? index + 1 : undefined }
      if (node.kind === "item") {
        const actorClass = classes.get(node.key) ?? ""
        const row: OutlineRow = {
          ...place,
          id: node.key,
          kind: "item",
          ...names.get(node.key) ?? { name: node.key, ordinal: undefined },
          actorClass,
          className: classNameOf(actorClass),
          tags: structure.items.get(node.key)?.tags ?? [],
          childCount: 0,
          itemCount: 0,
          collapsed: false,
          instance: false,
          chain: false
        }
        if (!filtering || rowMatches(row, terms)) rows.push(row)
        continue
      }
      const collapsed = !filtering && collapsedGroups.has(node.id)
      const row: OutlineRow = {
        ...place,
        id: node.id,
        kind: "group",
        ...names.get(node.id) ?? { name: node.name, ordinal: undefined },
        actorClass: "",
        className: "",
        tags: node.tags,
        childCount: node.children.length,
        itemCount: treeKeys([node]).length,
        collapsed,
        instance: node.prefab !== undefined,
        chain: node.chain === true
      }
      const at = rows.length
      rows.push(row)
      if (!collapsed) visit(node.children, depth + 1, node.id, node.chain === true)
      if (filtering && rows.length === at + 1 && !rowMatches(row, terms)) rows.pop()
    }
  }
  visit(structure.tree, 0, null)
  return rows
}

/** The rows of a Shift range, in shown order: from `fromId` to `toId`, or just `toId` when `fromId` isn't shown. */
export const rowRange = (
  rows: ReadonlyArray<OutlineRow>,
  fromId: string | null,
  toId: string
): ReadonlyArray<OutlineRow> => {
  const to = rows.findIndex((row) => row.id === toId)
  if (to < 0) return []
  const found = rows.findIndex((row) => row.id === fromId)
  const from = found < 0 ? to : found
  return rows.slice(Math.min(from, to), Math.max(from, to) + 1)
}

/** The item keys `rows` stand for, a group's being every item under it. */
export const rowKeys = (tree: ReadonlyArray<TreeNode>, rows: ReadonlyArray<OutlineRow>): ReadonlyArray<string> =>
  rows.flatMap((row) => row.kind === "item" ? [row.id] : nodeKeys(tree, row.id))

export interface DropTarget {
  /** The row the indicator is drawn on; null below the last row. */
  readonly rowId: string | null
  readonly position: "before" | "after" | "into"
  /** The group the nodes would go in; null is the root. */
  readonly parentId: string | null
  /** The gap among its children as they are now, the dragged nodes included. */
  readonly index: number
  /** How far the indicator is indented. */
  readonly depth: number
}

/** The share of a group row, at its top and at its bottom, that drops beside it rather than into it. */
const GROUP_EDGE = 0.25

/**
 * The drop at `fraction` (0 top, 1 bottom) of row `rowIndex`, or past the rows. A node can't land on itself or anything
 * inside it, so a row under one of the `dragged` nodes answers undefined.
 */
export const dropTargetAt = (
  rows: ReadonlyArray<OutlineRow>,
  rootLength: number,
  rowIndex: number,
  fraction: number,
  dragged: ReadonlySet<string>
): DropTarget | undefined => {
  const row = rows[rowIndex]
  if (row === undefined) {
    return rowIndex < 0 ? undefined : { rowId: null, position: "after", parentId: null, index: rootLength, depth: 0 }
  }
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]))
  for (let id: string | null | undefined = row.id; id !== null && id !== undefined; id = parentOf.get(id)) {
    if (dragged.has(id)) return undefined
  }
  const beside = { rowId: row.id, parentId: row.parentId, depth: row.depth }
  const before = { ...beside, position: "before", index: row.index } as const
  if (row.kind === "item") return fraction < 0.5 ? before : { ...beside, position: "after", index: row.index + 1 }
  if (fraction < GROUP_EDGE) return before
  if (fraction >= 1 - GROUP_EDGE) {
    if (!row.collapsed && row.childCount > 0) {
      return { rowId: row.id, position: "after", parentId: row.id, index: 0, depth: row.depth + 1 }
    }
    return { ...beside, position: "after", index: row.index + 1 }
  }
  return { rowId: row.id, position: "into", parentId: row.id, index: row.childCount, depth: row.depth + 1 }
}

/** A drop's gap (`DropTarget.index`) as a place among the parent's children once the dragged nodes have left them. */
export const indexOnceLeft = (
  structure: Structure,
  target: Pick<DropTarget, "parentId" | "index">,
  dragged: ReadonlySet<string>
): number => {
  const siblings = target.parentId === null
    ? structure.tree
    : findGroup(structure.tree, target.parentId)?.children ?? []
  return target.index - siblings.slice(0, target.index).filter((node) => dragged.has(idOf(node))).length
}

/** The rows to render for a scroll position: those in view and `overscan` either side. */
export const visibleRange = (
  scrollTop: number,
  viewHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan: number
): { readonly start: number; readonly end: number } => ({
  start: Math.max(0, Math.floor(scrollTop / rowHeight) - overscan),
  end: Math.min(rowCount, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan)
})

/** The scroll position that shows row `index` with the least movement: the same one when it's in view already. */
export const scrollToShow = (index: number, scrollTop: number, viewHeight: number, rowHeight: number): number => {
  const top = index * rowHeight
  if (top < scrollTop) return top
  return top + rowHeight > scrollTop + viewHeight ? top + rowHeight - viewHeight : scrollTop
}
