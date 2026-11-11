/**
 * Units: what the pivot setting treats as one thing (docs/design/pivot-modes-and-chains.md § Units). A unit is a node
 * the selection makes up (`selectedNodes`): an item at the click level, or a group whole in the selection. Every unit
 * has a pivot and axes: an item's own pivot and rotation; a group's pivot choice (`GroupNode.pivot`, the centre of its
 * items' box by default) with no turn of its own, or the chosen member's; a prefab instance's definition origin; a
 * chain's first link's.
 *
 * Together, the game's rule, puts every item through one edit about the active unit's pivot. Each puts every unit
 * through the edit about its own, and a chain unit bends: it passes a turn down its links so it accumulates (§ Chains).
 * A chain on its own has a setting of its own, Rigid or link by link (`ChainMode`), which picks between the two for it.
 */
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { identityTransform } from "./factory"
import { selectedNodes } from "./groupSelection"
import { applyGroupDelta, clampScale, forUnit, type GroupDelta, scaleAbout } from "./groupTransform"
import type { Box } from "./itemBounds"
import { boxCentreOf } from "./itemBounds"
import type { ChainGrowth, GroupNode, GroupPivotFace, TreeNode } from "./MapSidecar"
import { localToWorld } from "./pivot"
import { findGroup, idOf, rewriteTree, type Structure, treeKeys } from "./structure"
import {
  IDENTITY_QUAT,
  ORIGIN,
  quatBetween,
  quatConjugate,
  quatDot,
  quatFromAxisAngle,
  quatMul,
  quatNormalize,
  quatPow,
  rotateVec,
  sameVec,
  squareTo,
  vecAdd,
  vecDot,
  vecLength,
  vecScale,
  vecSub
} from "./ueMath"

export type PivotMode = "together" | "each"

/**
 * How a chain on its own takes an edit (`isChainSelection`): whole, as Together moves a group, or link by link, as Each
 * passes it down the links, so a turn bends it, a move spreads it and a scale stretches it.
 */
export type ChainMode = "rigid" | "links"

/** The two settings an edit is applied by: one for a chain on its own, one for any other selection. */
export interface PivotSettings {
  readonly pivotMode: PivotMode
  readonly chainMode: ChainMode
}

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
  /** A chain's growth, when it has one. */
  readonly growth?: ChainGrowth
  /**
   * The item whose transform the unit takes as its own: an item itself, the member a group pivots on, a chain's first
   * link's. None for a group's frame at its pivot, which is world-aligned and scale 1.
   */
  readonly anchor?: string
}

/** What a unit is made from: the tree and how to read each item as it stands (the document, or a live edit). */
export interface UnitContext {
  readonly tree: ReadonlyArray<TreeNode>
  readonly transformOf: (key: string) => UeTransform | undefined
  /** An item's own pivot, local and unscaled. */
  readonly localPivotOf: (key: string) => Vec3
  /**
   * The box around items as `transformOf` places them: square to the world, or with `frame` square to it and in its
   * coordinates (`placedBoxOf`).
   */
  readonly boxOf: (keys: ReadonlyArray<string>, frame?: Quat4) => Box | undefined
  /** A prefab instance's origin as it stands now; undefined for a group that isn't one, or one that was edited. */
  readonly instanceOriginOf: (group: GroupNode) => Vec3 | undefined
  /**
   * Where a Point pivot at `world` stands while a live edit has `keys` where they are: it follows what `withCarriedPoints`
   * will move it by for good, a move of them all alike or a landing. Just `world` for the document itself.
   */
  readonly livePointOf: (keys: ReadonlyArray<string>, world: Vec3) => Vec3
  /**
   * A group's turn while a live edit has `keys` where they are: it follows what `withCarriedFrames` will turn it by for
   * good, a rigid motion of them all. Just `rotation` for the document itself.
   */
  readonly liveRotationOf: (keys: ReadonlyArray<string>, rotation: Quat4 | undefined) => Quat4 | undefined
}

/**
 * A group's frame: its box square to its own turn (`GroupNode.rotation`), as a world centre, that turn, and the box's
 * half-size along each of its axes. What the group's box is drawn as, its Centre and face pivots sit on, and its gizmo's
 * Local axes follow.
 */
