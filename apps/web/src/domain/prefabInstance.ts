/**
 * Prefab instances in a document (docs/DESKTOP.md § Prefabs): a group whose `prefab` link names the definition it was
 * placed from. An instance follows its definition while its items still match what was placed, allowing for its own
 * placement and its overrides: moving, turning or scaling the whole group doesn't count as an edit, and a member's own
 * move, paint, property edit or hiding is recorded on the link as an override (`withRecordedOverrides`), which an Update keeps.
 */
import type { PrefabRef } from "@ballest/contracts"
import type { CatalogIndex } from "./Catalog"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { removeItems } from "./edits"
import { editTransform, SCALE_PROPERTIES, withEditTransform } from "./editTransform"
import { classNameOf, type Item, objectPathOf, PropertyList } from "./MapFile"
import type { GroupNode, MemberOverride, PrefabLink, TreeNode } from "./MapSidecar"
import { isSamePrefab, itemOfPrefab } from "./prefab"
import type { PrefabFile } from "./PrefabFile"
import {
  type Doc,
  findGroup,
  freshKey,
  freshKeys,
  indexOfKey,
  itemNode,
  rewriteTree,
  treeKeys,
  withoutJointsOf,
  withPrefabLink
} from "./structure"
import { SURFACE_PROPERTY } from "./surface"
import { ORIGIN, quatConjugate, quatMul, quatNormalize, rotateVec, vecAdd, vecSub } from "./ueMath"
import { withFlag } from "./visibility"

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
  /**
   * Each item's offset is this times its own, along the item's own axes: `scale` for a scale as the game does it, 1 for
   * one that leaves the offsets, as the editor's did.
   */
  readonly spread: Vec3
}

const ONE: Vec3 = { x: 1, y: 1, z: 1 }

const times = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z })

/**
 * `t`'s offset spread along its own axes. A turn of the whole instance can't change this, so it's taken before one. With
 * no spread it's the offset as it stands: a signature's rounded rotation wouldn't quite turn it there and back.
 */
const spreadOffset = (spread: Vec3, t: UeTransform): Vec3 =>
  spread === ONE
    ? t.translation
    : rotateVec(t.rotation, times(spread, rotateVec(quatConjugate(t.rotation), t.translation)))

const placed = (placement: Placement, t: UeTransform): UeTransform => ({
  translation: vecAdd(placement.translation, rotateVec(placement.rotation, spreadOffset(placement.spread, t))),
  rotation: quatNormalize(quatMul(placement.rotation, t.rotation)),
  scale3D: times(placement.scale, t.scale3D)
})

const over = (a: Vec3, b: Vec3): Vec3 => ({
  x: b.x === 0 ? a.x : a.x / b.x,
  y: b.y === 0 ? a.y : a.y / b.y,
  z: b.z === 0 ? a.z : a.z / b.z
})

