/**
 * Prefab instances in a document (docs/DESKTOP.md § Prefabs): a group whose `prefab` link names the definition it was
 * placed from. An instance follows its definition while its items still match what was placed, allowing for its own
 * placement: moving, turning or scaling the whole group doesn't count as an edit.
 */
import type { PrefabRef } from "@ballest/contracts"
import type { CatalogIndex } from "./Catalog"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { removeItems } from "./edits"
import { editTransform, SCALE_PROPERTIES, withEditTransform } from "./editTransform"
import { classNameOf, type Item, objectPathOf, PropertyList } from "./MapFile"
import type { GroupNode, PrefabLink, TreeNode } from "./MapSidecar"
import { isSamePrefab, itemOfPrefab, ORIGIN } from "./prefab"
import type { PrefabFile } from "./PrefabFile"
import { type Doc, findGroup, freshKey, freshKeys, itemNode, rewriteTree, treeKeys } from "./structure"
import { quatConjugate, quatMul, quatNormalize, rotateVec, vecAdd, vecSub } from "./ueMath"

/** A definition as an instance takes it: its items in its own frame, and the link they make. */
export interface PrefabDefinition {
  readonly items: ReadonlyArray<Item>
  readonly link: PrefabLink
}

export const definitionOf = (
  prefab: PrefabFile,
  ref: PrefabRef & { readonly hash: string },
  catalog: CatalogIndex | null
): PrefabDefinition => {
  const items = prefab.items.map((item) => itemOfPrefab(item, ORIGIN, catalog))
  return { items, link: { tier: ref.tier, name: ref.name, hash: ref.hash, items: items.map(signatureOf) } }
}

/** How a definition's items land in a document. */
interface Placement {
  readonly translation: Vec3
  readonly rotation: Quat4
  /** Each item's scale is this times its own, along its own axes. */
  readonly scale: Vec3
  /** The items' offsets are this times their own: 1 for the editor's scale, which leaves them, `scale` for the game's. */
  readonly spread: Vec3
}

const ONE: Vec3 = { x: 1, y: 1, z: 1 }

const times = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z })

const placed = (placement: Placement, t: UeTransform): UeTransform => ({
  translation: vecAdd(placement.translation, rotateVec(placement.rotation, times(placement.spread, t.translation))),
  rotation: quatNormalize(quatMul(placement.rotation, t.rotation)),
  scale3D: times(placement.scale, t.scale3D)
})

/** The rounding in a signature: 0.001 cm, eight places for a rotation, so 0.001 cm across a kilometre, and six for a scale. */
const PLACES = { translation: 3, rotation: 8, scale: 6 } as const

const rounded = (values: ReadonlyArray<number>, places: number) =>
  values.map((value) => Number(value.toFixed(places)) + 0).join(",")

/** FNV-1a, enough to tell one item's content from what it was. */
const digestOf = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16)
}

/** Everything about an item but its transform, in an order edits can't change. */
const contentOf = (item: Item): string => {
  const properties = PropertyList.literals.flatMap((list) =>
    item[list].flatMap(({ currentValue, propertyName }) =>
      SCALE_PROPERTIES.has(propertyName) ? [] : [`${propertyName}=${String(currentValue)}`]
    )
  ).sort()
  const meshes = item.meshComponents.map((mesh) =>
    [mesh.meshComponentTag, mesh.meshAssetPath ?? "", ...mesh.materials.map(({ material }) => objectPathOf(material))]
      .join(",")
  )
  return digestOf([...properties, ...meshes].join("|"))
}

/** An item as a link keeps it: `<class>|<x,y,z>|<qx,qy,qz,qw>|<sx,sy,sz>|<content>`. */
const signatureOf = (item: Item): string => {
  const { rotation: q, scale3D: s, translation: t } = editTransform(item)
  return [
    classNameOf(item.actorToSpawn),
    rounded([t.x, t.y, t.z], PLACES.translation),
    rounded([q.x, q.y, q.z, q.w], PLACES.rotation),
    rounded([s.x, s.y, s.z], PLACES.scale),
    contentOf(item)
  ].join("|")
}

