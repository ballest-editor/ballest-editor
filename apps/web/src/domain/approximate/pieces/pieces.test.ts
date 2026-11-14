import { assert, describe, it } from "@effect/vitest"
import { upright } from "../../../test/placement"
import { trianglesOfPlacement } from "../look/views"
import { joined } from "../parts/meshParts"
import { FEWER, FEWER_MORE } from "../settings"
import { finished, wholeParts } from "./pieces"

/** An L of two boxes that share no corner but read as one body. */
const body = [upright("box", [0, 0, 600], [700, 500, 400]), upright("box", [400, 0, 1300], [300, 500, 300])]
/** A squashed ball standing clear of the body. */
const foot = upright("sphere", [-300, 0, -200], [300, 220, 150])

describe("wholeParts", () => {
  it("gives a separate part that is one primitive that primitive, and leaves the rest", () => {
    const model = joined([...body, foot].map(trianglesOfPlacement))
    const parts = wholeParts(model)
    assert.strictEqual(parts?.pieces.length, 1)
    const [ball] = parts?.pieces ?? []
    assert.strictEqual(ball?.kind, "sphere")
    assert.approximately(ball?.center.z ?? 0, -200, 30)
    assert.approximately(Math.max(ball?.half.x ?? 0, ball?.half.y ?? 0, ball?.half.z ?? 0), 300, 45)
    assert.strictEqual(parts?.rest.length, model.length - trianglesOfPlacement(foot).length)
  })

  it("leaves a model of one part alone", () => {
    assert.isUndefined(wholeParts(trianglesOfPlacement(foot)))
  })
})

describe("finished", () => {
  // A bump under the body whose loss costs about 0.02 in look, and boxes deep inside it that change no picture.
  const bump = upright("sphere", [-300, 0, 95], [210, 154, 105])
  const hidden = [0, 1, 2, 3, 4].map((i) => upright("box", [-200 + 100 * i, 0, 600], [40, 40, 40]))
  const run = [...body, bump, ...hidden]
  const model = joined([...body, bump].map(trianglesOfPlacement))
  const firstOf = (count: number) => run.slice(0, count)

  it("is the whole fit, refined, with no time to polish", () => {
    const asked: Array<number> = []
    const refined = (count: number) => {
      asked.push(count)
      return firstOf(count)
    }
    assert.deepStrictEqual(finished(model, 5, refined, 0, true, FEWER), { placements: firstOf(5), symmetric: false })
    assert.deepStrictEqual(asked, [5])
  })

  it("tries the fit's first eighth, quarter, half and all of it, each once", () => {
    const asked: Array<number> = []
    const refined = (count: number) => {
      asked.push(count)
      return firstOf(count)
    }
    finished(model, 3, refined, 1e-3, false, FEWER)
    assert.deepStrictEqual(asked, [1, 2, 3])
  })

  it("starts from a shorter run only when it looks within `within` of the best", () => {
    const kinds = (within: number) =>
      finished(model, run.length, firstOf, 1e-3, false, within).placements.map(({ kind }) => kind)
    // Runs of 1, 2, 4 and 8 pieces: the first two settings keep the bump, the third gives it up; none keeps every
    // hidden box.
    for (const within of [0, FEWER]) {
      assert.include(kinds(within), "sphere")
      assert.isAtMost(kinds(within).length, 4)
    }
    assert.deepStrictEqual(kinds(FEWER_MORE), ["box", "box"])
  })

  it("has no pieces where the fit made none", () => {
    assert.deepStrictEqual(finished(model, 0, () => [], 1, true, FEWER), { placements: [], symmetric: false })
  })

  it("ties the pieces of a symmetric model where that looks no worse", () => {
    // The body is its own mirror image in y; so are the pieces.
    const symmetric = finished(model, 3, firstOf, 1e-3, true, 0)
    assert.isTrue(symmetric.symmetric)
    assert.isFalse(finished(model, 3, firstOf, 1e-3, false, 0).symmetric)
  })
})
