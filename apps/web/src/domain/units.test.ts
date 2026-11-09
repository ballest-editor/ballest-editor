import { assert, describe, it } from "@effect/vitest"
import { assertVec } from "../test/vec"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { identityTransform } from "./factory"
import {
  applyGroupDelta,
  forUnit,
  type GroupDelta,
  landedPoint,
  readField,
  type RigidDelta,
  rotatorOffset,
  selectionAxisEdit
} from "./groupTransform"
import type { Box } from "./itemBounds"
import type { ChainGrowth, GroupNode, TreeNode } from "./MapSidecar"
import { localToWorld } from "./pivot"
import type { Structure } from "./structure"
import {
  ORIGIN,
  quatConjugate,
  quatDot,
  quatFromAxisAngle,
  quatMul,
  quatToRotator,
  rotateVec,
  rotatorToQuat,
  vecDot,
  vecLength,
  vecSub
} from "./ueMath"
import {
  applyDelta,
  applyUnitEdit,
  applyUnitOffsets,
  carriedKeys,
  type ChainShape,
  deltaEdit,
  effectivePivotMode,
  isChainSelection,
  layChain,
  leadingKeys,
  movedAlikeKeys,
  pathOrder,
  pivotDotsOf,
  pivotModeFor,
  pivotUnitOf,
  type SelectionUnits,
  selectionUnitsOf,
  turnAccumulates,
  type UnitContext,
  type UnitEdit,
  unitOf,
  withCarriedPoints
} from "./units"

/** A cube `half` cm each way of its origin, like the game's primitive cube at scale 1 is 500. */
const HALF = 500
const yawed = (yaw: number): Quat4 => rotatorToQuat({ roll: 0, pitch: 0, yaw })
const at = (x: number, y = 0, z = 0, yaw = 0): UeTransform => ({
  translation: { x, y, z },
  rotation: yawed(yaw),
  scale3D: { x: 1, y: 1, z: 1 }
})
const item = (key: string): TreeNode => ({ kind: "item", key })
const group = (id: string, children: ReadonlyArray<TreeNode>, extra: Partial<GroupNode> = {}): GroupNode => ({
  kind: "group",
  id,
  name: id,
  tags: [],
  children,
  ...extra
})

/** A context over `transforms`, with each item's own pivot from `pivots` (local, unscaled) and cube bounds. */
const contextOf = (
  tree: ReadonlyArray<TreeNode>,
  transforms: ReadonlyMap<string, UeTransform>,
  pivots: ReadonlyMap<string, Vec3> = new Map()
): UnitContext => ({
  tree,
  transformOf: (key) => transforms.get(key),
  localPivotOf: (key) => pivots.get(key) ?? ORIGIN,
  boxOf: (keys): Box | undefined => {
    let box: Box | undefined
    for (const key of keys) {
      const t = transforms.get(key)
      if (t === undefined) continue
      const corners = [-HALF, HALF].flatMap((x) =>
        [-HALF, HALF].flatMap((y) => [-HALF, HALF].map((z) => localToWorld(t, { x, y, z })))
      )
      for (const c of corners) {
        box = box === undefined ? { min: c, max: c } : {
          min: { x: Math.min(box.min.x, c.x), y: Math.min(box.min.y, c.y), z: Math.min(box.min.z, c.z) },
          max: { x: Math.max(box.max.x, c.x), y: Math.max(box.max.y, c.y), z: Math.max(box.max.z, c.z) }
        }
      }
    }
    return box
  },
  instanceOriginOf: () => undefined,
  livePointOf: (_, world) => world
})

const yawOf = (t: UeTransform) => quatToRotator(t.rotation).yaw
const turn = (yaw: number, frame?: Quat4): GroupDelta =>
  frame === undefined ? { kind: "rotate", rotation: yawed(yaw) } : { kind: "rotate", rotation: yawed(yaw), frame }
/** Where `p` lands after a turn of `yaw` degrees about `pivot` (game Z up, left-handed: +yaw takes +X toward +Y). */
const swung = (p: Vec3, pivot: Vec3, yaw: number): Vec3 => {
  const r = rotateVec(yawed(yaw), { x: p.x - pivot.x, y: p.y - pivot.y, z: p.z - pivot.z })
  return { x: pivot.x + r.x, y: pivot.y + r.y, z: pivot.z + r.z }
}