export interface GroupFrame {
  readonly origin: Vec3
  readonly rotation: Quat4
  readonly halfExtents: Vec3
}

/** `box`, measured in `rotation`'s coordinates (`placedBoxOf` with a frame), as a frame in the world. */
export const frameOfBox = (box: Box, rotation: Quat4): GroupFrame => ({
  origin: rotateVec(rotation, boxCentreOf(box)),
  rotation,
  halfExtents: vecScale(vecSub(box.max, box.min), 0.5)
})

/**
 * The frame of a group with items `keys` and turn `rotation` (absent: the world's axes): the box around them square to
 * that turn. Undefined when none of them can be measured.
 */
export const groupFrameOf = (
  keys: ReadonlyArray<string>,
  rotation: Quat4 | undefined,
  boxOf: UnitContext["boxOf"]
): GroupFrame | undefined => {
  const turn = rotation ?? IDENTITY_QUAT
  const box = boxOf(keys, turn)
  return box === undefined ? undefined : frameOfBox(box, turn)
}

/** The eight corners of `frame` in the world; a corner's bits say which side it takes along x, y and z. */
export const frameCornersOf = ({ halfExtents: h, origin, rotation }: GroupFrame): ReadonlyArray<Vec3> =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((corner) =>
    vecAdd(
      origin,
      rotateVec(rotation, { x: corner & 1 ? h.x : -h.x, y: corner & 2 ? h.y : -h.y, z: corner & 4 ? h.z : -h.z })
    )
  )

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
    transform,
    anchor: key
  }
}

/** A group's frame at `pivot`: its own turn, scale 1. */
const frameAt = (pivot: Vec3, rotation: Quat4): UeTransform => ({ ...identityTransform(pivot), rotation })

/**
 * The pivot a group's choice names, and the axes that go with it; undefined when nothing can be measured. Every choice
 * but Item turns with the group: a face or the Centre sits on its box square to its turn, and the axes are that turn.
 */
const groupPivotOf = (
  group: GroupNode,
  keys: ReadonlyArray<string>,
  ctx: UnitContext
): Pick<Unit, "pivot" | "transform" | "anchor"> | undefined => {
  const choice = group.pivot
  if (choice?.choice === "item") {
    const item = keys.includes(choice.key) ? itemUnit(choice.key, ctx) : undefined
    if (item !== undefined) return { pivot: item.pivot, transform: item.transform, anchor: choice.key }
  }
  const rotation = ctx.liveRotationOf(keys, group.rotation) ?? IDENTITY_QUAT
  if (choice?.choice === "point") {
    const world = ctx.livePointOf(keys, choice.world)
    return { pivot: world, transform: frameAt(world, rotation) }
  }
  const box = ctx.boxOf(keys, rotation)
  if (box === undefined) return undefined
  const local = choice === undefined || choice.choice === "item" ? boxCentreOf(box) : faceOf(box, choice.choice)
  const pivot = rotateVec(rotation, local)
  return { pivot, transform: frameAt(pivot, rotation) }
}

