/**
 * Between the structure tree and the game's flat `editorState.groups` (docs/FORMAT.md § Groups). The game holds an item
 * in at most one group and no group inside another, so only the outermost tree groups reach it.
 */
import type { CatalogIndex } from "./Catalog"
import type { Quat4, Vec3 } from "./coords"
import { editTransform } from "./editTransform"
import { defaultEditorState, identityTransform } from "./factory"
import { itemsBoxOf } from "./itemBounds"
import type { EditorGroup, MapFile } from "./MapFile"
import type { GroupNode, GroupPivot, TreeNode } from "./MapSidecar"
import { pivotAt } from "./pivot"
import { DEFAULT_GROUP_NAME, freshKey, itemNode, type Structure, treeKeys } from "./structure"
import { IDENTITY_QUAT } from "./ueMath"
import { frameOfBox, turnedBy, type UnitContext, unitOf } from "./units"

/** A group's name as the game takes it: letters and digits, at most 64 of them; empty when none are left. */
export const gameGroupNameOf = (name: string): string => name.replace(/[^A-Za-z0-9]/g, "").slice(0, 64)

/** How a group's pivot is read off `map` as the document holds it (docs/design/pivot-modes-and-chains.md § Units). */
const docUnitContext = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  tree: ReadonlyArray<TreeNode>,
  catalog: CatalogIndex | null,
  instanceOriginOf: UnitContext["instanceOriginOf"]
): UnitContext => {
  const indexOf = new Map(ids.map((key, index) => [key, index]))
  const itemAt = (key: string) => map.items[indexOf.get(key) ?? -1]
  return {
    tree,
    transformOf: (key) => {
      const item = itemAt(key)
      return item === undefined ? undefined : editTransform(item)
    },
    localPivotOf: (key) => pivotAt(map, indexOf.get(key) ?? -1).localPosition,
    boxOf: (keys, frame) => itemsBoxOf(keys.flatMap((key) => itemAt(key) ?? []), catalog, frame),
    instanceOriginOf,
    livePointOf: (_, world) => world,
    liveRotationOf: (_, rotation) => rotation
  }
}

/**
 * `map` as the game gets it: its `editorState.groups` made from `tree`, one for each outermost group with an item
 * anywhere under it. A group's `frame` sits where the group pivots (`unitOf`), turned as the group is (`GroupNode.rotation`)
 * with scale 1: by default what Ctrl+G makes, the centre of the box around the members' bounds with no turn, so the
 * in-game gizmo sits and turns where the editor's does.
 * A prefab instance's frame is its origin, which `instanceOriginOf` gives (the store's `instanceOrigin`; none here, so a
 * caller without one gets the centre). A map with no groups either way stays as it is.
 */
export const withGameGroups = (
  map: MapFile,
  ids: ReadonlyArray<string>,
  tree: ReadonlyArray<TreeNode>,
  catalog: CatalogIndex | null,
  instanceOriginOf: UnitContext["instanceOriginOf"] = () => undefined
): MapFile => {
  const indexOf = new Map(ids.map((key, index) => [key, index]))
  const ctx = docUnitContext(map, ids, tree, catalog, instanceOriginOf)
  const groups = tree.flatMap((node): ReadonlyArray<EditorGroup> => {
    if (node.kind !== "group") return []
    const members = treeKeys(node.children).flatMap((key) => indexOf.get(key) ?? []).sort((a, b) => a - b)
    if (members.length === 0) return []
    return [{
      members,
      name: gameGroupNameOf(node.prefab?.name ?? node.name),
      frame: {
        ...identityTransform(unitOf(node, ctx)?.pivot),
        ...(node.rotation !== undefined && { rotation: node.rotation })
      }
    }]
  })
  if (groups.length === 0 && (map.editorState?.groups.length ?? 0) === 0) return map
  return { ...map, editorState: { ...map.editorState ?? defaultEditorState(), groups } }
}

/** A frame's translation, which the format leaves untyped (`EditorGroup`); undefined unless it is three finite numbers. */
const frameTranslationOf = (frame: unknown): Vec3 | undefined => {
  if (typeof frame !== "object" || frame === null || !("translation" in frame)) return undefined
  const t: unknown = frame.translation
  if (typeof t !== "object" || t === null || !("x" in t) || !("y" in t) || !("z" in t)) return undefined
  const { x, y, z } = t
  return typeof x === "number" && typeof y === "number" && typeof z === "number" && [x, y, z].every(Number.isFinite)
    ? { x, y, z }
    : undefined
}

/**
 * A frame's rotation, when it is a unit quaternion the game would load and not the world's axes; undefined otherwise,
 * as the format leaves it untyped too.
 */
const frameRotationOf = (frame: unknown): Quat4 | undefined => {
  if (typeof frame !== "object" || frame === null || !("rotation" in frame)) return undefined
  const q: unknown = frame.rotation
  if (typeof q !== "object" || q === null || !("x" in q) || !("y" in q) || !("z" in q) || !("w" in q)) return undefined
  const { w, x, y, z } = q
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" || typeof w !== "number") return undefined
  const length = Math.hypot(x, y, z, w)
  if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-3) return undefined
  return turnedBy(undefined, { x: x / length, y: y / length, z: z / length, w: w / length })
}

/** Whether a frame the game kept sits away from where Ctrl+G would put it, by more than the fingerprint's 1 cm. */
const offCentre = (frame: Vec3, centre: Vec3): boolean =>
  Math.abs(frame.x - centre.x) > 1 || Math.abs(frame.y - centre.y) > 1 || Math.abs(frame.z - centre.z) > 1

/**
 * The structure of a map with no sidecar: its items loose in document order, with each game group one tree group where
 * its first member is. Members the game would refuse (past the items, or in an earlier group) are left out of it.
 */
export const structureFromGame = (
  map: MapFile,
  keys: ReadonlyArray<string>,
  catalog: CatalogIndex | null = null
): Structure => {
  const grouped = new Set<number>()
  const groupAt = new Map<number, GroupNode>()
  for (const { frame, members, name } of map.editorState?.groups ?? []) {
    const own = [...new Set(members)].filter((member) => keys[member] !== undefined && !grouped.has(member))
    if (own.length === 0) continue
    for (const member of own) grouped.add(member)
    // A frame's turn comes back in as the group's, and a frame the game kept away from the centre of the box square to
    // it as a Point pivot. Measured against the catalog's bounds only, or every piece would count as its origin.
    const rotation = frameRotationOf(frame)
    const items = own.flatMap((member) => map.items[member] ?? [])
    const box = catalog === null ? undefined : itemsBoxOf(items, catalog, rotation ?? IDENTITY_QUAT)
    const centre = box === undefined ? undefined : frameOfBox(box, rotation ?? IDENTITY_QUAT).origin
    const at = frameTranslationOf(frame)
    const pivot: GroupPivot | undefined = centre !== undefined && at !== undefined && offCentre(at, centre)
      ? { choice: "point", world: at }
      : undefined
    groupAt.set(own.reduce((first, member) => Math.min(first, member)), {
      kind: "group",
      id: freshKey(),
      name: name || DEFAULT_GROUP_NAME,
      tags: [],
      children: own.flatMap((member) => keys[member] ?? []).map(itemNode),
      ...(pivot !== undefined && { pivot }),
      ...(rotation !== undefined && { rotation })
    })
  }
  const tree = keys.flatMap((key, index): TreeNode | ReadonlyArray<TreeNode> =>
    groupAt.get(index) ?? (grouped.has(index) ? [] : itemNode(key))
  )
  return { tree, items: new Map() }
}