describe("units of a selection", () => {
  const transforms = new Map([["a", at(0)], ["b", at(2000)], ["c", at(4000)]])

  it("is one unit per node the selection makes up, at the item's own pivot or the group's centre", () => {
    const tree = [item("a"), group("g", [item("b"), item("c")])]
    const pivots = new Map([["a", { x: 0, y: 0, z: HALF }]])
    const sel = selectionUnitsOf(["a", "b", "c"], null, contextOf(tree, transforms, pivots))!
    assert.deepStrictEqual(sel.units.map((u) => u.id), ["a", "g"])
    assertVec(sel.units[0]!.pivot, { x: 0, y: 0, z: HALF }, "a's own pivot")
    assertVec(sel.units[1]!.pivot, { x: 3000, y: 0, z: 0 }, "g's centre")
    // the last selected item is c, inside g
    assert.strictEqual(sel.active.id, "g")
    assert.strictEqual(sel.activeItem.id, "c")
  })

  it("holds Together with fewer than two units, and pivots Together on the active item, as the game does", () => {
    const tree = [item("a"), group("g", [item("b"), item("c")])]
    const ctx = contextOf(tree, transforms)
    const one = selectionUnitsOf(["b", "c"], null, ctx)!
    assert.strictEqual(effectivePivotMode("each", one), "together")
    assert.strictEqual(pivotUnitOf(one, "each").id, "g", "one whole group pivots on itself")
    const two = selectionUnitsOf(["a", "b", "c"], null, ctx)!
    assert.strictEqual(effectivePivotMode("each", two), "each")
    assert.strictEqual(pivotUnitOf(two, "together").id, "c", "the active item, not its group")
    assert.strictEqual(pivotUnitOf(two, "each").id, "g")
  })

  it("puts a group's pivot on a face of its box, a member, or a frozen point", () => {
    const ctx = (pivot: GroupNode["pivot"]) =>
      contextOf(
        [group("g", [item("b"), item("c")], pivot === undefined ? {} : { pivot })],
        transforms,
        new Map([["c", { x: 0, y: 0, z: HALF }]])
      )
    const pivotOf = (pivot: GroupNode["pivot"]) => selectionUnitsOf(["b", "c"], null, ctx(pivot))!.active
    assertVec(pivotOf({ choice: "Top" }).pivot, { x: 3000, y: 0, z: HALF }, "top face")
    assertVec(pivotOf({ choice: "Front" }).pivot, { x: 1500, y: 0, z: 0 }, "front face (-X)")
    const byItem = pivotOf({ choice: "item", key: "c" })
    assertVec(byItem.pivot, { x: 4000, y: 0, z: HALF }, "c's own pivot")
    assert.deepStrictEqual(byItem.transform, transforms.get("c"), "and c's axes")
    assertVec(pivotOf({ choice: "point", world: { x: 1, y: 2, z: 3 } }).pivot, { x: 1, y: 2, z: 3 }, "point")
    // a live move of the whole group carries the point along
    const live = {
      ...ctx({ choice: "point", world: { x: 1, y: 2, z: 3 } }),
      livePointOf: (_: ReadonlyArray<string>, { x, y, z }: Vec3) => ({ x: x + 10, y, z })
    }
    assertVec(selectionUnitsOf(["b", "c"], null, live)!.active.pivot, { x: 11, y: 2, z: 3 }, "point, live")
    // a member the group doesn't hold falls back to the centre
    assertVec(pivotOf({ choice: "item", key: "a" }).pivot, { x: 3000, y: 0, z: 0 }, "unknown member")
  })

  it("pivots a chain on its first link, and a prefab instance on its origin", () => {
    const chain = group("g", [item("c"), item("b")], { chain: true })
    const sel = selectionUnitsOf(["b", "c"], null, contextOf([chain], transforms))!
    assertVec(sel.active.pivot, { x: 4000, y: 0, z: 0 }, "first link")
    assert.deepStrictEqual(sel.active.links?.map((l) => l.id), ["c", "b"])
    const ctx = {
      ...contextOf([group("g", [item("b"), item("c")])], transforms),
      instanceOriginOf: () => ({ x: 7, y: 8, z: 9 })
    }
    assertVec(selectionUnitsOf(["b", "c"], null, ctx)!.active.pivot, { x: 7, y: 8, z: 9 }, "instance origin")
  })
})

describe("a delta for another unit", () => {
  const offsetOf = (d: GroupDelta): Vec3 => (d.kind === "translate" ? d.offset : ORIGIN)

  it("is the same world move or turn without a frame, and the same local one with", () => {
    const frame = yawed(90)
    // +100 along the frame's +Y is +100 along its own +X... no: world (0, 100) is the turned frame's local (100, 0)
    const move: GroupDelta = { kind: "translate", offset: { x: 0, y: 100, z: 0 }, frame }
    assertVec(offsetOf(forUnit(move, yawed(0))), { x: 100, y: 0, z: 0 }, "local +X for an unturned unit")
    assertVec(offsetOf(forUnit(move, frame)), { x: 0, y: 100, z: 0 }, "the frame's own unit takes it as is")
    assertVec(
      offsetOf(forUnit({ kind: "translate", offset: { x: 0, y: 100, z: 0 } }, yawed(0))),
      { x: 0, y: 100, z: 0 },
      "world stays world"
    )
    // a yaw is about Z for every frame, so the local turn comes back the same world turn
    const own = forUnit(turn(30, frame), yawed(45))
    assert.strictEqual(own.kind, "rotate")
    if (own.kind === "rotate") {
      assertVec(rotateVec(own.rotation, { x: 1, y: 0, z: 0 }), rotateVec(yawed(30), { x: 1, y: 0, z: 0 }), "turn")
    }
  })
})

