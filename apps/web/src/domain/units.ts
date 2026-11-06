/**
 * Units: what the pivot setting treats as one thing (docs/design/pivot-modes-and-chains.md § Units). A unit is a node
 * the selection makes up (`selectedNodes`): an item at the click level, or a group whole in the selection. Every unit
 * has a pivot and axes: an item's own pivot and rotation; a group's pivot choice (`GroupNode.pivot`, the centre of its
 * items' box by default) with no turn of its own, or the chosen member's; a prefab instance's definition origin; a
 * chain's first link's.
 *
 * Together, the game's rule, puts every item through one edit about the active unit's pivot. Each puts every unit
 * through the edit about its own, and a chain unit passes a turn down its links so it accumulates (§ Chains).
 */
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { identityTransform } from "./factory"
import { selectedNodes } from "./groupSelection"
import { applyGroupDelta, forUnit, type GroupDelta } from "./groupTransform"
import type { Box } from "./itemBounds"
import { boxCentreOf } from "./itemBounds"
import type { GroupNode, GroupPivot, GroupPivotFace, TreeNode } from "./MapSidecar"
import { localToWorld } from "./pivot"
import { findGroup, idOf, rewriteTree, type Structure, treeKeys } from "./structure"
import { ORIGIN, quatMul, quatNormalize, rotateVec, sameVec, vecAdd, vecSub } from "./ueMath"

export type PivotMode = "together" | "each"

export interface Unit {
  /** The node's id: an item's key or a group's id. */
  readonly id: string
  /** Every item in it. */
  readonly keys: ReadonlyArray<string>
  /** Where it turns and scales, in the world. */
  readonly pivot: Vec3
  /** Its axes, and what the Inspector's rows show: the item's transform, or a group's frame at its pivot. */
  readonly transform: UeTransform
  /** A chain's links in order, each a unit; a plain unit has none. */
  readonly links?: ReadonlyArray<Unit>
}

/** What a unit is made from: the tree and how to read each item as it stands (the document, or a live edit). */
export interface UnitContext {
  readonly tree: ReadonlyArray<TreeNode>
  readonly transformOf: (key: string) => UeTransform | undefined
  /** An item's own pivot, local and unscaled. */
  readonly localPivotOf: (key: string) => Vec3
  /** The world-aligned box around items as `transformOf` places them. */
  readonly boxOf: (keys: ReadonlyArray<string>) => Box | undefined
  /** A prefab instance's origin as it stands now; undefined for a group that isn't one, or one that was edited. */
  readonly instanceOriginOf: (group: GroupNode) => Vec3 | undefined
  /**
   * How far a live edit has moved every one of `keys` from the document, when it moved them all alike: what a Point
   * pivot follows during a drag, before `withCarriedPoints` moves it for good. Undefined for the document itself.
   */
  readonly liveOffsetOf: (keys: ReadonlyArray<string>) => Vec3 | undefined
}

const faceOf = (box: Box, face: GroupPivotFace): Vec3 => {
  const c = boxCentreOf(box)
  switch (face) {
    case "Bottom":
      return { ...c, z: box.min.z }
    case "Top":
      return { ...c, z: box.max.z }
    case "Left":
      return { ...c, y: box.min.y }
    case "Right":
      return { ...c, y: box.max.y }
    case "Back":
      return { ...c, x: box.max.x }
    case "Front":
      return { ...c, x: box.min.x }
  }
}

const itemUnit = (key: string, ctx: UnitContext): Unit | undefined => {
  const transform = ctx.transformOf(key)
  return transform === undefined ? undefined : {
    id: key,
    keys: [key],
    pivot: localToWorld(transform, ctx.localPivotOf(key)),
    transform
  }
}

/** The pivot `choice` names for a group, and the axes that go with it; undefined when nothing can be measured. */
const groupPivotOf = (
  keys: ReadonlyArray<string>,
  choice: GroupPivot | undefined,
  ctx: UnitContext
): Pick<Unit, "pivot" | "transform"> | undefined => {
  if (choice?.choice === "item") {
    const item = keys.includes(choice.key) ? itemUnit(choice.key, ctx) : undefined
    if (item !== undefined) return { pivot: item.pivot, transform: item.transform }
  }
  if (choice?.choice === "point") {
    const world = vecAdd(choice.world, ctx.liveOffsetOf(keys) ?? ORIGIN)
    return { pivot: world, transform: identityTransform(world) }
  }
  const box = ctx.boxOf(keys)
  if (box === undefined) return undefined
  const pivot = choice === undefined || choice.choice === "item" ? boxCentreOf(box) : faceOf(box, choice.choice)
  return { pivot, transform: identityTransform(pivot) }
}