/** The unit a node is; undefined when none of its items can be read. */
export const unitOf = (node: TreeNode, ctx: UnitContext): Unit | undefined => {
  if (node.kind === "item") return itemUnit(node.key, ctx)
  const keys = treeKeys([node]).filter((key) => ctx.transformOf(key) !== undefined)
  if (keys.length === 0) return undefined
  const origin = ctx.instanceOriginOf(node)
  if (origin !== undefined) {
    const rotation = ctx.liveRotationOf(keys, node.rotation) ?? IDENTITY_QUAT
    return { id: node.id, keys, pivot: origin, transform: frameAt(origin, rotation) }
  }
  if (node.chain === true) {
    const links = node.children.flatMap((child) => unitOf(child, ctx) ?? [])
    const [root] = links
    if (root === undefined) return undefined
    return {
      id: node.id,
      keys,
      pivot: root.pivot,
      transform: root.transform,
      links,
      ...(node.growth !== undefined && { growth: node.growth }),
      ...(root.anchor !== undefined && { anchor: root.anchor })
    }
  }
  const placed = groupPivotOf(node, keys, ctx)
  return placed === undefined ? undefined : { id: node.id, keys, ...placed }
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * An order that walks `points` as a path, each to the nearest one left: how a chain's links are ordered when it is
 * made, so they follow the pieces as they lie rather than the order they were placed or selected in. It starts at
 * `root` when that is an end of the path, else at the end nearer to it.
 */
export const pathOrder = (points: ReadonlyArray<Vec3>, root = 0): ReadonlyArray<number> => {
  const start = points[root]
  if (start === undefined) return [...points.keys()]
  const walk = (from: number, at: Vec3): ReadonlyArray<number> => {
    const order = [from]
    const left = new Map(points.entries())
    left.delete(from)
    let last = at
    for (;;) {
      let next: [number, Vec3] | undefined
      for (const entry of left) {
        if (next === undefined || distance(entry[1], last) < distance(next[1], last)) next = entry
      }
      if (next === undefined) return order
      order.push(next[0])
      left.delete(next[0])
      last = next[1]
    }
  }
  // walking from anywhere ends at an end; walking back from there covers the path end to end
  const end = walk(root, start).at(-1) ?? root
  const path = walk(end, points[end] ?? start)
  const [first = root, last = root] = [path[0], path.at(-1)]
  if (first === root) return path
  if (last === root) return path.toReversed()
  const near = (i: number) => distance(points[i] ?? start, start)
  return near(first) <= near(last) ? path : path.toReversed()
}

/** The units a selection makes up, and how they relate. */
export interface SelectionUnits {
  /** In tree order. */
  readonly units: ReadonlyArray<Unit>
  /**
   * The unit holding the active (last selected) item: where the gizmo sits and what its axes follow, in Together and
   * Each alike. For loose items it is the active item, as the game pivots several pieces (docs/qa/gizmo-scale.md); for
   * a whole group, the group's frame.
   */
  readonly active: Unit
  /**
   * When the entered group is a chain: its links in order, selected or not, so a selected link carries the links after
   * it (§ Chains).
   */
  readonly chain?: ReadonlyArray<Unit>
  /** The entered chain's growth, when it has one. */
  readonly growth?: ChainGrowth
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
  if (active === undefined) return undefined
  const entered = enteredGroupId === null ? undefined : findGroup(ctx.tree, enteredGroupId)
  if (entered?.chain !== true) return { units, active }
  const selected = new Set(nodes.map(idOf))
  const chain = entered.children.flatMap((child) => {
    const unit = units.find((u) => u.id === idOf(child))
    return unit ?? unitOf(child, ctx) ?? []
  })
  if (!chain.some((link) => selected.has(link.id))) return { units, active }
  return { units, active, chain, ...(entered.growth !== undefined && { growth: entered.growth }) }
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

/**
 * The first link an edit in Each runs from inside an entered chain: the first selected. The pass takes the edit as that
 * link does, so the gizmo sits on it.
 */
const passHeadOf = ({ chain, units }: SelectionUnits): Unit | undefined => {
  const selected = new Set(units.map((unit) => unit.id))
  return chain?.find((link) => selected.has(link.id))
}

/**
 * The unit an edit by `mode` is measured on, and the gizmo sits on: the active unit, or in Each inside an entered chain
 * the first selected link, which the pass runs from.
 */
export const pivotUnitOf = (selection: SelectionUnits, mode: PivotMode): Unit =>
  effectivePivotMode(mode, selection) === "each" ? passHeadOf(selection) ?? selection.active : selection.active

/**
 * The effective mode: Each needs two or more units, one chain of two or more links, or a link inside an entered chain;
 * else a selection is Together whatever the setting holds.
 */
export const effectivePivotMode = (mode: PivotMode, selection: SelectionUnits | undefined): PivotMode =>
  mode === "each" && selection !== undefined && canEach(selection) ? "each" : "together"

/** Whether Each does anything to `selection`: two or more units, a chain alone that can bend, or a link inside one. */
export const canEach = (selection: SelectionUnits): boolean => {
  const [first, second] = selection.units
  return second !== undefined || selection.chain !== undefined || (first?.links?.length ?? 0) >= 2
}

/**
 * Whether the chain setting decides how `selection` takes an edit: one whole chain of two or more links, or links
 * selected inside an entered chain. A chain among other units follows the pivot setting.
 */
export const isChainSelection = (selection: SelectionUnits): boolean => {
  const [first, second] = selection.units
  return selection.chain !== undefined || (second === undefined && (first?.links?.length ?? 0) >= 2)
}

/** The mode an edit of `selection` is applied by: the chain setting for a chain on its own, the pivot setting else. */
export const pivotModeFor = (settings: PivotSettings, selection: SelectionUnits): PivotMode =>
  isChainSelection(selection) ? (settings.chainMode === "links" ? "each" : "together") : settings.pivotMode

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

/** How far link `i` turns when a chain bends, as a share of the first bending link's turn (`ChainGrowth`). */
export const growthOf = (growth: ChainGrowth | undefined, i: number): number => {
  if (growth === undefined) return 1
  return growth.curve === "linear" ? 1 + i * growth.percent / 100 : Math.max(0, 1 + growth.percent / 100) ** i
}

/**
 * A chain bending by `q`, the turn its first link takes (docs/design/pivot-modes-and-chains.md § Chains). The turn is
 * read in that link's own axes, and every link takes it in its own axes as the links before it left them, grown by
 * `growth`, about its own moved pivot. So a turn accumulates down the chain, every joint of a curve takes the same turn
 * whichever axes the gizmo showed, and a second bend of a curved chain winds it into a helix instead of kinking it.
 */
const bend = (
  out: Map<string, UeTransform>,
  links: ReadonlyArray<Unit>,
  q: Quat4,
  transforms: ReadonlyMap<string, UeTransform>,
  growth: ChainGrowth | undefined
) => {
  const [head] = links
  if (head === undefined) return
  const axes = head.transform.rotation
  const local = quatMul(quatMul(quatConjugate(axes), q), axes)
  let carried = IDENTITY
  links.forEach((link, i) => {
    const moved = rigidUnit(carried, link)
    const frame = moved.transform.rotation
    const own = quatNormalize(quatMul(quatMul(frame, quatPow(local, growthOf(growth, i))), quatConjugate(frame)))
    const motion = compose({ q: own, t: vecSub(moved.pivot, rotateVec(own, moved.pivot)) }, carried)
    applyTo(out, link.keys, transforms, (t) => rigidTransform(motion, t))
    carried = motion
  })
}

/**
 * A shape a chain is laid along (`layChain`, docs/design/pivot-modes-and-chains.md § Laying a chain): straight along
 * the way its first link points, or a helix about a world axis.
 */
export type ChainShape =
  | { readonly kind: "straight" }
  | {
    readonly kind: "helix"
    /** The world axis it winds about, a unit vector. */
    readonly axis: Vec3
    /** How far each link turns about the axis from the one before, in degrees. */
    readonly turn: number
    /** How far each link climbs along the axis from the one before, in centimetres. */
    readonly rise: number
  }

/**
 * Where a helix starts: the straight chain's axes tipped toward `axis` until a step of `length` along `direction`
 * climbs `rise`. `length` is the chain's mean step, so links of one length climb it exactly. A rise at or past the
 * length stands the chain along the axis.
 */
const tippedToward = (axes: Quat4, direction: Vec3, length: number, axis: Vec3, rise: number): Quat4 => {
  const flat = vecSub(direction, vecScale(axis, vecDot(direction, axis)))
  const outward = vecLength(flat) < 1e-6 ? squareTo(axis) : vecScale(flat, 1 / vecLength(flat))
  const climb = Math.max(-1, Math.min(1, rise / length))
  const tipped = vecAdd(vecScale(outward, Math.sqrt(1 - climb * climb)), vecScale(axis, climb))
  return quatMul(quatBetween(direction, tipped), axes)
}

/**
 * A chain's links laid along `shape` from its first link, which stays where it is. Each link keeps its step to the next
 * in its own axes, the one thing a bend leaves alone, so the chain is straightened first: every link takes the first
 * link's axes, and the steps line up along the way it points. Straight stops there. A helix then tips the chain toward
 * its axis until each step climbs the rise, and turns every joint the turn about the axis, grown by `growth` like a
 * bend: a constant joint turn about a fixed axis with a constant climb is a helix about that axis, and with no rise a
 * flat ring square to it. No edits for a chain of fewer than two links, or with no length.
 */
export const layChain = (
  links: ReadonlyArray<Unit>,
  shape: ChainShape,
  transforms: ReadonlyMap<string, UeTransform>,
  growth: ChainGrowth | undefined
): ReadonlyMap<string, UeTransform> => {
  const out = new Map<string, UeTransform>()
  const [head] = links
  if (head === undefined) return out
  const steps = links.slice(1).flatMap((next, i) => {
    const link = links[i]
    return link === undefined
      ? []
      : [rotateVec(quatConjugate(link.transform.rotation), vecSub(next.pivot, link.pivot))]
  })
  if (steps.length === 0) return out
  const axes = head.transform.rotation
  const along = steps.reduce((sum, step) => vecAdd(sum, rotateVec(axes, step)), ORIGIN)
  const length = vecLength(along) / steps.length
  if (length < 1e-6) return out
  const direction = vecScale(along, 1 / vecLength(along))
  const { axis, start, turn } = shape.kind === "straight"
    ? { axis: direction, start: axes, turn: 0 }
    : {
      axis: shape.axis,
      start: tippedToward(axes, direction, length, shape.axis, shape.rise),
      turn: shape.turn * Math.PI / 180
    }
  let pivot = head.pivot
  let turned = 0
  links.forEach((link, i) => {
    const rotation = quatNormalize(quatMul(quatFromAxisAngle(axis, turned), start))
    const q = quatNormalize(quatMul(rotation, quatConjugate(link.transform.rotation)))
    const motion = { q, t: vecSub(pivot, rotateVec(q, link.pivot)) }
    applyTo(out, link.keys, transforms, (t) => rigidTransform(motion, t))
    const step = steps[i]
    if (step !== undefined) pivot = vecAdd(pivot, rotateVec(rotation, step))
    turned += turn * growthOf(growth, i)
  })
  return out
}

/** `a` times `b`, axis by axis. */
const vecMul = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z })

