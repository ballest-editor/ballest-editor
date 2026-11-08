import { assert, describe, it } from "@effect/vitest"
import { assertVec } from "../test/vec"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import { identityTransform } from "./factory"
import {
  applyGroupDelta,
  forUnit,
  type GroupDelta,
  readField,
  rotatorOffset,
  selectionAxisEdit
} from "./groupTransform"
import type { Box } from "./itemBounds"
import type { ChainGrowth, GroupNode, TreeNode } from "./MapSidecar"
import { localToWorld } from "./pivot"
import type { Structure } from "./structure"
import { ORIGIN, quatConjugate, quatDot, quatMul, quatToRotator, rotateVec, rotatorToQuat, vecSub } from "./ueMath"
import {
  applyUnitEdit,
  deltaEdit,
  effectivePivotMode,
  pathOrder,
  pivotDotsOf,
  pivotUnitOf,
  selectionUnitsOf,
  type UnitContext,
  type UnitEdit,
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
  liveOffsetOf: () => undefined
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
      liveOffsetOf: () => ({ x: 10, y: 0, z: 0 })
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

  it("moves the carried links by the offset once, and keeps a scale with its link", () => {
    const sel = selectionUnitsOf(["l2", "l4"], "chain", contextOf([chain], transforms))!
    const move: GroupDelta = { kind: "translate", offset: { x: 0, y: 100, z: 0 } }
    const moved = applyUnitEdit(sel, "each", transforms, deltaEdit(move))
    assert.isUndefined(moved.get("l1"))
    for (const key of ["l2", "l3", "l4", "l5"]) assert.strictEqual(moved.get(key)!.translation.y, 100, key)
    const scaled = applyUnitEdit(sel, "each", transforms, deltaEdit({ kind: "scale", factor: 2, axis: "x" }))
    assert.strictEqual(scaled.get("l2")!.scale3D.x, 2)
    assert.isUndefined(scaled.get("l3"), "the next link is left alone")
    assert.strictEqual(scaled.get("l4")!.scale3D.x, 2)
  })

  it("carries the links after a link moved or turned in Together, and never a scale", () => {
    const sel = selectionUnitsOf(["l3"], "chain", contextOf([chain], transforms))!
    const move: GroupDelta = { kind: "translate", offset: { x: 0, y: 5, z: 0 } }
    const moved = applyUnitEdit(sel, "together", transforms, deltaEdit(move))
    assert.deepStrictEqual([...moved.keys()], ["l3", "l4", "l5"])
    const scaled = applyUnitEdit(sel, "together", transforms, deltaEdit({ kind: "scale", factor: 2 }))
    assert.deepStrictEqual([...scaled.keys()], ["l3"])
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

  it("reads a rotator offset about a unit's own axis for the Inspector", () => {
    const t = at(0, 0, 0, 45)
    const d = rotatorOffset(t, "z", 10)
    const out = applyGroupDelta(t, ORIGIN, d)
    assert.closeTo(readField(out, "rotation").z, 55, 1e-6)
    assert.deepStrictEqual(identityTransform().rotation, { x: 0, y: 0, z: 0, w: 1 })
  })
})