/** The unit a node is; undefined when none of its items can be read. */
export const unitOf = (node: TreeNode, ctx: UnitContext): Unit | undefined => {
  if (node.kind === "item") return itemUnit(node.key, ctx)
  const keys = treeKeys([node]).filter((key) => ctx.transformOf(key) !== undefined)
  if (keys.length === 0) return undefined
  const origin = ctx.instanceOriginOf(node)
  if (origin !== undefined) return { id: node.id, keys, pivot: origin, transform: identityTransform(origin) }
  if (node.chain === true) {
    const links = node.children.flatMap((child) => unitOf(child, ctx) ?? [])
    const [root] = links
    if (root === undefined) return undefined
    return { id: node.id, keys, pivot: root.pivot, transform: root.transform, links }
  }
  const placed = groupPivotOf(keys, node.pivot, ctx)
  return placed === undefined ? undefined : { id: node.id, keys, ...placed }
}

/** The units a selection makes up, and how they relate. */
export interface SelectionUnits {
  /** In tree order. */
  readonly units: ReadonlyArray<Unit>
  /** The unit holding the active (last selected) item: where Each puts the gizmo. */
  readonly active: Unit
  /**
   * The active item on its own: where Together pivots when the selection is more than one unit, as the game does
   * (docs/qa/gizmo-scale.md); one whole group pivots on its own pivot.
   */
  readonly activeItem: Unit
  /**
   * When the entered group is a chain: its links in order, selected or not, so a selected link carries the links after
   * it (§ Chains).
   */
  readonly chain?: ReadonlyArray<Unit>
}

/** The selection as units; undefined when nothing selected can be read. `activeKey` is the last selected item. */
export const selectionUnitsOf = (
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null,
  ctx: UnitContext
): SelectionUnits | undefined => {
  const nodes = selectedNodes(ctx.tree, selectedIds, enteredGroupId)
  const units = nodes.flatMap((node) => unitOf(node, ctx) ?? [])
  const activeKey = selectedIds.findLast((id) => ctx.transformOf(id) !== undefined)
  const active = activeKey === undefined ? undefined : units.find((unit) => unit.keys.includes(activeKey))
  const activeItem = activeKey === undefined ? undefined : itemUnit(activeKey, ctx)
  if (active === undefined || activeItem === undefined) return undefined
  const entered = enteredGroupId === null ? undefined : findGroup(ctx.tree, enteredGroupId)
  if (entered?.chain !== true) return { units, active, activeItem }
  const selected = new Set(nodes.map(idOf))
  const chain = entered.children.flatMap((child) => {
    const unit = units.find((u) => u.id === idOf(child))
    return unit ?? unitOf(child, ctx) ?? []
  })
  return chain.some((link) => selected.has(link.id))
    ? { units, active, activeItem, chain }
    : { units, active, activeItem }
}

/** The items an edit of the selection can reach: its own, and inside an entered chain the links a selected one carries. */
export const reachableKeys = (
  tree: ReadonlyArray<TreeNode>,
  selectedIds: ReadonlyArray<string>,
  enteredGroupId: string | null
): ReadonlyArray<string> => {
  const entered = enteredGroupId === null ? undefined : findGroup(tree, enteredGroupId)
  return entered?.chain === true ? [...new Set([...selectedIds, ...treeKeys([entered])])] : selectedIds
}

/** The unit an edit by `mode` is measured on, and the gizmo sits on: the active unit in Each, the game's rule in Together. */
export const pivotUnitOf = (selection: SelectionUnits, mode: PivotMode): Unit =>
  effectivePivotMode(mode, selection) === "each" || selection.units.length === 1
    ? selection.active
    : selection.activeItem

/** The effective mode: Each needs two or more units, else a selection is Together whatever the setting holds. */
export const effectivePivotMode = (mode: PivotMode, selection: SelectionUnits | undefined): PivotMode =>
  mode === "each" && selection !== undefined && selection.units.length >= 2 ? "each" : "together"

/**
 * What an edit does to the items of one unit: a function of the unit (its pivot and axes) that maps each item's
 * transform from before the edit. A gizmo drag is `(unit) => (t) => applyGroupDelta(t, unit.pivot, forUnit(delta,
 * unit.transform.rotation))`; an Inspector edit is `selectionAxisEdit` about the unit.
 */