/** How much an item's scale changed from `before` to `after`, axis by axis in its own axes. */
const scaleRatio = (before: UeTransform, after: UeTransform): Vec3 => {
  const along = (axis: "x" | "y" | "z") => before.scale3D[axis] === 0 ? 1 : after.scale3D[axis] / before.scale3D[axis]
  return { x: along("x"), y: along("y"), z: along("z") }
}

/** Where `point`, held by an item at `before`, is once the item is at `after`. */
const heldPoint = (before: UeTransform, after: UeTransform, point: Vec3): Vec3 => {
  const local = rotateVec(quatConjugate(before.rotation), vecSub(point, before.translation))
  return vecAdd(after.translation, rotateVec(after.rotation, vecMul(local, scaleRatio(before, after))))
}

/**
 * Pushes the links after link `from` so every joint still meets once a scale has resized links in `out`: a link's step
 * to the next, read in its own axes, grows or shrinks with it. The next link's pivot is where the joint is, as for a
 * bend (§ Chains), so a chain whose pivots sit at its joints stays closed exactly.
 */
const keepJoints = (
  out: Map<string, UeTransform>,
  links: ReadonlyArray<Unit>,
  from: number,
  transforms: ReadonlyMap<string, UeTransform>
) => {
  const placed = (link: Unit) => {
    const [key] = link.keys
    const before = key === undefined ? undefined : transforms.get(key)
    if (before === undefined) return undefined
    const after = out.get(key ?? "") ?? before
    return { before, after, pivot: heldPoint(before, after, link.pivot) }
  }
  let at = links[from] === undefined ? undefined : placed(links[from])?.pivot
  for (let k = from; k + 1 < links.length && at !== undefined; k++) {
    const link = links[k]
    const next = links[k + 1]
    const own = link === undefined ? undefined : placed(link)
    const now = next === undefined ? undefined : placed(next)
    if (link === undefined || next === undefined || own === undefined || now === undefined) return
    // in the axes of the item the scale ratio is read off, which a group link's own axes needn't be
    const axes = own.before.rotation
    const step = rotateVec(quatConjugate(axes), vecSub(next.pivot, link.pivot))
    const joint = vecAdd(at, rotateVec(axes, vecMul(step, scaleRatio(own.before, own.after))))
    const shift = vecSub(joint, now.pivot)
    if (vecLength(shift) > 1e-9) {
      applyTo(out, next.keys, transforms, (t) => ({ ...t, translation: vecAdd(t.translation, shift) }))
    }
    at = joint
  }
}