/** Where the definition would have `t` for `placement` to put it there: `placed` the other way. */
const localOf = (placement: Placement, t: UeTransform): UeTransform => {
  const turn = quatConjugate(placement.rotation)
  const rotation = quatNormalize(quatMul(turn, t.rotation))
  const offset = rotateVec(turn, vecSub(t.translation, placement.translation))
  return {
    translation: placement.spread === ONE
      ? offset
      : rotateVec(rotation, over(rotateVec(quatConjugate(rotation), offset), placement.spread)),
    rotation,
    scale3D: over(t.scale3D, placement.scale)
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
  const scaled = [scale.x, scale.y, scale.z].some((axis) => !near(axis, 1, TOLERANCE.scale))
  return (scaled ? [ONE, scale] : [ONE]).map((spread) => ({
    rotation,
    scale,
    spread,
    translation: vecSub(actual.translation, rotateVec(rotation, spreadOffset(spread, expected)))
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

/** What a member can override, in the order they are named. */
const OVERRIDE_FIELDS = ["transform", "paint", "properties", "hidden"] as const
export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

/** An instance's overrides by member. */
const overridesOf = (link: PrefabLink): ReadonlyMap<number, MemberOverride> =>
  new Map((link.overrides ?? []).map((override) => [override.member, override]))

/**
 * Fits the items an instance holds to what its link says was placed, a member whose transform is an override where
 * that puts it. Every item matching means an instance that follows its definition. An edited one takes the placement
 * most of its items agree on, so an Update leaves it about where it was. `strays` are the members, by place in the
 * definition, that the fit leaves out of line.
 */
export const checkInstance = (
  doc: Doc,
  group: GroupNode,
  link: PrefabLink
): { readonly placement: Placement; readonly unmodified: boolean; readonly strays: ReadonlySet<number> } => {
  const items = indicesOf(doc, group).flatMap((index) => doc.map.items[index] ?? [])
  const expected = link.items.map(parseSignature)
  const overrides = overridesOf(link)
  const transforms = items.map(editTransform)
  // the items still of the class they were placed as
  const kept = expected.flatMap(({ className, transform }, index) => {
    const item = items[index]
    const actual = transforms[index]
    return item === undefined || actual === undefined || classNameOf(item.actorToSpawn) !== className
      ? []
      : [{ index, transform: overrides.get(index)?.transform ?? transform, actual }]
  })
  const sameClasses = items.length === expected.length && kept.length === expected.length
  const anchors = kept.slice(0, ANCHORS)
  const scored = anchors.flatMap(({ actual, transform }) => placementsFrom(transform, actual)).map((placement) => {
    const agreeing = new Set(
      kept.flatMap(({ actual, index, transform }) => agrees(placement, transform, actual) ? [index] : [])
    )
    return { placement, agreeing }
  })
  const best = scored.reduce<typeof scored[number] | undefined>(
    (top, next) => top === undefined || next.agreeing.size > top.agreeing.size ? next : top,
    undefined
  )
  // a member's paint or properties of its own, and its digest says nothing of the rest
  const sameContent = items.every((item, index) => {
    const override = overrides.get(index)
    return override?.paint === true || override?.properties === true || contentOf(item) === expected[index]?.content
  })
  if (best !== undefined) {
    return {
      placement: best.placement,
      unmodified: sameClasses && best.agreeing.size === kept.length && sameContent,
      strays: new Set(kept.flatMap(({ index }) => best.agreeing.has(index) ? [] : [index]))
    }
  }
  return {
    placement: {
      translation: vecSub(centreOf(transforms), centreOf(expected.map(({ transform }) => transform))),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: ONE,
      spread: ONE
    },
    unmodified: false,
    strays: new Set()
  }
}

/** Each document's instances' origins, since the gizmo asks every frame. */
const origins = new WeakMap<Doc, Map<string, Vec3 | undefined>>()

/**
 * Where an instance's offsets count from, undefined once it no longer follows its definition, overrides aside. It's
 * where the game's frame would be: a prefab's offsets are from the frame, and spawning keeps them
 * (docs/qa/groups-prefabs.md). A scale has to be about this point, or one along an axis of members turned differently
 * is no longer a placement of the definition.
 */
export const instanceOrigin = (doc: Doc, group: GroupNode, link: PrefabLink): Vec3 | undefined => {
  const known = origins.get(doc) ?? new Map<string, Vec3 | undefined>()
  origins.set(doc, known)
  if (known.has(group.id)) return known.get(group.id)
  const { placement, unmodified } = checkInstance(doc, group, link)
  const origin = unmodified ? placement.translation : undefined
  known.set(group.id, origin)
  return origin
}

/** `item` where `placement` puts `t`, a transform in the instance's frame. */
const placedAs = (item: Item, placement: Placement, t: UeTransform): Item => {
  const { rotation, scale3D, translation } = placed(placement, t)
  return withEditTransform(item, {
    rotation: { ...rotation },
    scale3D: { ...scale3D },
    translation: { ...translation }
  }, ORIGIN)
}

const placedItem = (item: Item, placement: Placement): Item => placedAs(item, placement, editTransform(item))

export const instancesIn = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<GroupNode & { prefab: PrefabLink }> =>
  nodes.flatMap((node) => {
    if (node.kind === "item") return []
    const inside = instancesIn(node.children)
    return node.prefab === undefined ? inside : [{ ...node, prefab: node.prefab }, ...inside]
  })

/** The instances of `ref` under `nodes`. */
export const instancesOfPrefab = (nodes: ReadonlyArray<TreeNode>, ref: PrefabRef) =>
  instancesIn(nodes).filter(({ prefab }) => isSamePrefab(prefab, ref))

const surfacePropertiesOf = (item: Item) =>
  item.intProperties.filter(({ propertyName }) => propertyName === SURFACE_PROPERTY)

/**
 * `fresh`, a definition's member where `placement` puts it, with what the instance's member `was` overrode: its own
 * transform in the instance's frame, and its paint.
 */
const withOverride = (fresh: Item, was: Item, override: MemberOverride, placement: Placement): Item => {
  const own = override.properties === true ? withPropertiesOf(fresh, was) : fresh
  const moved = override.transform === undefined
    ? own
    : placedAs(own, placement, override.transform)
  return override.paint === true
    ? {
      ...moved,
      meshComponents: was.meshComponents,
      intProperties: [
        ...moved.intProperties.filter(({ propertyName }) => propertyName !== SURFACE_PROPERTY),
        ...surfacePropertiesOf(was)
      ]
    }
    : moved
}

/** Whether a property is one of an item's own, not its transform's (a decal's size) or its paint's (its surface). */
const isOwnProperty = (name: string) => !SCALE_PROPERTIES.has(name) && name !== SURFACE_PROPERTY

/** `own`'s own properties, then `rest`'s others. */
const mergedProperties = <P extends { readonly propertyName: string }>(
  own: ReadonlyArray<P>,
  rest: ReadonlyArray<P>
): ReadonlyArray<P> => [
  ...own.filter(({ propertyName }) => isOwnProperty(propertyName)),
  ...rest.filter(({ propertyName }) => !isOwnProperty(propertyName))
]

/** `fresh` with `was`'s own properties in place of its own, its size and surface kept. */
const withPropertiesOf = (fresh: Item, was: Item): Item => ({
  ...fresh,
  boolProperties: mergedProperties(was.boolProperties, fresh.boolProperties),
  floatProperties: mergedProperties(was.floatProperties, fresh.floatProperties),
  intProperties: mergedProperties(was.intProperties, fresh.intProperties),
  textProperties: mergedProperties(was.textProperties, fresh.textProperties),
  nameProperties: mergedProperties(was.nameProperties, fresh.nameProperties),
  stringProperties: mergedProperties(was.stringProperties, fresh.stringProperties)
})

/** An item's own properties, in an order edits can't change. */
const ownPropertiesOf = (item: Item): string =>
  PropertyList.literals.flatMap((list) =>
    item[list].flatMap(({ currentValue, propertyName }) =>
      isOwnProperty(propertyName) ? [`${propertyName}=${JSON.stringify(currentValue)}`] : []
    )
  ).sort().join("|")

/** Whether an edit changed an item's paint: its meshes' materials, or its surface. */
const paintChanged = (before: Item, after: Item) =>
  (before.meshComponents !== after.meshComponents &&
    JSON.stringify(before.meshComponents) !== JSON.stringify(after.meshComponents)) ||
  JSON.stringify(surfacePropertiesOf(before)) !== JSON.stringify(surfacePropertiesOf(after))

const sameTransform = (a: UeTransform, b: UeTransform) =>
  a.translation.x === b.translation.x && a.translation.y === b.translation.y && a.translation.z === b.translation.z &&
  a.rotation.x === b.rotation.x && a.rotation.y === b.rotation.y && a.rotation.z === b.rotation.z &&
  a.rotation.w === b.rotation.w && a.scale3D.x === b.scale3D.x && a.scale3D.y === b.scale3D.y &&
  a.scale3D.z === b.scale3D.z

/** An instance's members' keys, by place in the definition (document order). */
const memberKeysOf = (doc: Doc, group: GroupNode) => indicesOf(doc, group).map((index) => doc.ids[index] ?? "")

/** A member's overrides but the one it is changing; nothing left drops the entry. */
type OverrideFields = Omit<MemberOverride, "member">

/**
 * `link` with what one edit, from `before` to `after`, changed of instance `group`'s members (`previous` before it)
 * recorded as overrides. A member that moved while another stayed put, even one already moved on its own, moved on its
 * own, and keeps where it is in the instance's frame; when every member moved, the instance did, and the ones out of
 * line with the rest moved on their own too. Paint, properties and hidden are a member's own whatever moves.
 */
const recordedLink = (
  before: Doc,
  previous: GroupNode,
  after: Doc,
  group: GroupNode,
  link: PrefabLink,
  keys: ReadonlyArray<string>
) => {
  const overrides = new Map(overridesOf(link))
  const change = (member: number, edit: (was: OverrideFields) => OverrideFields) => {
    const { member: _, ...was } = overrides.get(member) ?? { member }
    const next = edit(was)
    if (OVERRIDE_FIELDS.every((field) => next[field] === undefined)) overrides.delete(member)
    else overrides.set(member, { member, ...next })
  }
  const itemAt = (doc: Doc, key: string) => doc.map.items[indexOfKey(doc.ids, key)]
  const moved = keys.flatMap((key, member) => {
    const was = itemAt(before, key)
    const now = itemAt(after, key)
    return was !== now && was !== undefined && now !== undefined &&
        !sameTransform(editTransform(was), editTransform(now))
      ? [member]
      : []
  })
  if (moved.length > 0) {
    const whole = moved.length === keys.length
    // the members that stayed put still stand where the instance did
    const { placement, strays } = whole ? checkInstance(after, group, link) : checkInstance(before, previous, link)
    for (const member of whole ? strays : moved) {
      const now = itemAt(after, keys[member] ?? "")
      if (now !== undefined) change(member, (was) => ({ ...was, transform: localOf(placement, editTransform(now)) }))
    }
  }
  keys.forEach((key, member) => {
    const was = itemAt(before, key)
    const now = itemAt(after, key)
    if (was !== undefined && now !== undefined && was !== now) {
      if (paintChanged(was, now)) change(member, (fields) => ({ ...fields, paint: true }))
      if (ownPropertiesOf(was) !== ownPropertiesOf(now)) change(member, (fields) => ({ ...fields, properties: true }))
    }
    const hidden = after.structure.items.get(key)?.hidden === true
    if (hidden !== (overrides.get(member)?.hidden === true)) {
      change(member, ({ hidden: _gone, ...fields }) => hidden ? { ...fields, hidden: true } : fields)
    }
  })
  const list = [...overrides.values()].sort((a, b) => a.member - b.member)
  const same = list.length === (link.overrides?.length ?? 0) &&
    list.every((override, n) => override === link.overrides?.[n])
  if (same) return link
  const { overrides: _old, ...rest } = link
  return list.length === 0 ? rest : { ...rest, overrides: list }
}

/** The instances an edit from `before` to `after` kept, linked as they were, with their members' keys then and now. */
const keptInstances = (before: Doc, after: Doc) =>
  instancesIn(after.structure.tree).flatMap((group) => {
    const previous = findGroup(before.structure.tree, group.id)
    return previous === undefined || previous.prefab !== group.prefab
      ? []
      : [{ group, previous, keys: memberKeysOf(after, group), was: memberKeysOf(before, previous) }]
  })

/**
 * `after`, an edit of `before`, with what it changed of each instance's members recorded on the instance's link as
 * overrides (docs/DESKTOP.md § Prefabs): a member's own move, its paint, its other properties and whether it is hidden. An instance the
 * edit placed, gave other members or relinked is left as it is.
 */
export const withRecordedOverrides = (before: Doc, after: Doc): Doc => {
  if (before.map.items === after.map.items && before.structure.items === after.structure.items) return after
  let structure = after.structure
  for (const { group, keys, previous, was } of keptInstances(before, after)) {
    if (keys.length !== was.length || keys.some((key, n) => key !== was[n])) continue
    const link = recordedLink(before, previous, after, group, group.prefab, keys)
    if (link !== group.prefab) structure = withPrefabLink(structure, group.id, link) ?? structure
  }
  return structure === after.structure ? after : { ...after, structure }
}

/**
 * The instances an edit from `before` to `after` gave members or took them from, which it would make plain groups
 * (docs/DESKTOP.md § Prefabs). One the edit removed whole, or relinked, isn't among them.
 */
export const reshapedInstances = (before: Doc, after: Doc): ReadonlyArray<GroupNode & { prefab: PrefabLink }> =>
  before.structure.tree === after.structure.tree ? [] : keptInstances(before, after).flatMap(({ group, keys, was }) => {
    const then = new Set(was)
    return keys.length === was.length && keys.every((key) => then.has(key)) ? [] : [group]
  })

/** `doc` with instances `groupIds` made plain groups, their items and the rest of the structure as they are. */
export const withUnlinked = (doc: Doc, groupIds: ReadonlyArray<string>): Doc => {
  const structure = groupIds.reduce((current, id) => withPrefabLink(current, id, undefined) ?? current, doc.structure)
  return structure === doc.structure ? doc : { ...doc, structure }
}

/**
 * The instance `groupId` with its items replaced by `definition`'s, where its placement puts them. The items that stay
 * the same class keep their keys, so their names, tags and places in nested groups stay too. Its link moves on to
 * `definition`, and an item it gained joins the end of the group. Its members' overrides carry over, but for those of
 * the members in `reset`, by place in the definition.
 */
export const withUpdatedInstance = (
  doc: Doc,
  groupId: string,
  definition: PrefabDefinition,
  reset: ReadonlySet<number> = new Set()
): Doc | undefined => {
  const group = findGroup(doc.structure.tree, groupId)
  if (group?.prefab === undefined) return undefined
  const { placement } = checkInstance(doc, group, group.prefab)
  const indices = indicesOf(doc, group)
  const overrides = overridesOf(group.prefab)
  /** The overrides that carry over: a member that gives way to another class is another piece. */
  const carried: Array<MemberOverride> = []
  const fresh = definition.items.map((item, n) => {
    const placedOne = placedItem(item, placement)
    const was = doc.map.items[indices[n] ?? -1]
    const override = reset.has(n) ? undefined : overrides.get(n)
    if (was === undefined || override === undefined || was.actorToSpawn !== item.actorToSpawn) return placedOne
    carried.push(override)
    return withOverride(placedOne, was, override, placement)
  })
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
        ? [{
          ...node,
          prefab: carried.length === 0 ? definition.link : { ...definition.link, overrides: carried },
          children: [...node.children, ...addedKeys.map(itemNode)]
        }]
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
      ...withoutJointsOf(doc.structure, new Set([...gone, ...swapped.keys()])),
      tree,
      items: new Map([...doc.structure.items].filter(([key]) => !gone.has(key) && !swapped.has(key)))
    }
  }
}

/** A member of an instance that carries overrides: its instance, its place in the definition and what it overrides. */
export interface OverriddenMember {
  readonly groupId: string
  readonly member: number
  readonly fields: ReadonlyArray<OverrideField>
}

/** Each document's overridden members, since the Outline asks for every row. */
const overridden = new WeakMap<Doc, ReadonlyMap<string, OverriddenMember>>()

/** The members of `doc`'s instances that carry overrides, by key (docs/DESKTOP.md § Prefabs). */
export const overriddenMembers = (doc: Doc): ReadonlyMap<string, OverriddenMember> => {
  const known = overridden.get(doc)
  if (known !== undefined) return known
  const found = new Map<string, OverriddenMember>()
  for (const group of instancesIn(doc.structure.tree)) {
    if (group.prefab.overrides === undefined) continue
    const keys = memberKeysOf(doc, group)
    for (const override of group.prefab.overrides) {
      const key = keys[override.member]
      const fields = OVERRIDE_FIELDS.filter((field) => override[field] !== undefined)
      if (key !== undefined) found.set(key, { groupId: group.id, member: override.member, fields })
    }
  }
  overridden.set(doc, found)
  return found
}

/** What the Outline and the Inspector say a member overrides: "transform and paint". */
export const overrideSummary = (fields: ReadonlyArray<OverrideField>): string =>
  fields.length < 2 ? fields.join("") : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`

/** `overrideSummary` for item `key` of `members`; undefined for one with no overrides. */
export const overriddenSummaryOf = (
  members: ReadonlyMap<string, OverriddenMember>,
  key: string
): string | undefined => {
  const fields = members.get(key)?.fields
  return fields === undefined ? undefined : overrideSummary(fields)
}

/**
 * Reset override: instance `groupId`'s `members`, by place in the definition, or all of them when undefined, put back as
 * `definition` has them, where the instance stands, and shown; the other members keep their overrides. Undefined for a
 * group that isn't an instance.
 */
export const withResetMembers = (
  doc: Doc,
  groupId: string,
  members: ReadonlyArray<number> | undefined,
  definition: PrefabDefinition
): Doc | undefined => {
  const group = findGroup(doc.structure.tree, groupId)
  if (group?.prefab === undefined) return undefined
  const overrides = overridesOf(group.prefab)
  const chosen = members ?? [...overrides.keys()]
  const keys = memberKeysOf(doc, group)
  const updated = withUpdatedInstance(doc, groupId, definition, new Set(chosen))
  if (updated === undefined) return undefined
  const shown = chosen.flatMap((member) => overrides.get(member)?.hidden === true ? keys.slice(member, member + 1) : [])
  const structure = withFlag(updated.structure, shown, "hidden", false)
  return structure === undefined ? updated : { ...updated, structure }
}