describe("Together and Each", () => {
  const transforms = new Map([["a", at(0)], ["b", at(2000, 0, 0, 90)]])
  const tree = [item("a"), item("b")]
  const pivots = new Map([["a", { x: HALF, y: 0, z: 0 }], ["b", { x: -HALF, y: 0, z: 0 }]])
  const sel = () => selectionUnitsOf(["a", "b"], null, contextOf(tree, transforms, pivots))!

  it("turns everything rigidly about the active pivot in Together, and each about its own in Each", () => {
    const together = applyUnitEdit(sel(), "together", transforms, deltaEdit(turn(90)))
    const bPivot = localToWorld(transforms.get("b")!, pivots.get("b")!) // b is active (last), turned 90: pivot at (2000, -500)
    assertVec(bPivot, { x: 2000, y: -500, z: 0 }, "b's pivot in the world")
    assertVec(together.get("a")!.translation, swung({ x: 0, y: 0, z: 0 }, bPivot, 90), "a swings about b's pivot")
    assertVec(together.get("b")!.translation, swung({ x: 2000, y: 0, z: 0 }, bPivot, 90), "b turns about its pivot")
    const each = applyUnitEdit(sel(), "each", transforms, deltaEdit(turn(90)))
    assertVec(each.get("a")!.translation, swung({ x: 0, y: 0, z: 0 }, { x: HALF, y: 0, z: 0 }, 90), "a about its own")
    assertVec(each.get("b")!.translation, swung({ x: 2000, y: 0, z: 0 }, bPivot, 90), "b about its own")
    assert.closeTo(yawOf(each.get("a")!), 90, 1e-6)
    assert.closeTo(yawOf(each.get("b")!), 180, 1e-6)
  })

  it("keeps the gap between two facing pivots under a scale in Each, which Together closes", () => {
    // an unturned b, so a's +X face (x 500) and b's -X face (x 1500) face each other across the gap
    const facing = new Map([["a", at(0)], ["b", at(2000)]])
    const faces = new Map([["a", { x: HALF, y: 0, z: 0 }], ["b", { x: -HALF, y: 0, z: 0 }]])
    const selection = selectionUnitsOf(["a", "b"], null, contextOf(tree, facing, faces))!
    const grow: GroupDelta = { kind: "scale", factor: 2, axis: "x" }
    const each = applyUnitEdit(selection, "each", facing, deltaEdit(grow))
    // the faces next to the gap stay: a's +X face at 500, b's -X face at 1500
    assertVec(each.get("a")!.translation, { x: -500, y: 0, z: 0 }, "a grows away from the gap")
    assertVec(each.get("b")!.translation, { x: 2500, y: 0, z: 0 }, "b grows away from the gap")
    const together = applyUnitEdit(selection, "together", facing, deltaEdit(grow))
    // about b's pivot (1500): a's offset of -1500 doubles, so a's +X face lands at -1000, far from b's
    assertVec(together.get("a")!.translation, { x: -1500, y: 0, z: 0 }, "a about b's pivot")
    assertVec(together.get("b")!.translation, { x: 2500, y: 0, z: 0 }, "b about its pivot")
  })

  it("moves each unit along its own axes for a local move in Each, and all the same way in Together", () => {
    const frame = transforms.get("b")!.rotation // b's axes, turned 90
    const alongB: GroupDelta = { kind: "translate", offset: rotateVec(frame, { x: 100, y: 0, z: 0 }), frame }
    const each = applyUnitEdit(sel(), "each", transforms, deltaEdit(alongB))
    assertVec(each.get("a")!.translation, { x: 100, y: 0, z: 0 }, "a along its own +X")
    assertVec(each.get("b")!.translation, { x: 2000, y: 100, z: 0 }, "b along its own +X, which is world +Y")
    const together = applyUnitEdit(sel(), "together", transforms, deltaEdit(alongB))
    assertVec(together.get("a")!.translation, { x: 0, y: 100, z: 0 }, "a along b's +X")
  })

  it("takes an Inspector edit the same way: a typed yaw turns each unit about its own pivot and axis in Each", () => {
    const edit: UnitEdit = (unit) =>
      selectionAxisEdit(unit.transform, "rotation", "z", { kind: "offset", by: 90 }, unit.pivot)
    const each = applyUnitEdit(sel(), "each", transforms, edit)
    const aPivot = localToWorld(transforms.get("a")!, pivots.get("a")!)
    assertVec(localToWorld(each.get("a")!, pivots.get("a")!), aPivot, "a's pivot stays")
    assert.closeTo(yawOf(each.get("a")!), 90, 1e-6)
    assert.closeTo(Math.abs(yawOf(each.get("b")!)), 180, 1e-6)
  })
})

