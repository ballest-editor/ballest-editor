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
import { classNameOf, type Item, type MapFile, objectPathOf, PropertyList } from "./MapFile"
import type { GroupNode, PrefabLink, TreeNode } from "./MapSidecar"
import { itemOfPrefab, ORIGIN } from "./prefab"
import type { PrefabFile } from "./PrefabFile"
import { findGroup, freshKey, freshKeys, itemNode, rewriteTree, type Structure, treeKeys } from "./structure"
import { quatConjugate, quatMul, quatNormalize, rotateVec } from "./ueMath"

/** A document's parts, as the store's `Doc` has them. */
export interface DocParts {
  readonly map: MapFile
  readonly ids: ReadonlyArray<string>
  readonly structure: Structure
}

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

const placed = (placement: Placement, t: UeTransform): UeTransform => {
  const offset = rotateVec(placement.rotation, times(placement.spread, t.translation))
  return {
    translation: {
      x: placement.translation.x + offset.x,
      y: placement.translation.y + offset.y,
      z: placement.translation.z + offset.z
    },
    rotation: quatNormalize(quatMul(placement.rotation, t.rotation)),
    scale3D: times(placement.scale, t.scale3D)
  }
}

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

interface Signature {
  readonly className: string
  readonly transform: UeTransform
  readonly content: string
}

const parseSignature = (text: string): Signature => {
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

const distanceBetween = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const lengthOf = ({ x, y, z }: Vec3) => Math.hypot(x, y, z)

/** Whether `actual` is where `placement` puts `expected`. */
const agrees = (placement: Placement, expected: UeTransform, actual: UeTransform): boolean => {
  const want = placed(placement, expected)
  const reach = lengthOf(expected.translation) * Math.max(1, lengthOf(placement.spread))
  return distanceBetween(want.translation, actual.translation) <=
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
  return spreads.map((spread) => {
    const offset = rotateVec(rotation, times(spread, expected.translation))
    return {
      rotation,
      scale,
      spread,
      translation: {
        x: actual.translation.x - offset.x,
        y: actual.translation.y - offset.y,
        z: actual.translation.z - offset.z
      }
    }
  })
}

/** An instance's items, in document order, which is the definition's. */
const itemsOf = ({ ids, map }: DocParts, group: GroupNode): ReadonlyArray<Item> => {
  const inside = new Set(treeKeys([group]))
  return ids.flatMap((key, index) => {
    const item = inside.has(key) ? map.items[index] : undefined
    return item === undefined ? [] : [item]
  })
}

/** How many items the fit tries an anchor on. One is enough for an instance nobody edited. */
const ANCHORS = 8

/** Where an instance's items sit, as near as they say, and whether they are what was placed. */
interface InstanceCheck {
  readonly placement: Placement
  readonly unmodified: boolean
}

const centreOf = (transforms: ReadonlyArray<UeTransform>): Vec3 => {
  const n = transforms.length || 1
  const sum = transforms.reduce(
    (total, { translation: t }) => ({ x: total.x + t.x, y: total.y + t.y, z: total.z + t.z }),
    ORIGIN
  )
  return { x: sum.x / n, y: sum.y / n, z: sum.z / n }
}

/**
 * Fits the items an instance holds to what its link says was placed. Every item matching means an unedited instance. An
 * edited one takes the placement most of its items agree on, so an Update leaves it about where it was.
 */
export const checkInstance = (doc: DocParts, group: GroupNode, link: PrefabLink): InstanceCheck => {
  const items = itemsOf(doc, group)
  const expected = link.items.map(parseSignature)
  const transforms = items.map(editTransform)
  const sameClass = (index: number) => {
    const item = items[index]
    return item !== undefined && classNameOf(item.actorToSpawn) === expected[index]?.className
  }
  const candidates = expected.slice(0, ANCHORS).flatMap(({ transform }, index) => {
    const actual = transforms[index]
    return actual === undefined || !sameClass(index) ? [] : placementsFrom(transform, actual)
  })
  const agreeing = (placement: Placement) =>
    expected.filter(({ transform }, index) => {
      const actual = transforms[index]
      return actual !== undefined && sameClass(index) && agrees(placement, transform, actual)
    }).length
  const scored = candidates.map((placement) => ({ placement, count: agreeing(placement) }))
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
  const [from, to] = [centreOf(expected.map(({ transform }) => transform)), centreOf(transforms)]
  return {
    placement: {
      translation: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
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

/** Every instance in `nodes`, however deep. */
export const instancesIn = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<GroupNode & { prefab: PrefabLink }> =>
  nodes.flatMap((node) => {
    if (node.kind === "item") return []
    const inside = instancesIn(node.children)
    return node.prefab === undefined ? inside : [{ ...node, prefab: node.prefab }, ...inside]
  })

/**
 * The instance `groupId` with its items replaced by `definition`'s, where its placement puts them. The items that stay
 * the same class keep their keys, so their names, tags and places in nested groups stay too. Its link moves on to
 * `definition`, and an item it gained joins the end of the group.
 */
export const withUpdatedInstance = (
  doc: DocParts,
  groupId: string,
  definition: PrefabDefinition
): DocParts | undefined => {
  const group = findGroup(doc.structure.tree, groupId)
  if (group?.prefab === undefined) return undefined
  const { placement } = checkInstance(doc, group, group.prefab)
  const fresh = definition.items.map((item) => placedItem(item, placement))
  const inside = new Set(treeKeys([group]))
  const indices = doc.ids.flatMap((key, index) => inside.has(key) ? [index] : [])
  const items = [...doc.map.items]
  const ids = [...doc.ids]
  /** Each key that gives way to a new item of another class, and what takes its place. */
  const swapped = new Map<string, string>()
  const swappedIndices = new Set<number>()
  indices.forEach((index, n) => {
    const item = fresh[n]
    const key = ids[index]
    if (item === undefined || key === undefined) return
    if (items[index]?.actorToSpawn !== item.actorToSpawn) {
      const next = freshKey()
      swapped.set(key, next)
      swappedIndices.add(index)
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
      pivots: doc.map.editorState.pivots.filter(({ itemIndex }) => !swappedIndices.has(itemIndex))
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