/** `r` to the power `k`, keeping its sign: a mirror stays one. */
const signedPow = (r: number, k: number) => Math.sign(r) * Math.abs(r) ** k

/**
 * A chain scaled in Each from link `from` to its end: each link by the scale the edit gives the first, in its own
 * axes about its own pivot, grown by `growth` as a power, and the links after pushed so every joint still meets.
 */
const scaleDown = (
  out: Map<string, UeTransform>,
  links: ReadonlyArray<Unit>,
  from: number,
  ratio: Vec3,
  transforms: ReadonlyMap<string, UeTransform>,
  growth: ChainGrowth | undefined
) => {
  links.slice(from).forEach((link, i) => {
    const g = growthOf(growth, i)
    const factor = { x: signedPow(ratio.x, g), y: signedPow(ratio.y, g), z: signedPow(ratio.z, g) }
    applyTo(out, link.keys, transforms, (t) => {
      const scaled = vecMul(t.scale3D, factor)
      return scaleAbout(t, { x: clampScale(scaled.x), y: clampScale(scaled.y), z: clampScale(scaled.z) }, link.pivot)
    })
  })
  keepJoints(out, links, from, transforms)
}

/**
 * A chain moved in Each from link `from` to its end: each link moves by the move from the link before it, so the
 * moves add up down the chain the way a bend's turns do, grown by `growth`. The first link takes the move as the gizmo
 * shows it, and every link after takes it in the axes of the link before, its parent, read as the first link reads it.
 * So a drag along a chain opens every joint alike, along a curve too, and a drag up a pile stacks it.
 */