describe("chains", () => {
  /** Five cubes in a row, a chain in that order. */
  const links = ["l1", "l2", "l3", "l4", "l5"]
  const transforms = new Map(links.map((key, i) => [key, at(i * 1000)]))
  const chain = group("chain", links.map(item), { chain: true })

  it("turns each link by the angle about its own moved pivot in Each, so the turns accumulate down the chain", () => {
    const withX = selectionUnitsOf(
      [...links, "x"],
      null,
      contextOf([chain, item("x")], new Map([...transforms, ["x", at(9000)]]))
    )!
    const out = applyUnitEdit(withX, "each", new Map([...transforms, ["x", at(9000)]]), deltaEdit(turn(10)))
    links.forEach((key, i) => assert.closeTo(yawOf(out.get(key)!), 10 * (i + 1), 1e-6, `${key} reads ${10 * (i + 1)}`))
    // link 2 swung about link 1's pivot by 10, then turned 10 more about its own moved pivot (which doesn't move it)
    assertVec(out.get("l2")!.translation, swung({ x: 1000, y: 0, z: 0 }, ORIGIN, 10), "link 2 carried by link 1")
    // link 3 was carried by 1 (10 about 0) and then by 2 (10 about 2's moved pivot)
    const l2 = swung({ x: 1000, y: 0, z: 0 }, ORIGIN, 10)
    assertVec(
      out.get("l3")!.translation,
      swung(swung({ x: 2000, y: 0, z: 0 }, ORIGIN, 10), l2, 10),
      "link 3 carried twice"
    )
    // the loose piece turns 10 about itself
    assert.closeTo(yawOf(out.get("x")!), 10, 1e-6)
  })

  it("bends a chain selected whole in Each, on its own, and turns it rigidly about its first link in Together", () => {
    const sel = selectionUnitsOf(links, null, contextOf([chain], transforms))!
    assert.strictEqual(effectivePivotMode("each", sel), "each", "a chain alone bends")
    const bent = applyUnitEdit(sel, "each", transforms, deltaEdit(turn(10)))
    links.forEach((key, i) => assert.closeTo(yawOf(bent.get(key)!), 10 * (i + 1), 1e-6, key))
    const rigid = applyUnitEdit(sel, "together", transforms, deltaEdit(turn(10)))
    links.forEach((key, i) => {
      assert.closeTo(yawOf(rigid.get(key)!), 10, 1e-6)
      assertVec(rigid.get(key)!.translation, swung({ x: i * 1000, y: 0, z: 0 }, ORIGIN, 10), key)
    })
    // a one-link chain is a piece, and a plain group alone is still held at Together
    const one = group("one", [item("l1")], { chain: true })
    assert.strictEqual(
      effectivePivotMode("each", selectionUnitsOf(["l1"], null, contextOf([one], transforms))),
      "together"
    )
    const plain = group("g", links.map(item))
    assert.strictEqual(
      effectivePivotMode("each", selectionUnitsOf(links, null, contextOf([plain], transforms))),
      "together"
    )
  })

  it("carries the links after a selected link inside an entered chain, and leaves those before it", () => {
    const sel = selectionUnitsOf(["l3"], "chain", contextOf([chain], transforms))!
    assert.isDefined(sel.chain)
    const out = applyUnitEdit(sel, "together", transforms, deltaEdit(turn(90)))
    assert.isUndefined(out.get("l1"))
    assert.isUndefined(out.get("l2"))
    assert.closeTo(yawOf(out.get("l3")!), 90, 1e-6)
    assertVec(out.get("l4")!.translation, swung({ x: 3000, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }, 90), "link 4 carried")
    assertVec(out.get("l5")!.translation, swung({ x: 4000, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }, 90), "link 5 carried")
    assert.closeTo(yawOf(out.get("l5")!), 90, 1e-6, "carried rigidly, so turned with it")
  })

  it("lets the chain setting decide a chain on its own, and the pivot setting anything else", () => {
    const ctx = contextOf([chain, item("x")], new Map([...transforms, ["x", at(9000)]]))
    const linksFirst = { pivotMode: "together", chainMode: "links" } as const
    const rigidEach = { pivotMode: "each", chainMode: "rigid" } as const
    const whole = selectionUnitsOf(links, null, ctx)!
    const inside = selectionUnitsOf(["l3"], "chain", ctx)!
    const mixed = selectionUnitsOf([...links, "x"], null, ctx)!
    assert.deepStrictEqual([whole, inside, mixed].map(isChainSelection), [true, true, false])
    assert.strictEqual(pivotModeFor(linksFirst, whole), "each")
    assert.strictEqual(pivotModeFor(rigidEach, whole), "together")
    assert.strictEqual(pivotModeFor(linksFirst, mixed), "together")
    assert.strictEqual(pivotModeFor(rigidEach, mixed), "each")
    // one link selected inside an entered chain bends from it to the end
    assert.strictEqual(effectivePivotMode(pivotModeFor(linksFirst, inside), inside), "each")
    const bent = applyUnitEdit(inside, "each", transforms, deltaEdit(turn(10)))
    assert.deepStrictEqual(
      links.map((key) => bent.has(key) ? Math.round(yawOf(bent.get(key)!)) : undefined),
      [undefined, undefined, 10, 20, 30]
    )
  })

  const xs = (out: ReadonlyMap<string, UeTransform>) => links.map((key) => out.get(key)?.translation.x)

  it("moves each link in Each by the move from the one before, from the first selected link to the end", () => {
    // l2 to the end: l1 stays where the chain starts
    const sel = selectionUnitsOf(["l2", "l3", "l4", "l5"], "chain", contextOf([chain], transforms))!
    const along = applyUnitEdit(
      sel,
      "each",
      transforms,
      deltaEdit({ kind: "translate", offset: { x: 50, y: 0, z: 0 } })
    )
    assert.deepStrictEqual(xs(along), [undefined, 1050, 2100, 3150, 4200], "every joint opens 50")
    const across = applyUnitEdit(
      sel,
      "each",
      transforms,
      deltaEdit({ kind: "translate", offset: { x: 0, y: 100, z: 0 } })
    )
    assert.deepStrictEqual(links.map((key) => across.get(key)?.translation.y), [undefined, 100, 200, 300, 400])
    // grown: linear 100% moves them 50, 100, 150, 200, 250 more than the one before
    const grown = group("chain", links.map(item), { chain: true, growth: { curve: "linear", percent: 100 } })
    const whole = selectionUnitsOf(links, null, contextOf([grown], transforms))!
    const spaced = applyUnitEdit(
      whole,
      "each",
      transforms,
      deltaEdit({ kind: "translate", offset: { x: 50, y: 0, z: 0 } })
    )
    assert.deepStrictEqual(xs(spaced), [50, 1150, 2300, 3500, 4750])
  })

  it("opens every joint of a curve along itself when the drag is along the first link", () => {
    const sel = (t: ReadonlyMap<string, UeTransform>) => selectionUnitsOf(links, null, contextOf([chain], t))!
    const arc = new Map([...transforms, ...applyUnitEdit(sel(transforms), "each", transforms, deltaEdit(turn(40)))])
    // along the first link's own X, as the gizmo in Local shows it
    const offset = rotateVec(arc.get("l1")!.rotation, { x: 50, y: 0, z: 0 })
    const out = applyUnitEdit(sel(arc), "each", arc, deltaEdit({ kind: "translate", offset }))
    for (const [from, to] of [["l1", "l2"], ["l2", "l3"], ["l3", "l4"], ["l4", "l5"]] as const) {
      const step = vecSub(out.get(to)!.translation, out.get(from)!.translation)
      const before = vecSub(arc.get(to)!.translation, arc.get(from)!.translation)
      assert.closeTo(vecLength(step), 1050, 1e-6, `${from} to ${to}`)
      assert.closeTo(vecDot(step, before) / (vecLength(step) * vecLength(before)), 1, 1e-9, "along itself")
    }
  })

  it("stacks links piled on one pivot along the drag", () => {
    const pile = new Map(links.map((key) => [key, at(0)]))
    const sel = selectionUnitsOf(links, null, contextOf([chain], pile))!
    const up = applyUnitEdit(sel, "each", pile, deltaEdit({ kind: "translate", offset: { x: 0, y: 0, z: 100 } }))
    assert.deepStrictEqual(links.map((key) => up.get(key)!.translation.z), [100, 200, 300, 400, 500])
    assert.deepStrictEqual(links.map((key) => up.get(key)!.translation.x), [0, 0, 0, 0, 0])
  })

  it("resizes a chain scaled in Each and keeps its joints meeting, and tapers it with growth", () => {
    const whole = (growth?: ChainGrowth) =>
      selectionUnitsOf(
        links,
        null,
        contextOf(
          [group("chain", links.map(item), { chain: true, ...(growth !== undefined && { growth }) })],
          transforms
        )
      )!
    const double = deltaEdit({ kind: "scale", factor: 2, axis: "x" })
    const even = applyUnitEdit(whole(), "each", transforms, double)
    assert.deepStrictEqual(links.map((key) => even.get(key)!.scale3D.x), [2, 2, 2, 2, 2])
    assert.deepStrictEqual(xs(even), [0, 2000, 4000, 6000, 8000])
    assert.strictEqual(even.get("l3")!.scale3D.y, 1, "along the axis dragged only")
    // linear 100%: the links take 2, 4, 8, 16, 32, and each step grows with the link it leaves
    const tapered = applyUnitEdit(whole({ curve: "linear", percent: 100 }), "each", transforms, double)
    assert.deepStrictEqual(links.map((key) => tapered.get(key)!.scale3D.x), [2, 4, 8, 16, 32])
    assert.deepStrictEqual(xs(tapered), [0, 2000, 6000, 14000, 30000])
    // across a bent chain, each step grows along its own link
    const arc = new Map([...transforms, ...applyUnitEdit(whole(), "each", transforms, deltaEdit(turn(90)))])
    const bent = applyUnitEdit(selectionUnitsOf(links, null, contextOf([chain], arc))!, "each", arc, double)
    for (const [from, to] of [["l1", "l2"], ["l2", "l3"]] as const) {
      const step = vecSub(bent.get(to)!.translation, bent.get(from)!.translation)
      assert.closeTo(vecLength(step), 2000, 1e-6, `${from} to ${to}`)
    }
  })

  it("keeps a group link's joints where its items grow, not along the group's own axes", () => {
    // each link a group of one item turned a quarter, so the items' X runs along the world's Y
    const keys = ["g1", "g2", "g3"]
    const turned = new Map(keys.map((key, i) => [`${key}i`, at(i * 1000, 0, 0, 90)]))
    const tree = [group("chain", keys.map((key) => group(key, [item(`${key}i`)])), { chain: true })]
    const sel = selectionUnitsOf(keys.map((key) => `${key}i`), null, contextOf(tree, turned))!
    const out = applyUnitEdit(sel, "each", turned, deltaEdit({ kind: "scale", factor: 2, axis: "x" }))
    keys.forEach((key, i) => {
      assert.closeTo(out.get(`${key}i`)!.scale3D.x, 2, 1e-9, key)
      assertVec(out.get(`${key}i`)!.translation, { x: i * 1000, y: 0, z: 0 }, `${key} stays: nothing grew along X`)
    })
  })

  it("sits the gizmo in Each inside an entered chain on the first selected link, which the pass runs from", () => {
    const sel = selectionUnitsOf(["l3", "l5"], "chain", contextOf([chain], transforms))!
    assert.strictEqual(pivotUnitOf(sel, "each").id, "l3")
    assert.strictEqual(pivotUnitOf(sel, "together").id, "l5", "Together keeps the game's rule")
    assert.deepStrictEqual(leadingKeys(sel, "each"), ["l3"])
  })

  it("carries the links after a link moved or turned in Together, and pushes them after a scale", () => {
    const sel = selectionUnitsOf(["l3"], "chain", contextOf([chain], transforms))!
    const move: GroupDelta = { kind: "translate", offset: { x: 0, y: 5, z: 0 } }
    const moved = applyUnitEdit(sel, "together", transforms, deltaEdit(move))
    assert.deepStrictEqual([...moved.keys()], ["l3", "l4", "l5"])
    const scaled = applyUnitEdit(sel, "together", transforms, deltaEdit({ kind: "scale", factor: 2 }))
    assert.strictEqual(scaled.get("l3")!.scale3D.x, 2)
    assert.deepStrictEqual(xs(scaled), [undefined, undefined, 2000, 4000, 5000], "the next joint meets")
    assert.strictEqual(scaled.get("l4")!.scale3D.x, 1, "and the links after keep their size")
  })

  it("moves each unit whole by its own offset, a selected link's being its own and passing to the links after it", () => {
    const by = (x: number): Vec3 => ({ x, y: 0, z: 0 })
    const moved = (sel: SelectionUnits, offsets: Readonly<Record<string, number>>) => {
      const out = applyUnitOffsets(sel, transforms, (unit) => by(offsets[unit.id] ?? 0))
      return new Map([...out].map(([key, t]) => [key, t.translation.x]))
    }
    const inside = selectionUnitsOf(["l2", "l4"], "chain", contextOf([chain], transforms))!
    assert.deepStrictEqual(
      moved(inside, { l2: 100, l4: 0 }),
      new Map([["l2", 1100], ["l3", 2100], ["l4", 3000], ["l5", 4000]]),
      "from the first selected link down, and l4 stays put"
    )
    const whole = selectionUnitsOf(links, null, contextOf([chain], transforms))!
    assert.strictEqual(moved(whole, { chain: 100 }).size, links.length, "a whole chain is one unit")
    assert.strictEqual(moved(whole, { chain: 100 }).get("l5"), 4100)
  })

  it("reaches the links a selected link carries, and every item of a whole unit", () => {
    const ctx = contextOf([chain], transforms)
    assert.sameMembers([...carriedKeys(selectionUnitsOf(["l3"], "chain", ctx)!)], ["l3", "l4", "l5"])
    assert.sameMembers([...carriedKeys(selectionUnitsOf(links, null, ctx)!)], [...links])
  })

  it("bends from the first selected link to the end in Each, selected or not", () => {
    // l3 alone is one unit, so Each needs a second: l5 selected too
    const sel = selectionUnitsOf(["l3", "l5"], "chain", contextOf([chain], transforms))!
    const out = applyUnitEdit(sel, "each", transforms, deltaEdit(turn(10)))
    assert.isUndefined(out.get("l1"))
    assert.isUndefined(out.get("l2"))
    for (const [key, yaw] of [["l3", 10], ["l4", 20], ["l5", 30]] as const) {
      assert.closeTo(yawOf(out.get(key)!), yaw, 1e-6, key)
    }
  })

  it("bends each link in its own axes as the first takes the turn, so a curve's joints all take the same turn", () => {
    const sel = (t: ReadonlyMap<string, UeTransform>) => selectionUnitsOf(links, null, contextOf([chain], t))!
    // an arc first, then a turn about world X: a fixed world axis would kink the arc into joints that differ
    const arc = new Map([...transforms, ...applyUnitEdit(sel(transforms), "each", transforms, deltaEdit(turn(30)))])
    const rolled = { kind: "rotate", rotation: rotatorToQuat({ roll: 20, pitch: 0, yaw: 0 }) } as const
    const out = applyUnitEdit(sel(arc), "each", arc, deltaEdit(rolled))
    const joint = (from: string, to: string) => {
      const [a, b] = [out.get(from)!, out.get(to)!]
      const back = quatConjugate(a.rotation)
      return { turn: quatMul(back, b.rotation), offset: rotateVec(back, vecSub(b.translation, a.translation)) }
    }
    const first = joint("l1", "l2")
    for (const [from, to] of [["l2", "l3"], ["l3", "l4"], ["l4", "l5"]] as const) {
      const next = joint(from, to)
      assertVec(next.offset, first.offset, `${from} to ${to}`)
      assert.closeTo(Math.abs(quatDot(next.turn, first.turn)), 1, 1e-9, `${from} to ${to} turns the same`)
    }
    // the first link takes the turn as the gizmo shows it
    const expected = quatMul(rolled.rotation, arc.get("l1")!.rotation)
    assert.closeTo(Math.abs(quatDot(out.get("l1")!.rotation, expected)), 1, 1e-9)
  })

  it("grows each link's turn by the chain's growth: by a share of the first turn, or compounding", () => {
    const sel = (growth: ChainGrowth) =>
      selectionUnitsOf(links, null, contextOf([group("chain", links.map(item), { chain: true, growth })], transforms))!
    const yaws = (growth: ChainGrowth) => {
      const out = applyUnitEdit(sel(growth), "each", transforms, deltaEdit(turn(10)))
      return links.map((key) => yawOf(out.get(key)!))
    }
    // linear 50%: the links turn 10, 15, 20, 25, 30 on their own
    yaws({ curve: "linear", percent: 50 }).forEach((yaw, i) => assert.closeTo(yaw, [10, 25, 45, 70, 100][i]!, 1e-6))
    // compound 100%: 10, 20, 40, 80, 160 on their own, which wraps the last one past 180
    yaws({ curve: "compound", percent: 100 }).forEach((yaw, i) => assert.closeTo(yaw, [10, 30, 70, 150, -50][i]!, 1e-6))
    // inside the chain it counts from the first bending link
    const entered = selectionUnitsOf(
      ["l4", "l5"],
      "chain",
      contextOf(
        [group("chain", links.map(item), { chain: true, growth: { curve: "linear", percent: 100 } })],
        transforms
      )
    )!
    const out = applyUnitEdit(entered, "each", transforms, deltaEdit(turn(10)))
    assert.closeTo(yawOf(out.get("l4")!), 10, 1e-6)
    assert.closeTo(yawOf(out.get("l5")!), 30, 1e-6)
  })
})

