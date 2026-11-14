import { assert, describe, it } from "@effect/vitest"
import { upright } from "../../../test/placement"
import { trianglesOfPlacement } from "../look/views"
import {
  depthIn,
  extrusionsOf,
  forEachFace,
  type Shape,
  spansOf,
  SWEEP_SHARE,
  sweepShare,
  sweepTests,
  withinGrid
} from "./extrusion"

/**
 * A closed prism: the convex polygon `profile`, anticlockwise in x and y, swept along z from `from` to `to`.
 */
const prism = (profile: ReadonlyArray<readonly [number, number]>, from: number, to: number): Array<number> => {
  const out: Array<number> = []
  const cx = profile.reduce((sum, [x]) => sum + x, 0) / profile.length
  const cy = profile.reduce((sum, [, y]) => sum + y, 0) / profile.length
  profile.forEach(([x, y], i) => {
    const [u, v] = profile[(i + 1) % profile.length] ?? [0, 0]
    out.push(x, y, from, u, v, from, u, v, to, x, y, from, u, v, to, x, y, to)
    out.push(cx, cy, from, u, v, from, x, y, from, cx, cy, to, x, y, to, u, v, to)
  })
  return out
}

const arc = (radius: number, from: number, to: number, steps: number) =>
  Array.from({ length: steps + 1 }, (_, k): readonly [number, number] => {
    const angle = from + (to - from) * k / steps
    return [radius * Math.cos(angle), radius * Math.sin(angle)]
  })

/** A D: the left half of a 1000 cm square, and a half disk of radius 500 cm on its right. */
const dProfile = [[-500, -500], ...arc(500, -Math.PI / 2, Math.PI / 2, 32), [-500, 500]] as const
const dPrism = new Float32Array(prism(dProfile, 0, 2000))
const ball = trianglesOfPlacement(upright("sphere", [0, 0, 0], [500, 500, 500]))

const Z = { x: 0, y: 0, z: 1 }

/** The pixels `shape` covers on a `width` by `height` grid, as rows of "#" and ".". */
const drawn = (shape: Shape, width: number, height: number): Array<string> => {
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => "."))
  spansOf(shape, width, height, (v, from, to) => {
    for (let u = from; u <= to; u++) {
      const row = rows[v]
      if (row !== undefined) row[u] = "#"
    }
  })
  return rows.map((row) => row.join(""))
}

describe("forEachFace", () => {
  it("gives each triangle's normal direction and twice its area", () => {
    const seen: Array<unknown> = []
    forEachFace(new Float32Array([0, 0, 0, 4, 0, 0, 0, 3, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]), (cross, length) => {
      seen.push(cross, length)
    })
    assert.deepStrictEqual(seen, [{ x: 0, y: 0, z: 12 }, 12, { x: 0, y: 0, z: 0 }, 0])
  })
})

describe("sweepTests", () => {
  it("passes a prism along its own axis, and puts that axis first", () => {
    const [best] = sweepTests(dPrism)
    if (best === undefined) return assert.fail("no sweep test")
    assert.isAbove(sweepShare(best), SWEEP_SHARE)
    assert.isAbove(Math.abs(best.axis.z), 0.99)
    assert.closeTo(best.along + best.ends, 1, 1e-6)
  })

  it("fails a ball on every axis", () => {
    const tests = sweepTests(ball)
    assert.isAtLeast(tests.length, 3)
    assert.isBelow(Math.max(...tests.map(sweepShare)), SWEEP_SHARE)
  })
})

describe("spansOf", () => {
  it("covers the pixels whose middles are in a rectangle", () => {
    assert.deepStrictEqual(drawn({ kind: "rectangle", cu: 3, cv: 2, ru: 2, rv: 1, angle: 0 }, 6, 5), [
      "......",
      ".####.",
      ".####.",
      "......",
      "......"
    ])
  })

  it("turns a rectangle by its angle", () => {
    assert.deepStrictEqual(drawn({ kind: "rectangle", cu: 3, cv: 2.5, ru: 2, rv: 1, angle: Math.PI / 2 }, 6, 5), [
      "..##..",
      "..##..",
      "..##..",
      "..##..",
      "..##.."
    ])
  })

  it("covers the pixels whose middles are in an ellipse, clipped to the grid", () => {
    assert.deepStrictEqual(drawn({ kind: "ellipse", cu: 3, cv: 3, ru: 3, rv: 2, angle: 0 }, 5, 6), [
      ".....",
      ".####",
      "#####",
      "#####",
      ".####",
      "....."
    ])
  })
})

