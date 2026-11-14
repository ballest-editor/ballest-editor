import { assert, describe, it } from "@effect/vitest"
import { ballTriangles } from "../../../test/triangles"
import { gridOver, trianglesBox, voxelize } from "../grid/voxelize"
import { lookOfPlacements, modelViews, trianglesOfPlacement } from "../look/views"
import { meshReady } from "../mesh/mesh"
import { PlateSource } from "../mesh/remesh"
import { IDENTITY_QUAT } from "../shapes"
import { candidatesOf } from "./plateCandidates"
import { atMostFaces, type ModelFit, partsOf, type Scored } from "./plateParts"

const options = { faces: 100, flatness: 12, thickness: 0 }

const ball = (): Float32Array => ballTriangles(1000)

/** The ball with a rod 200 cm across standing 1600 cm out of its top: one thin part. */
const ballWithRod = (): Float32Array =>
  new Float32Array([
    ...ball(),
    ...trianglesOfPlacement({
      kind: "cylinder",
      center: { x: 0, y: 0, z: 1700 },
      half: { x: 100, y: 100, z: 900 },
      rotation: IDENTITY_QUAT
    })
  ])

/** A fit of `triangles` within `budget`, the stages it stamped, and its best plain mesh. */
const fitOf = (triangles: Float32Array, budget: number, cells: number) => {
  const grid = voxelize(triangles, gridOver(trianglesBox(triangles), cells), { surface: true })
  const source = new PlateSource(triangles, grid)
  const views = modelViews(triangles)
  const stamped: Array<string> = []
  const fit: ModelFit = {
    triangles,
    source,
    budget,
    views,
    judge: (placements) => lookOfPlacements(views, placements),
    stamp: (stage) => stamped.push(stage)
  }
  const full = candidatesOf(grid, options, source, budget)
    .map((result): Scored => ({ result, judged: fit.judge(result.placements) }))
    .toSorted((a, b) => b.judged.score - a.judged.score)[0]
  return { fit, full, stamped }
}

describe("atMostFaces", () => {
  it("leaves a model within the count as it is, and simplifies a finer one", async () => {
    await meshReady
    const triangles = ball()
    assert.strictEqual(atMostFaces(triangles, triangles.length / 9), triangles)
    const coarse = atMostFaces(triangles, 60)
    assert.isAtMost(coarse.length / 9, 60)
    assert.isAbove(coarse.length, 0)
  })
})

describe("partsOf", () => {
  it("has nothing to say of a model with no thin parts", async () => {
    await meshReady
    const { fit, full, stamped } = fitOf(ball(), 24, 16)
    assert.isDefined(full)
    assert.isUndefined(partsOf(fit, options, full))
    assert.isEmpty(stamped)
  })

  it("stands a primitive in for a thin part where the region and the whole model look better with it", async () => {
    await meshReady
    const { fit, full, stamped } = fitOf(ballWithRod(), 24, 32)
    assert.isDefined(full)
    const found = partsOf(fit, options, full)
    assert.deepStrictEqual(stamped, ["partFits", "partsTrimmed", "partsDecided"])
    assert.isDefined(found)
    assert.strictEqual(found.choices.length, 1)
    const choice = found.choices[0]
    assert.isDefined(choice)
    assert.isTrue(choice.kept)
    assert.isTrue(choice.eligible)
    assert.isAtLeast(choice.region?.score ?? 0, (choice.regionWithout?.score ?? 1) + 0.02)
    const combined = found.combined
    assert.isDefined(combined)
    assert.isAtLeast(combined.judged.score, full.judged.score + 0.002)
    assert.deepStrictEqual(choice.whole, combined.judged)
    assert.deepStrictEqual(choice.wholeWithout, full.judged)
    // The part's pieces come first, tagged, and the mesh of the rest fills what is left of the budget.
    assert.isAtMost(combined.result.placements.length, 24)
    assert.strictEqual(combined.result.primitives?.length, choice.pieces)
    assert.deepStrictEqual(combined.result.placements.slice(0, choice.pieces), combined.result.primitives)
    assert.deepStrictEqual(
      combined.result.tags?.slice(0, choice.pieces),
      Array.from({ length: choice.pieces }, () => "part")
    )
    assert.notInclude(combined.result.tags?.slice(choice.pieces) ?? [], "part")
    // The primitive stands where the rod is, above the ball.
    assert.isAbove(combined.result.placements[0]?.center.z ?? 0, 1000)
    // The mesh was fitted on a grid without the part's cells.
    const cells = (grid: { readonly cells: Uint8Array } | undefined) => grid?.cells.reduce((sum, cell) => sum + cell, 0)
    assert.isBelow(cells(combined.result.fitGrid) ?? Infinity, cells(fit.source.solid.grid) ?? 0)
  })

  it("reports the parts and keeps none when the budget leaves no room for a mesh beside them", async () => {
    await meshReady
    const { fit, full, stamped } = fitOf(ballWithRod(), 24, 32)
    assert.isDefined(full)
    const found = partsOf({ ...fit, budget: 5 }, options, full)
    assert.deepStrictEqual(stamped, ["partFits", "partsTrimmed"])
    assert.isDefined(found)
    assert.isUndefined(found.combined)
    assert.strictEqual(found.choices.length, 1)
    const choice = found.choices[0]
    assert.isDefined(choice)
    assert.isFalse(choice.kept)
    assert.isUndefined(choice.region)
    assert.isAbove(choice.pieces, 0)
  })
})