describe("laying a chain", () => {
  /** Five cubes in a row, 1000 apart, a chain in that order. */
  const links = ["l1", "l2", "l3", "l4", "l5"]
  const row = new Map(links.map((key, i) => [key, at(i * 1000)]))
  const Y: Vec3 = { x: 0, y: 1, z: 0 }
  const helix = (degrees: number, rise: number): ChainShape => ({ kind: "helix", axis: Y, turn: degrees, rise })
  const laid = (transforms: ReadonlyMap<string, UeTransform>, shape: ChainShape, growth?: ChainGrowth) => {
    const chain = group("chain", links.map(item), { chain: true, ...(growth !== undefined && { growth }) })
    const unit = unitOf(chain, contextOf([chain], transforms))!
    const out = layChain(unit.links!, shape, transforms, growth)
    return links.map((key) => out.get(key)!)
  }
  /** Each joint as the world sees it: how the next link turns from this one, and the step between their pivots. */
  const joints = (out: ReadonlyArray<UeTransform>) =>
    out.slice(1).map((next, i) => ({
      spin: quatMul(next.rotation, quatConjugate(out[i]!.rotation)),
      step: vecSub(next.translation, out[i]!.translation)
    }))
  const assertTurn = (q: Quat4, expected: Quat4, message: string) =>
    assert.closeTo(Math.abs(quatDot(q, expected)), 1, 1e-9, message)

  it("turns every joint about the world axis and climbs the rise, keeping the first link's pivot and the steps", () => {
    const out = laid(row, helix(72, 100))
    assertVec(out[0]!.translation, ORIGIN, "the first link stays")
    joints(out).forEach(({ spin, step }, i) => {
      assertTurn(spin, quatFromAxisAngle(Y, 72 * Math.PI / 180), `joint ${i} turns about Y`)
      assert.closeTo(vecDot(step, Y), 100, 1e-6, `joint ${i} climbs`)
      assert.closeTo(vecLength(step), 1000, 1e-6, `joint ${i} keeps its length`)
    })
  })

  it("lays a bent chain into the same helix, and a flat ring with no rise", () => {
    const bent = new Map([
      ...row,
      ...applyUnitEdit(
        selectionUnitsOf(links, null, contextOf([group("chain", links.map(item), { chain: true })], row))!,
        "each",
        row,
        deltaEdit({ kind: "rotate", rotation: rotatorToQuat({ roll: 20, pitch: 10, yaw: 30 }) })
      )
    ])
    // straightened from the first link the way it points now, so the same helix as from the row
    const out = laid(bent, helix(40, 250))
    assertVec(out[0]!.translation, ORIGIN, "the first link stays")
    joints(out).forEach(({ spin, step }, i) => {
      assertTurn(spin, quatFromAxisAngle(Y, 40 * Math.PI / 180), `joint ${i} turns about Y`)
      assert.closeTo(vecDot(step, Y), 250, 1e-6, `joint ${i} climbs`)
      assert.closeTo(vecLength(step), 1000, 1e-6, `joint ${i} keeps its length`)
    })
    for (const { step } of joints(laid(bent, helix(40, 0)))) assert.closeTo(vecDot(step, Y), 0, 1e-6)
  })

  it("grows each joint's turn by the chain's growth, and stays at the most a step can climb", () => {
    const grown = joints(laid(row, helix(10, 0), { curve: "linear", percent: 100 }))
    grown.forEach(({ spin }, i) => assertTurn(spin, quatFromAxisAngle(Y, 10 * (i + 1) * Math.PI / 180), `joint ${i}`))
    // a rise past the step's length stands the chain on the axis
    for (const { step } of joints(laid(row, helix(0, 5000)))) {
      assertVec(step, { x: 0, y: 1000, z: 0 }, "straight up the axis")
    }
  })

  it("straightens a bent chain along the way its first link points", () => {
    const sel = selectionUnitsOf(links, null, contextOf([group("chain", links.map(item), { chain: true })], row))!
    const bent = new Map([...row, ...applyUnitEdit(sel, "each", row, deltaEdit(turn(25)))])
    const out = laid(bent, { kind: "straight" })
    links.forEach((key, i) => {
      assertVec(out[i]!.translation, swung({ x: i * 1000, y: 0, z: 0 }, ORIGIN, 25), key)
      assert.closeTo(yawOf(out[i]!), 25, 1e-6, key)
    })
  })
})