describe("withinGrid", () => {
  it("is false as soon as a shape's bounds leave the grid", () => {
    const square: Shape = { kind: "rectangle", cu: 5, cv: 5, ru: 4, rv: 4, angle: 0 }
    assert.isTrue(withinGrid(square, 10, 10))
    assert.isFalse(withinGrid({ ...square, cu: 6.5 }, 10, 10))
    // Turned, its corners poke out; a circle as wide doesn't.
    assert.isFalse(withinGrid({ ...square, angle: Math.PI / 4 }, 10, 10))
    assert.isTrue(withinGrid({ ...square, kind: "ellipse", angle: Math.PI / 4 }, 10, 10))
  })
})

describe("depthIn", () => {
  it("measures how far each marked pixel is from the nearest unmarked one, the grid's edge counting as one", () => {
    const marks = [
      [1, 1, 1, 1, 0],
      [1, 1, 1, 1, 0],
      [1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0]
    ]
    assert.deepStrictEqual(
      [...depthIn(new Uint8Array(marks.flat()), 5, 4)],
      [
        [1, 1, 1, 1, 0],
        [1, 2, 2, 1, 0],
        [1, 1, 1, 1, 0],
        [0, 0, 0, 0, 0]
      ].flat()
    )
  })
})

describe("extrusionsOf", () => {
  it("covers a D-shaped prism with a box and a cylinder along it", () => {
    const options = extrusionsOf(dPrism, Z, 100)
    assert.deepStrictEqual(options.map((option) => option.leastGain), [0, 0.02, 0.04, 0.08])
    const fewest = options.reduce((a, b) => b.placements.length < a.placements.length ? b : a)
    assert.isAtMost(fewest.placements.length, 3)
    assert.strictEqual(fewest.sections, 1)
    assert.isBelow(fewest.uncovered, 0.1)
    assert.includeMembers(fewest.placements.map(({ kind }) => kind), ["box", "cylinder"])
    for (const { center, half } of fewest.placements) {
      assert.approximately(half.z, 1000, 50)
      assert.approximately(center.z, 1000, 50)
    }
  })

  it("gives a wider stretch of the model a section and a piece of its own", () => {
    const circle = (radius: number) => arc(radius, 0, 2 * Math.PI, 48).slice(0, -1)
    const stepped = new Float32Array([...prism(circle(300), 0, 1500), ...prism(circle(500), 1500, 2000)])
    const [option] = extrusionsOf(stepped, Z, 100)
    if (option === undefined) return assert.fail("no extrusion")
    assert.strictEqual(option.sections, 2)
    assert.isBelow(option.uncovered, 0.05)
    const widest = option.placements.reduce((a, b) => b.half.x > a.half.x ? b : a)
    assert.strictEqual(widest.kind, "cylinder")
    assert.approximately(widest.half.x, 500, 30)
    assert.approximately(widest.half.z, 250, 30)
    // The core runs on through the wide end.
    assert.isTrue(option.placements.some(({ half }) => Math.abs(half.z - 1000) < 30 && Math.abs(half.x - 300) < 30))
  })

  it("stops at the budget, and says what that leaves uncovered", () => {
    const [one] = extrusionsOf(dPrism, Z, 1)
    assert.strictEqual(one?.placements.length, 1)
    assert.isAbove(one?.uncovered ?? 0, 0)
  })

  it("has none for a model with nothing in it", () => {
    assert.deepStrictEqual(extrusionsOf(new Float32Array(0), Z, 10), [])
  })
})