const moveDown = (
  out: Map<string, UeTransform>,
  links: ReadonlyArray<Unit>,
  from: number,
  offset: Vec3,
  transforms: ReadonlyMap<string, UeTransform>,
  growth: ChainGrowth | undefined
) => {
  const head = links[from]
  if (head === undefined) return
  const local = rotateVec(quatConjugate(head.transform.rotation), offset)
  let moved = ORIGIN
  links.slice(from).forEach((link, i) => {
    const parent = i === 0 ? head : links[from + i - 1] ?? head
    moved = vecAdd(moved, vecScale(rotateVec(parent.transform.rotation, local), growthOf(growth, i)))
    const by = moved
    applyTo(out, link.keys, transforms, (t) => ({ ...t, translation: vecAdd(t.translation, by) }))
  })
}

/**
 * The pass down a chain in Each, from the first selected link to its end, selected or not, as the edit takes that
 * link. A turn bends it (`bend`), a move adds up down it (`moveDown`), and a scale resizes every link and keeps the joints
 * meeting (`scaleDown`); growth grows each, link by link.
 */
const chainPass = (
  out: Map<string, UeTransform>,
  links: ReadonlyArray<Unit>,
  selected: (link: Unit) => boolean,
  transforms: ReadonlyMap<string, UeTransform>,
  edit: UnitEdit,
  growth: ChainGrowth | undefined
) => {
  const from = links.findIndex(selected)
  const head = links[from]
  if (head === undefined) return
  const f = edit(head)
  const motion = motionOf(f, head.pivot)
  if (motion === "move") {
    moveDown(out, links, from, vecSub(f(identityTransform(head.pivot)).translation, head.pivot), transforms, growth)
    return
  }
  if (motion !== undefined) {
    bend(out, links.slice(from), motion.q, transforms, growth)
    return
  }
  const [key] = head.keys
  const before = key === undefined ? undefined : transforms.get(key)
  if (before === undefined) return
  const ratio = scaleRatio(before, f(before))
  if (!nearVec(ratio, { x: 1, y: 1, z: 1 })) scaleDown(out, links, from, ratio, transforms, growth)
}