describe("a chain's order along its pieces", () => {
  const xs = (...x: ReadonlyArray<number>): ReadonlyArray<Vec3> => x.map((v) => ({ x: v, y: 0, z: 0 }))

  it("walks the points as they lie, whatever order they come in", () => {
    // placed in blocks: 0-3, then 12-15, then 4-11
    const points = xs(0, 1, 2, 3, 12, 13, 14, 15, 4, 5, 6, 7, 8, 9, 10, 11)
    assert.deepStrictEqual(pathOrder(points).map((i) => points[i]!.x), [...Array(16).keys()])
  })

  it("starts at the root when it is an end, else at the end nearer to it", () => {
    const points = xs(3, 0, 1, 2)
    assert.deepStrictEqual(pathOrder(points).map((i) => points[i]!.x), [3, 2, 1, 0], "the root's end")
    assert.deepStrictEqual(pathOrder(points, 2).map((i) => points[i]!.x), [0, 1, 2, 3])
    assert.deepStrictEqual(pathOrder(xs(1, 0, 2, 3, 4)).map((i) => [1, 0, 2, 3, 4][i]), [0, 1, 2, 3, 4])
    assert.deepStrictEqual(pathOrder(xs(5, 9)), [0, 1])
  })
})

describe("a snapped drag under the setting", () => {
  const landing: RigidDelta = { kind: "rigid", rotation: yawed(90), about: ORIGIN, offset: { x: 100, y: 0, z: 0 } }
  const landed = (t: UeTransform) => applyGroupDelta(t, ORIGIN, landing)
  /** Two loose cubes, the second turned, and their selection. */
  const loose = new Map([["a", at(0)], ["b", at(2000, 0, 0, 90)]])
  const looseSelection = () => selectionUnitsOf(["a", "b"], null, contextOf([item("a"), item("b")], loose))!
  /** A chain of three links, and a loose cube beside it. */
  const links = ["l1", "l2", "l3"]
  const chained = new Map([...links.map((key, i) => [key, at(i * 1000)] as const), ["x", at(9000)] as const])
  const chainContext = contextOf([group("chain", links.map(item), { chain: true }), item("x")], chained)

  it("is the same landing for every unit, whatever its axes", () => {
    assert.strictEqual(forUnit(landing, yawed(30)), landing)
  })

  it("lands the whole selection as one in Each, keeping the units where they were to each other", () => {
    const out = applyDelta(looseSelection(), "each", loose, landing)
    assert.deepStrictEqual(out.get("a"), landed(at(0)))
    assert.deepStrictEqual(out.get("b"), landed(at(2000, 0, 0, 90)))
  })

  it("gives a chain's links a landing once, where a turn would run down them", () => {
    const out = applyDelta(selectionUnitsOf([...links, "x"], null, chainContext)!, "each", chained, landing)
    for (const key of [...links, "x"]) assert.deepStrictEqual(out.get(key), landed(chained.get(key)!), key)
  })

  it("carries the links after a selected one with a landing, inside an entered chain", () => {
    const out = applyDelta(selectionUnitsOf(["l2"], "chain", chainContext)!, "each", chained, landing)
    assert.isUndefined(out.get("l1"))
    assert.deepStrictEqual(out.get("l3"), landed(at(2000)))
  })

  it("still puts a plain delta through the setting", () => {
    const offset = rotateVec(yawed(90), { x: 100, y: 0, z: 0 })
    const out = applyDelta(looseSelection(), "each", loose, { kind: "translate", offset, frame: yawed(90) })
    assertVec(out.get("a")!.translation, { x: 100, y: 0, z: 0 }, "a along its own X")
    assertVec(out.get("b")!.translation, { x: 2000, y: 100, z: 0 }, "b, the active one, along its own")
  })

  it("is led by every unit in Together, and by the active one alone in Each", () => {
    const tree = [group("g", [item("a"), item("b")]), item("c")]
    const transforms = new Map([["a", at(0)], ["b", at(1000)], ["c", at(2000)]])
    const sel = selectionUnitsOf(["c", "a", "b"], null, contextOf(tree, transforms))!
    assert.deepStrictEqual(leadingKeys(sel, "together"), ["a", "b", "c"])
    assert.deepStrictEqual(leadingKeys(sel, "each"), ["a", "b"], "b was selected last, and its group is the unit")
  })

  it("isn't led by the links a selected one carries", () => {
    assert.deepStrictEqual(leadingKeys(selectionUnitsOf(["l2"], "chain", chainContext)!, "together"), ["l2"])
  })

  it("is led in Each by a chain's first link, the one link that takes the edit as dragged", () => {
    const whole = selectionUnitsOf(["x", ...links], null, chainContext)!
    assert.deepStrictEqual(leadingKeys(whole, "each"), ["l1"], "the active unit is the chain")
    assert.deepStrictEqual(movedAlikeKeys(whole, "each"), ["l1", "x"], "a loose piece moves as dragged too")
    assert.deepStrictEqual(movedAlikeKeys(whole, "together"), [...links, "x"])
    const entered = selectionUnitsOf(["l3", "l2"], "chain", chainContext)!
    assert.deepStrictEqual(leadingKeys(entered, "each"), ["l2"], "the first selected inside the chain")
    assert.deepStrictEqual(movedAlikeKeys(entered, "each"), ["l2"])
  })

  it("knows when a turn goes past the angle dragged: only as it runs down a chain in Each", () => {
    const chainActive = selectionUnitsOf(["x", ...links], null, chainContext)!
    assert.isTrue(turnAccumulates(chainActive, "each"), "the active unit is the chain")
    assert.isFalse(turnAccumulates(chainActive, "together"))
    assert.isFalse(
      turnAccumulates(selectionUnitsOf([...links, "x"], null, chainContext)!, "each"),
      "the active unit is loose"
    )
    assert.isTrue(turnAccumulates(selectionUnitsOf(links, "chain", chainContext)!, "each"), "inside the entered chain")
  })
})

