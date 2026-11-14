import { assert, describe, it } from "@effect/vitest"
import { upright } from "../../test/placement"
import { approximate, keptCovers, type KeptOrder, keptPrefix, keptTotal, make, type Phase } from "./approximate"
import { toPlacement } from "./grid/raster"
import { referenceOf } from "./look/evaluate"
import { trianglesOfPlacement } from "./look/views"
import { meshReady } from "./mesh/mesh"
import { joined } from "./parts/meshParts"
import { type ApproximateSettings, DEFAULT_SETTINGS } from "./settings"
import { IDENTITY_QUAT } from "./shapes"

const block = trianglesOfPlacement(upright("box", [500, 1000, 250], [500, 1000, 250]))
/** An L of two boxes, and a squashed ball standing clear of it: a part that is one primitive. */
const body = [upright("box", [0, 0, 600], [700, 500, 400]), upright("box", [400, 0, 1300], [300, 500, 300])] as const
const foot = upright("sphere", [-300, 0, -200], [300, 220, 150])
const footed = joined([...body, foot].map(trianglesOfPlacement))

const settings: ApproximateSettings = {
  ...DEFAULT_SETTINGS,
  resolution: 16,
  budget: 12,
  searchSeconds: 0,
  pieces: { ...DEFAULT_SETTINGS.pieces, sweeps: 1 }
}
const piecesOnly: ApproximateSettings = { ...settings, method: "piecesOnly" }

describe("make", () => {
  it("makes a cube for each of the grid's surface cells with Voxel cubes, whatever the budget", () => {
    const made = make(block, { ...settings, method: "voxels", resolution: 4, fillThin: false, budget: 1 })
    assert.deepStrictEqual(made.grid.n, [4, 6, 3])
    // Every cell of a block two cells high is on its surface.
    assert.strictEqual(made.placements.length, 2 * 4 * 1)
    assert.isUndefined(made.order)
    assert.isUndefined(made.plates)
  })

  it("covers a block with one merged cube, and keeps the ranking for the next budget", () => {
    const made = make(block, { ...settings, method: "boxes", resolution: 20, fillThin: false })
    assert.strictEqual(made.placements.length, 1)
    assert.deepStrictEqual(made.order, { kind: "ranked", placements: made.placements })
  })

  it("cuts a kept ranking to the budget instead of merging again", () => {
    const ranked = [foot, ...body]
    const made = make(block, { ...settings, method: "boxes", budget: 2 }, undefined, {
      kind: "ranked",
      placements: ranked
    })
    assert.deepStrictEqual(made.placements, [foot, body[0]])
    assert.deepStrictEqual(made.order, { kind: "ranked", placements: ranked })
  })

  it("puts a whole part's primitive first with Pieces only, and fits the rest in what is left of the budget", () => {
    const made = make(footed, piecesOnly)
    assert.isAtMost(made.placements.length, 12)
    assert.isAbove(made.placements.length, 1)
    assert.strictEqual(made.placements[0]?.kind, "sphere")
    assert.approximately(made.placements[0]?.center.z ?? 0, -200, 30)
    // The grid is of the rest alone: nothing of it is as low as the foot.
    assert.isAbove(made.grid.origin.z + made.grid.voxel * made.grid.n[2], 1500)
    const order = made.order
    if (order?.kind !== "greedy") return assert.fail("no greedy order")
    assert.isAtMost(order.run.shapes.length, 11)
  })

  it("fits the whole model with the split left out", () => {
    const made = make(footed, { ...piecesOnly, without: ["split"] })
    const order = made.order
    if (order?.kind !== "greedy") return assert.fail("no greedy order")
    assert.isAtMost(order.run.shapes.length, 12)
    assert.isAtMost(made.placements.length, 12)
  })

  it("fits nothing where every part is a primitive, or the budget is spent on them", () => {
    // Six balls in a row: each has too little of the surface to be left to the fit.
    const balls = joined(
      [0, 1, 2, 3, 4, 5].map((i) => trianglesOfPlacement({ ...foot, center: { x: 900 * i, y: 0, z: 0 } }))
    )
    const made = make(balls, piecesOnly)
    assert.deepStrictEqual(made.placements.map(({ kind }) => kind), Array.from({ length: 6 }, () => "sphere"))
    assert.deepStrictEqual(made.order?.kind === "greedy" && made.order.run.shapes, [])
    assert.strictEqual(make(footed, { ...piecesOnly, budget: 1 }).placements.length, 1)
  })

  it("refines a kept greedy order's first pieces instead of fitting again", () => {
    const first = make(block, piecesOnly)
    const order = first.order
    if (order?.kind !== "greedy") return assert.fail("no greedy order")
    const phases = new Set<Phase>()
    const again = make(block, { ...piecesOnly, budget: 1 }, (_, phase) => phases.add(phase), order)
    assert.strictEqual(again.order?.kind === "greedy" && again.order.run, order.run)
    assert.deepStrictEqual([...phases], ["refining"])
    assert.strictEqual(again.placements.length, 1)
  })

  it("reports the fit's pieces and then the refined ones, the whole parts' primitives before them", () => {
    const seen: Array<{ readonly phase: Phase; readonly first: string | undefined }> = []
    make(footed, piecesOnly, (placements, phase) => seen.push({ phase, first: placements[0]?.kind }))
    assert.strictEqual(seen[seen.length - 1]?.phase, "refining")
    assert.isTrue(seen.every(({ first }) => first === "sphere"))
    assert.deepStrictEqual([...new Set(seen.map(({ phase }) => phase))].slice(-1), ["refining"])
  })

  it("uses pyramids and cubes alone with Plates only, and keeps no order", async () => {
    await meshReady
    const made = make(block, { ...settings, method: "platesOnly", resolution: 8, budget: 20 })
    assert.isAbove(made.placements.length, 0)
    assert.isAtMost(made.placements.length, 20)
    for (const { kind } of made.placements) assert.include(["pyramid", "box"], kind)
    assert.isDefined(made.plates)
    assert.isUndefined(made.order)
  })
})