/** The items one motion of the whole selection takes: every unit's, and inside an entered chain the links it carries. */
export const carriedKeys = ({ chain, units }: SelectionUnits): ReadonlyArray<string> => {
  const selected = new Set(units.map((unit) => unit.id))
  const first = chain?.findIndex((link) => selected.has(link.id)) ?? -1
  const carried = chain === undefined || first < 0 ? [] : chain.slice(first).flatMap((link) => link.keys)
  return [...new Set([...carried, ...units.flatMap((unit) => unit.keys)])]
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
    // a move or turn of a link carries the links after it rigidly
    const carries = chain !== undefined && motionOf(f, unit.pivot) !== undefined
    applyTo(out, carries ? carriedKeys(selection) : units.flatMap((u) => u.keys), transforms, f)
    // a scale resizes the selected links, and the links after them follow so the joints meet
    const first = chain?.findIndex((link) => selected.has(link.id)) ?? -1
    if (chain !== undefined && first >= 0 && !carries) keepJoints(out, chain, first, transforms)
    return out
  }
  if (chain !== undefined) {
    chainPass(out, chain, (link) => selected.has(link.id), transforms, edit, selection.growth)
    return out
  }
  for (const unit of units) {
    if (unit.links !== undefined) chainPass(out, unit.links, () => true, transforms, edit, unit.growth)
    else applyTo(out, unit.keys, transforms, edit(unit))
  }
  return out
}

/**
 * `delta` through `applyUnitEdit`. A rigid landing is one motion of the whole selection whatever the setting: it puts the
 * active unit's base on a target, and a chain's pass would give the links after it the same motion a second time.
 */
export const applyDelta = (
  selection: SelectionUnits,
  mode: PivotMode,
  transforms: ReadonlyMap<string, UeTransform>,
  delta: GroupDelta
): ReadonlyMap<string, UeTransform> =>
  applyUnitEdit(selection, delta.kind === "rigid" ? "together" : mode, transforms, deltaEdit(delta))

/**
 * Each unit moved whole by its own offset, as Align and Distribute do. Inside an entered chain a selected link takes
 * exactly its offset, and the links after it follow by that offset as far as the next selected link.
 */
export const applyUnitOffsets = (
  { chain, units }: SelectionUnits,
  transforms: ReadonlyMap<string, UeTransform>,
  offsetOf: (unit: Unit) => Vec3
): ReadonlyMap<string, UeTransform> => {
  const out = new Map<string, UeTransform>()
  const move = (keys: ReadonlyArray<string>, by: Vec3) =>
    applyTo(out, keys, transforms, (t) => ({ ...t, translation: vecAdd(t.translation, by) }))
  const selected = new Map(units.map((unit) => [unit.id, unit]))
  let carried: Vec3 | undefined
  for (const link of chain ?? []) {
    const own = selected.get(link.id)
    if (own !== undefined) carried = offsetOf(own)
    if (carried !== undefined) move(link.keys, carried)
    selected.delete(link.id)
  }
  for (const unit of selected.values()) move(unit.keys, offsetOf(unit))
  return out
}

/** The items of a unit that take an edit in Each as the gizmo shows it: a chain's first link, since the links after it
 * take it more than once as it runs down; a plain unit's own. */
const leaderOf = (unit: Unit): ReadonlyArray<string> => unit.links?.[0]?.keys ?? unit.keys

/**
 * The items snapping measures an edit by `mode` on: those that take it as the gizmo shows it. In Together that is every
 * unit, and in Each only the active one, as the others go along their own axes or about their own pivots. A chain in
 * Each passes the edit down from its first link (inside an entered chain, the first selected), so that link alone
 * leads: the links after take it again and again. A link carried along inside an entered chain isn't one either.
 */
export const leadingKeys = (selection: SelectionUnits, mode: PivotMode): ReadonlyArray<string> => {
  if (effectivePivotMode(mode, selection) !== "each") return selection.units.flatMap((unit) => unit.keys)
  return passHeadOf(selection)?.keys ?? leaderOf(selection.active)
}

/**
 * The items that take a move along the world's axes as dragged, so any of them can lead it: every unit in Together, and
 * in Each every plain unit and a chain's first link (`leadingKeys`).
 */
export const movedAlikeKeys = (selection: SelectionUnits, mode: PivotMode): ReadonlyArray<string> =>
  effectivePivotMode(mode, selection) !== "each"
    ? selection.units.flatMap((unit) => unit.keys)
    : selection.chain === undefined
    ? selection.units.flatMap(leaderOf)
    : leadingKeys(selection, mode)

/** Whether a turn by `mode` runs down a chain, so the active unit can end up turned by more than the angle dragged. */
export const turnAccumulates = (selection: SelectionUnits, mode: PivotMode): boolean =>
  effectivePivotMode(mode, selection) === "each" &&
  (selection.chain !== undefined || selection.active.links !== undefined)