const parseSignature = (text: string) => {
  const [className = "", t = "", r = "", s = "", content = ""] = text.split("|")
  const numbers = (part: string) => part.split(",").map(Number)
  const [x = 0, y = 0, z = 0] = numbers(t)
  const [qx = 0, qy = 0, qz = 0, qw = 1] = numbers(r)
  const [sx = 1, sy = 1, sz = 1] = numbers(s)
  return {
    className,
    transform: {
      translation: { x, y, z },
      rotation: { x: qx, y: qy, z: qz, w: qw },
      scale3D: { x: sx, y: sy, z: sz }
    },
    content
  }
}

/** How far a placed item may be from where a fit says it should be: a signature's rounding, over the item's distance. */
const TOLERANCE = { translation: 0.05, perCentimetre: 4e-6, rotation: 2e-4, scale: 2e-4 } as const

const sameRotation = (a: Quat4, b: Quat4) => {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return 1 - dot < TOLERANCE.rotation ** 2
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance

const sameScale = (a: Vec3, b: Vec3) =>
  [[a.x, b.x], [a.y, b.y], [a.z, b.z]].every(([x = 0, y = 0]) => near(x, y, TOLERANCE.scale * Math.max(1, Math.abs(y))))

const lengthOf = ({ x, y, z }: Vec3) => Math.hypot(x, y, z)

const agrees = (placement: Placement, expected: UeTransform, actual: UeTransform): boolean => {
  const want = placed(placement, expected)
  const reach = lengthOf(expected.translation) * Math.max(1, lengthOf(placement.spread))
  return lengthOf(vecSub(want.translation, actual.translation)) <=
      TOLERANCE.translation + TOLERANCE.perCentimetre * reach &&
    sameRotation(want.rotation, actual.rotation) && sameScale(want.scale3D, actual.scale3D)
}

/** The placements that would put `expected` at `actual`, with and without the items' offsets scaled. */
const placementsFrom = (expected: UeTransform, actual: UeTransform): ReadonlyArray<Placement> => {
  const rotation = quatNormalize(quatMul(actual.rotation, quatConjugate(expected.rotation)))
  const ratio = (a: number, b: number) => b === 0 ? 1 : a / b
  const scale = {
    x: ratio(actual.scale3D.x, expected.scale3D.x),
    y: ratio(actual.scale3D.y, expected.scale3D.y),
    z: ratio(actual.scale3D.z, expected.scale3D.z)
  }
  const uniform = near(scale.x, scale.y, TOLERANCE.scale) && near(scale.y, scale.z, TOLERANCE.scale)
  const spreads = uniform && !near(scale.x, 1, TOLERANCE.scale) ? [ONE, scale] : [ONE]
  return spreads.map((spread) => ({
    rotation,
    scale,
    spread,
    translation: vecSub(actual.translation, rotateVec(rotation, times(spread, expected.translation)))
  }))
}

/** Where an instance's items are in the document: in document order, which is the definition's. */
const indicesOf = ({ ids }: Doc, group: GroupNode): ReadonlyArray<number> => {
  const inside = new Set(treeKeys([group]))
  return ids.flatMap((key, index) => inside.has(key) ? [index] : [])
}

/** How many items the fit tries an anchor on. One is enough for an instance nobody edited. */
const ANCHORS = 8

const centreOf = (transforms: ReadonlyArray<UeTransform>): Vec3 => {
  const n = transforms.length || 1
  const { x, y, z } = transforms.reduce((total, { translation }) => vecAdd(total, translation), ORIGIN)
  return { x: x / n, y: y / n, z: z / n }
}

/**
 * Fits the items an instance holds to what its link says was placed. Every item matching means an unedited instance. An
 * edited one takes the placement most of its items agree on, so an Update leaves it about where it was.
 */
export const checkInstance = (
  doc: Doc,
  group: GroupNode,
  link: PrefabLink
): { readonly placement: Placement; readonly unmodified: boolean } => {
  const items = indicesOf(doc, group).flatMap((index) => doc.map.items[index] ?? [])
  const expected = link.items.map(parseSignature)
  const transforms = items.map(editTransform)
  // the items still of the class they were placed as
  const kept = expected.flatMap(({ className, transform }, index) => {
    const item = items[index]
    const actual = transforms[index]
    return item === undefined || actual === undefined || classNameOf(item.actorToSpawn) !== className
      ? []
      : [{ index, transform, actual }]
  })
  const anchors = kept.filter(({ index }) => index < ANCHORS)
  const scored = anchors.flatMap(({ actual, transform }) => placementsFrom(transform, actual)).map((placement) => ({
    placement,
    count: kept.filter(({ actual, transform }) => agrees(placement, transform, actual)).length
  }))
  const best = scored.reduce<typeof scored[number] | undefined>(
    (top, next) => top === undefined || next.count > top.count ? next : top,
    undefined
  )
  const sameContent = items.every((item, index) => contentOf(item) === expected[index]?.content)
  if (best !== undefined) {
    return {
      placement: best.placement,
      unmodified: items.length === expected.length && best.count === expected.length && sameContent
    }
  }
  return {
    placement: {
      translation: vecSub(centreOf(transforms), centreOf(expected.map(({ transform }) => transform))),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: ONE,
      spread: ONE
    },
    unmodified: false
  }
}

const placedItem = (item: Item, placement: Placement): Item => {
  const { rotation, scale3D, translation } = placed(placement, editTransform(item))
  return withEditTransform(item, {
    rotation: { ...rotation },
    scale3D: { ...scale3D },
    translation: { ...translation }
  }, ORIGIN)
}

export const instancesIn = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<GroupNode & { prefab: PrefabLink }> =>
  nodes.flatMap((node) => {
    if (node.kind === "item") return []
    const inside = instancesIn(node.children)
    return node.prefab === undefined ? inside : [{ ...node, prefab: node.prefab }, ...inside]
  })

/** The instances of `ref` under `nodes`. */
export const instancesOfPrefab = (nodes: ReadonlyArray<TreeNode>, ref: PrefabRef) =>
  instancesIn(nodes).filter(({ prefab }) => isSamePrefab(prefab, ref))

/**
 * The instance `groupId` with its items replaced by `definition`'s, where its placement puts them. The items that stay
 * the same class keep their keys, so their names, tags and places in nested groups stay too. Its link moves on to
 * `definition`, and an item it gained joins the end of the group.
 */
export const withUpdatedInstance = (doc: Doc, groupId: string, definition: PrefabDefinition): Doc | undefined => {
  const group = findGroup(doc.structure.tree, groupId)
  if (group?.prefab === undefined) return undefined
  const { placement } = checkInstance(doc, group, group.prefab)
  const fresh = definition.items.map((item) => placedItem(item, placement))
  const indices = indicesOf(doc, group)
  const items = [...doc.map.items]
  const ids = [...doc.ids]
  /** Each key that gives way to a new item of another class, and what takes its place. */
  const swapped = new Map<string, string>()
  indices.forEach((index, n) => {
    const item = fresh[n]
    const key = ids[index]
    if (item === undefined || key === undefined) return
    if (items[index]?.actorToSpawn !== item.actorToSpawn) {
      const next = freshKey()
      swapped.set(key, next)
      ids[index] = next
    }
    items[index] = item
  })
  const removed = indices.slice(fresh.length)
  const gone = new Set(removed.flatMap((index) => ids[index] ?? []))
  const added = fresh.slice(indices.length)
  const addedKeys = freshKeys(added.length)
  const editorState = doc.map.editorState === undefined ? {} : {
    editorState: {
      ...doc.map.editorState,
      pivots: doc.map.editorState.pivots.filter(({ itemIndex }) => !swapped.has(doc.ids[itemIndex] ?? ""))
    }
  }
  const kept = removeItems({ ...doc.map, items, ...editorState }, removed)
  const tree = rewriteTree(doc.structure.tree, (node) => {
    if (node.kind === "group") {
      return node.id === groupId
        ? [{ ...node, prefab: definition.link, children: [...node.children, ...addedKeys.map(itemNode)] }]
        : [node]
    }
    const next = swapped.get(node.key)
    if (next !== undefined) return [itemNode(next)]
    return gone.has(node.key) ? [] : [node]
  })
  return {
    map: { ...kept, items: [...kept.items, ...added] },
    ids: [...ids.filter((key) => !gone.has(key)), ...addedKeys],
    structure: {
      tree,
      items: new Map([...doc.structure.items].filter(([key]) => !gone.has(key) && !swapped.has(key)))
    }
  }
}
