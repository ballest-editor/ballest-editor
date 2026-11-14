import { assert, describe, it } from "@effect/vitest"
import { evaluate, referenceOf } from "../../domain/approximate/look/evaluate"
import { upright } from "../../test/placement"
import { ballTriangles } from "../../test/triangles"
import { type HeldRun, type Run, shownRun, trianglesFor } from "./useApproximation"

const pieces = [upright("sphere", [0, 0, 0], [100, 100, 100])]
const ball = ballTriangles(100)
const reference = referenceOf(ball, true)
const done: Run = {
  status: "done",
  placements: pieces,
  metrics: evaluate(reference, pieces),
  grid: reference.grid,
  milliseconds: 5
}
const held: HeldRun = { run: done, modelKey: "a.obj", runKey: "a.obj|300" }

describe("shownRun", () => {
  it("shows a run of the model and settings asked for as it is", () => {
    assert.strictEqual(shownRun(held, "a.obj", "a.obj|300"), done)
  })

  it("shows a result of other settings as a run under way, so it can't be opened as the new settings' result", () => {
    const shown = shownRun(held, "a.obj", "a.obj|100")
    assert.deepStrictEqual(shown, { status: "running", placements: pieces, phase: "fitting", startedAt: null })
  })

  it("shows nothing of another model's result, nor of any with no model read", () => {
    assert.deepStrictEqual(shownRun(held, "b.obj", "b.obj|300"), { status: "idle" })
    assert.deepStrictEqual(shownRun(held, "", "|300"), { status: "idle" })
  })
})

describe("trianglesFor", () => {
  const file = new File(["a"], "a.obj"), other = new File(["b"], "a.obj")
  const read = { file, up: "y" as const, triangles: ball }

  it("gives what was read of this file this way up", () => {
    assert.strictEqual(trianglesFor(read, file, "y"), ball)
  })

  it("gives nothing while another file or the other up axis is still being read", () => {
    assert.isNull(trianglesFor(read, file, "z"))
    assert.isNull(trianglesFor(read, other, "y"))
    assert.isNull(trianglesFor(null, file, "y"))
  })
})