const EPSILON = 1e-6
const nearVec = (a: Vec3, b: Vec3) =>
  Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON && Math.abs(a.z - b.z) < EPSILON

/** A rigid motion of a group's items, and where it takes a point. */
export interface GroupMotion {
  /** The turn every item took. */
  readonly rotation: Quat4
  /** What a point of the world goes to. */
  readonly point: (world: Vec3) => Vec3
}

const POSITION_CM = 1e-3

/**
 * The one rigid motion an edit gave every one of `keys` from `before` to `after`: the same turn for each, the same
 * scale it had, and each place turned and moved alike. Undefined otherwise, or when nothing moved.
 */
export const commonMotionOf = (
  keys: ReadonlyArray<string>,
  before: (key: string) => UeTransform | undefined,
  after: (key: string) => UeTransform | undefined
): GroupMotion | undefined => {
  let motion: Rigid | undefined
  for (const key of keys) {
    const [from, to] = [before(key), after(key)]
    if (from === undefined || to === undefined || !nearVec(from.scale3D, to.scale3D)) return undefined
    const q = quatNormalize(quatMul(to.rotation, quatConjugate(from.rotation)))
    const t = vecSub(to.translation, rotateVec(q, from.translation))
    if (motion === undefined) motion = { q, t }
    else if (Math.abs(quatDot(q, motion.q)) < 1 - 1e-9 || vecLength(vecSub(t, motion.t)) > POSITION_CM) return undefined
  }
  if (motion === undefined) return undefined
  const { q, t } = motion
  const turned = Math.abs(1 - Math.abs(q.w)) > 1e-9
  if (!turned && vecLength(t) < EPSILON) return undefined
  const rotation = turned ? q : IDENTITY_QUAT
  return { rotation, point: (world) => vecAdd(rotateVec(rotation, world), t) }
}

/** `rotation` turned by `by`; absent when that leaves the world's axes, as a group starts. */
export const turnedBy = (rotation: Quat4 | undefined, by: Quat4): Quat4 | undefined => {
  const q = quatNormalize(quatMul(by, rotation ?? IDENTITY_QUAT))
  return Math.abs(1 - Math.abs(q.w)) < 1e-12 ? undefined : q
}

/** `group` with its turn `rotation`, or none. */
export const withGroupRotation = (group: GroupNode, rotation: Quat4 | undefined): GroupNode => {
  if (rotation !== undefined) return { ...group, rotation }
  if (group.rotation === undefined) return group
  const { rotation: _dropped, ...rest } = group
  return rest
}

/**
 * A group's frame rides along with every rigid motion of all its items (docs/design/pivot-modes-and-chains.md § Group
 * pivot): its turn takes the motion's turn, and a Point pivot goes where the motion takes it. A turn about the Point
 * leaves it put, since it is what the turn is about; a scale, or an edit of some members only, leaves both alone. `after`
 * is an edit about to be committed. `through` says the edit was one motion of the world, a landing or a reflection, and
 * where it takes a point: a group the edit took whole takes its Point there. Undefined when no group changes.
 */
export const withCarriedFrames = (
  structure: Structure,
  before: (key: string) => UeTransform | undefined,
  after: ReadonlyMap<string, UeTransform>,
  through?: (world: Vec3) => Vec3
): Structure | undefined => {
  const changed: Array<string> = []
  const tree = rewriteTree(structure.tree, (node) => {
    if (node.kind !== "group") return [node]
    const keys = treeKeys([node])
    const motion = keys.every((key) => after.has(key))
      ? commonMotionOf(keys, before, (key) => after.get(key))
      : undefined
    const whole = through !== undefined && keys.length > 0 && keys.every((key) => after.has(key))
    const point = node.pivot?.choice !== "point"
      ? undefined
      : whole
      ? through(node.pivot.world)
      : motion?.point(node.pivot.world)
    const turned = motion !== undefined && motion.rotation !== IDENTITY_QUAT
    if (point === undefined && !turned) return [node]
    changed.push(node.id)
    const pivoted: GroupNode = point === undefined ? node : { ...node, pivot: { choice: "point", world: point } }
    return [turned ? withGroupRotation(pivoted, turnedBy(node.rotation, motion.rotation)) : pivoted]
  })
  return changed.length > 0 ? { ...structure, tree } : undefined
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