describe("a kept order", () => {
  const ranked: KeptOrder = { kind: "ranked", placements: [...body, foot] }
  const frame = { n: [4, 4, 4], origin: { x: 100, y: 200, z: 300 }, voxel: 50 } as const
  const shapes = [
    { kind: "box", c: [1, 2, 3], h: [1, 1, 2], q: IDENTITY_QUAT },
    { kind: "sphere", c: [2, 2, 2], h: [1, 1, 1], q: IDENTITY_QUAT }
  ] as const
  const greedy = (complete: boolean): KeptOrder => ({ kind: "greedy", run: { shapes, frame, complete } })

  it("covers any budget when it is a ranking or a fit that ran out of pieces to add", () => {
    assert.isTrue(keptCovers(ranked, 1000))
    assert.isTrue(keptCovers(greedy(true), 1000))
  })

  it("covers a fit's budget only up to the pieces it placed", () => {
    assert.isTrue(keptCovers(greedy(false), 2))
    assert.isFalse(keptCovers(greedy(false), 3))
  })

  it("gives its first pieces in cm, and how many it holds", () => {
    assert.deepStrictEqual(keptPrefix(ranked, 2), body)
    assert.deepStrictEqual(keptPrefix(greedy(false), 1), [toPlacement(frame, shapes[0])])
    assert.deepStrictEqual(keptPrefix(greedy(false), 1)[0]?.center, { x: 150, y: 300, z: 450 })
    assert.strictEqual(keptTotal(ranked), 3)
    assert.strictEqual(keptTotal(greedy(false)), 2)
  })
})

describe("approximate", () => {
  it("judges what the method made against the reference", () => {
    const result = approximate(
      block,
      { ...settings, method: "boxes", resolution: 20, fillThin: false },
      referenceOf(block, false)
    )
    assert.strictEqual(result.placements.length, 1)
    assert.isAbove(result.metrics.iou, 0.95)
  })
})
