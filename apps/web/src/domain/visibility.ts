/**
 * Hide, isolate and lock (docs/DESKTOP.md § Hide, isolate and lock; the comparison behind it is
 * docs/design/hide-isolate-lock.md). Hidden and locked are each item's own, kept in the sidecar with its name and tags,
 * so a group is hidden or locked by its items. Isolation is a tab's view, outside the document: the items it leaves out.
 * Pure, like `structure.ts`: an edit that changes nothing answers undefined.
 */
import type { TreeNode } from "./MapSidecar"
import { findGroup, type Structure, treeKeys, withMeta } from "./structure"

/** What hiding or locking sets on an item. */
export type ItemFlag = "hidden" | "locked"

/** A tab's isolation: the items it leaves out, which were everything but the selection when it began. */
export interface Isolation {
  readonly outside: ReadonlySet<string>
}

export const isHidden = (structure: Structure, key: string): boolean => structure.items.get(key)?.hidden === true

export const isLocked = (structure: Structure, key: string): boolean => structure.items.get(key)?.locked === true

/** Whether an item is drawn: not hidden, and not left out by the isolation. Only what's drawn is snapped to. */
export const isShown = (structure: Structure, isolation: Isolation | null, key: string): boolean =>
  !isHidden(structure, key) && isolation?.outside.has(key) !== true

/**
 * Whether the viewport can pick an item: a click, a box or lasso, Select all. It must be drawn and not locked. A pick
 * still reaches the item's whole group at the click level (`clickLevelOf`), hidden or locked members and all, so a
 * group keeps its shape; the Outline selects anything.
 */
export const isPickable = (structure: Structure, isolation: Isolation | null, key: string): boolean =>
  isShown(structure, isolation, key) && !isLocked(structure, key)

/** `keys` with `flag` set (`on`) or cleared, as one edit; undefined when none of them changes. */
export const withFlag = (
  structure: Structure,
  keys: ReadonlyArray<string>,
  flag: ItemFlag,
  on: boolean
): Structure | undefined => {
  const inTree = new Set(treeKeys(structure.tree))
  const changing = keys.filter((key) => inTree.has(key) && (structure.items.get(key)?.[flag] === true) !== on)
  if (changing.length === 0) return undefined
  return changing.reduce((next, key) => {
    const { [flag]: _gone, ...rest } = next.items.get(key) ?? {}
    return withMeta(next, key, on ? { ...rest, [flag]: true } : rest)
  }, structure)
}

/** The items that have `flag`, in tree order. */
export const keysWith = (structure: Structure, flag: ItemFlag): ReadonlyArray<string> =>
  treeKeys(structure.tree).filter((key) => structure.items.get(key)?.[flag] === true)

/** How much of a set of items has `flag`: what an Outline row's toggle shows, and which way a press turns it. */
export type FlagState = "all" | "some" | "none"

export const flagStateOf = (structure: Structure, keys: ReadonlyArray<string>, flag: ItemFlag): FlagState => {
  const set = keys.filter((key) => structure.items.get(key)?.[flag] === true).length
  return set === 0 ? "none" : set === keys.length ? "all" : "some"
}

/** A toggle on `keys`: clears `flag` when every one has it, else sets it on all of them, as Unity's eye does. */
export const toggledFlag = (structure: Structure, keys: ReadonlyArray<string>, flag: ItemFlag): boolean =>
  flagStateOf(structure, keys, flag) !== "all"

/** The isolation of `keys`: every other item of `ids` is left out. Undefined with nothing to isolate. */
export const isolationOf = (ids: ReadonlyArray<string>, keys: ReadonlyArray<string>): Isolation | undefined => {
  const inside = new Set(keys)
  return inside.size === 0 ? undefined : { outside: new Set(ids.filter((key) => !inside.has(key))) }
}

/**
 * What Select all selects: each node at the click level (the root's, or the entered group's children) with an item a
 * pick could reach, whole. A group with one item still pickable comes with its hidden and locked ones, as a click on
 * that item brings them.
 */
export const pickableSelection = (
  tree: ReadonlyArray<TreeNode>,
  enteredGroupId: string | null,
  pickable: (key: string) => boolean
): ReadonlyArray<string> => {
  const nodes = enteredGroupId === null ? tree : findGroup(tree, enteredGroupId)?.children ?? []
  return nodes.flatMap((node) => {
    const keys = treeKeys([node])
    return keys.some(pickable) ? keys : []
  })
}