describe("pivot dots and Point pivots", () => {
  it("draws one dot in Together and one per unit in Each, dotted inside the unit's box", () => {
    const transforms = new Map([["a", at(0)], ["b", at(2000)]])
    const ctx = contextOf([item("a"), item("b")], transforms, new Map([["b", { x: HALF, y: 0, z: 0 }]]))
    const sel = selectionUnitsOf(["a", "b"], null, ctx)!
    const together = pivotDotsOf(sel, "together", ctx.boxOf)
    assert.deepStrictEqual(together.map((d) => [d.id, d.inside]), [["b", false]], "b's face pivot is on its box")
    const each = pivotDotsOf(sel, "each", ctx.boxOf)
    assert.deepStrictEqual(each.map((d) => [d.id, d.inside]), [["a", true], ["b", false]])
  })

  it("carries a Point with a move of every item in its group, and not with a turn or a partial move", () => {
    const structure: Structure = {
      tree: [group("g", [item("a"), item("b")], { pivot: { choice: "point", world: { x: 1, y: 2, z: 3 } } })],
      items: new Map()
    }
    const before = new Map([["a", at(0)], ["b", at(2000)]])
    const by = (offset: Vec3) =>
      new Map(
        [...before].map((
          [k, t]
        ) => [k, { ...t, translation: { x: t.translation.x + offset.x, y: offset.y, z: offset.z } }])
      )
    const moved = withCarriedPoints(structure, (k) => before.get(k), by({ x: 10, y: 20, z: 30 }))
    const pivot = moved?.tree[0]?.kind === "group" ? moved.tree[0].pivot : undefined
    assert.deepStrictEqual(pivot, { choice: "point", world: { x: 11, y: 22, z: 33 } })
    const turned = new Map([...before].map(([k, t]) => [k, applyGroupDelta(t, ORIGIN, turn(90))]))
    assert.isUndefined(withCarriedPoints(structure, (k) => before.get(k), turned))
    assert.isUndefined(withCarriedPoints(structure, (k) => before.get(k), new Map([["a", at(10)]])))
  })

  it("takes a Point along a landing that turns its group too, which it wouldn't a turn alone", () => {
    const structure: Structure = {
      tree: [group("g", [item("a"), item("b")], { pivot: { choice: "point", world: { x: 100, y: 0, z: 0 } } })],
      items: new Map()
    }
    const before = new Map([["a", at(0)], ["b", at(2000)]])
    const landing: RigidDelta = { kind: "rigid", rotation: yawed(90), about: ORIGIN, offset: { x: 0, y: 0, z: 50 } }
    const after = new Map([...before].map(([k, t]) => [k, applyGroupDelta(t, ORIGIN, landing)]))
    const through = (world: Vec3) => landedPoint(world, landing)
    const landed = withCarriedPoints(structure, (k) => before.get(k), after, through)
    const pivot = landed?.tree[0]?.kind === "group" ? landed.tree[0].pivot : undefined
    assert.strictEqual(pivot?.choice, "point")
    if (pivot?.choice === "point") assertVec(pivot.world, { x: 0, y: 100, z: 50 }, "the Point lands with the group")
    assert.isUndefined(withCarriedPoints(structure, (k) => before.get(k), after), "as a turn, it stays")
    const part = new Map([["a", applyGroupDelta(at(0), ORIGIN, landing)]])
    assert.isUndefined(withCarriedPoints(structure, (k) => before.get(k), part, through), "part of its group")
  })

  it("reads a rotator offset about a unit's own axis for the Inspector", () => {
    const t = at(0, 0, 0, 45)
    const d = rotatorOffset(t, "z", 10)
    const out = applyGroupDelta(t, ORIGIN, d)
    assert.closeTo(readField(out, "rotation").z, 55, 1e-6)
    assert.deepStrictEqual(identityTransform().rotation, { x: 0, y: 0, z: 0, w: 1 })
  })
})