export type UnitEdit = (unit: Unit) => (t: UeTransform) => UeTransform

/** A gizmo delta as a unit edit, each unit about its own pivot and along its own axes. */
export const deltaEdit = (delta: GroupDelta): UnitEdit => (unit) => {
  const own = forUnit(delta, unit.transform.rotation)
  return (t) => applyGroupDelta(t, unit.pivot, own)
}

/** A rigid motion: `p' = q p + t`. What a link passes down to the links after it. */
interface Rigid {
  readonly q: Quat4
  readonly t: Vec3
}
const IDENTITY: Rigid = { q: { x: 0, y: 0, z: 0, w: 1 }, t: { x: 0, y: 0, z: 0 } }
const isIdentity = (a: Rigid) => a === IDENTITY
const rigidPoint = (a: Rigid, p: Vec3): Vec3 => vecAdd(rotateVec(a.q, p), a.t)
const rigidTransform = (a: Rigid, t: UeTransform): UeTransform =>
  isIdentity(a)
    ? t
    : { ...t, translation: rigidPoint(a, t.translation), rotation: quatNormalize(quatMul(a.q, t.rotation)) }
const rigidUnit = (a: Rigid, unit: Unit): Unit =>
  isIdentity(a) ? unit : { ...unit, pivot: rigidPoint(a, unit.pivot), transform: rigidTransform(a, unit.transform) }
/** `b` then `a`. */
const compose = (a: Rigid, b: Rigid): Rigid => ({ q: quatNormalize(quatMul(a.q, b.q)), t: rigidPoint(a, b.t) })

/**
 * The rigid motion `edit` gives a unit, read off a probe placed at its pivot with no turn: a turn about the pivot
 * leaves the pivot and turns the probe, a move moves it, and a scale about the pivot does neither.
 */
const motionOf = (edit: (t: UeTransform) => UeTransform, pivot: Vec3): Rigid | "move" | undefined => {
  const probe = edit(identityTransform(pivot))
  const q = probe.rotation
  const turned = Math.abs(1 - Math.abs(q.w)) > 1e-9
  if (!turned) return sameVec(probe.translation, pivot) ? undefined : "move"
  return { q, t: vecSub(probe.translation, rotateVec(q, pivot)) }
}

const applyTo = (
  out: Map<string, UeTransform>,
  keys: ReadonlyArray<string>,
  transforms: ReadonlyMap<string, UeTransform>,
  f: (t: UeTransform) => UeTransform
) => {
  for (const key of keys) {
    const t = out.get(key) ?? transforms.get(key)
    if (t !== undefined) out.set(key, f(t))
  }
}

/**
 * The pass down a chain (docs/design/pivot-modes-and-chains.md § Chains): each link is carried by the motion the links
 * before it made, then, if `selected`, takes the edit about its own moved pivot. A turn accumulates, so link k of a
 * chain turned θ ends up turned kθ. A move carries the links after the moved one by the same offset, once. A scale
 * stays with its link: it never reaches the next, so nothing shears.
 */
const chainPass = (
  out: Map<string, UeTransform>,
  links: ReadonlyArray<Unit>,
  selected: (link: Unit) => boolean,
  transforms: ReadonlyMap<string, UeTransform>,
  edit: UnitEdit
) => {
  let carried = IDENTITY
  for (const link of links) {
    const moved = rigidUnit(carried, link)
    if (!selected(link)) {
      if (!isIdentity(carried)) applyTo(out, link.keys, transforms, (t) => rigidTransform(carried, t))
      continue
    }
    const own = edit(moved)
    const motion = motionOf(own, moved.pivot)
    if (motion === "move") {
      // a move is the link's own, not on top of what an earlier moved link passed down
      const first = edit(link)
      applyTo(out, link.keys, transforms, first)
      const probe = first(identityTransform(link.pivot))
      carried = { q: IDENTITY.q, t: vecSub(probe.translation, link.pivot) }
      continue
    }
    applyTo(out, link.keys, transforms, (t) => own(rigidTransform(carried, t)))
    if (motion !== undefined) carried = compose(motion, carried)
  }
}

/**
 * Every selected item through `edit`, by `mode`: Together puts them all through the active unit's edit, so they move
 * as one; Each puts each unit through its own. Inside an entered chain a selected link carries the links after it.
 * Reads `transforms` (the items from before the edit) and never a live preview, so a drag's steps don't compound.
 */
export const applyUnitEdit = (
  selection: SelectionUnits,
  mode: PivotMode,
  transforms: ReadonlyMap<string, UeTransform>,
  edit: UnitEdit
): ReadonlyMap<string, UeTransform> => {
  const out = new Map<string, UeTransform>()
  const { chain, units } = selection
  const selected = new Set(units.map((unit) => unit.id))
  if (effectivePivotMode(mode, selection) === "together") {
    const unit = pivotUnitOf(selection, mode)
    const f = edit(unit)
    const first = chain?.findIndex((link) => selected.has(link.id)) ?? -1
    // a move or turn of a link carries the links after it; a scale stays with its link
    const carries = chain !== undefined && first >= 0 && motionOf(f, unit.pivot) !== undefined
    const keys = carries ? chain.slice(first).flatMap((link) => link.keys) : units.flatMap((u) => u.keys)
    applyTo(out, keys, transforms, f)
    return out
  }
  if (chain !== undefined) {
    chainPass(out, chain, (link) => selected.has(link.id), transforms, edit)
    return out
  }
  for (const unit of units) {
    if (unit.links !== undefined) chainPass(out, unit.links, () => true, transforms, edit)
    else applyTo(out, unit.keys, transforms, edit(unit))
  }
  return out
}

const EPSILON = 1e-6
const nearVec = (a: Vec3, b: Vec3) =>
  Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON && Math.abs(a.z - b.z) < EPSILON
const sameQuat = (a: Quat4, b: Quat4) =>
  Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON && Math.abs(a.z - b.z) < EPSILON &&
  Math.abs(a.w - b.w) < EPSILON

/**
 * A Point pivot moves with its group's own moves and is left alone by turns and scales, since it is what they are
 * about (docs/design/pivot-modes-and-chains.md § Group pivot). `after` is an edit about to be committed, and a group
 * whose every item it moved by one offset, with no turn or scale, takes its Point along. Undefined when no Point moves.
 */
/**
 * How far an edit moved every one of `keys` from `before` to `after`, when it moved them all by one offset with no turn
 * or scale: the one kind of edit a Point pivot follows. Undefined otherwise, or when nothing moved.
 */
export const commonMoveOf = (
  keys: ReadonlyArray<string>,
  before: (key: string) => UeTransform | undefined,
  after: (key: string) => UeTransform | undefined
): Vec3 | undefined => {
  let offset: Vec3 | undefined
  for (const key of keys) {
    const [from, to] = [before(key), after(key)]
    if (from === undefined || to === undefined) return undefined
    if (!sameQuat(from.rotation, to.rotation) || !nearVec(from.scale3D, to.scale3D)) return undefined
    const d = vecSub(to.translation, from.translation)
    if (offset === undefined) offset = d
    else if (!nearVec(offset, d)) return undefined
  }
  return offset === undefined || nearVec(offset, ORIGIN) ? undefined : offset
}

export const withCarriedPoints = (
  structure: Structure,
  before: (key: string) => UeTransform | undefined,
  after: ReadonlyMap<string, UeTransform>
): Structure | undefined => {
  const moved: Array<string> = []
  const tree = rewriteTree(structure.tree, (node) => {
    if (node.kind !== "group" || node.pivot?.choice !== "point") return [node]
    const offset = commonMoveOf(treeKeys([node]), before, (key) => after.get(key))
    if (offset === undefined) return [node]
    moved.push(node.id)
    return [{ ...node, pivot: { choice: "point", world: vecAdd(node.pivot.world, offset) } }]
  })
  return moved.length > 0 ? { ...structure, tree } : undefined
}

/** A dot to draw at a pivot: where, and whether it sits inside its unit's box, which draws it dotted (#82). */
export interface PivotDotSpec {
  readonly id: string
  readonly pivot: Vec3
  readonly inside: boolean
}

const insideBox = (p: Vec3, box: Box | undefined): boolean =>
  box !== undefined &&
  p.x > box.min.x && p.x < box.max.x && p.y > box.min.y && p.y < box.max.y && p.z > box.min.z && p.z < box.max.z

/** The dots a selection shows: one at the pivot in Together, one per unit in Each. */
export const pivotDotsOf = (
  selection: SelectionUnits,
  mode: PivotMode,
  boxOf: UnitContext["boxOf"]
): ReadonlyArray<PivotDotSpec> => {
  const units = effectivePivotMode(mode, selection) === "each" ? selection.units : [pivotUnitOf(selection, mode)]
  return units.map((unit) => ({ id: unit.id, pivot: unit.pivot, inside: insideBox(unit.pivot, boxOf(unit.keys)) }))
}
