import { assert, describe, it } from "@effect/vitest"
import { ballTriangles } from "../../../test/triangles"
import { gridOver, trianglesBox, voxelize } from "../grid/voxelize"
import { trianglesOfPlacement } from "../look/views"
import { meshReady } from "../mesh/mesh"
import { IDENTITY_QUAT } from "../shapes"
import { plates } from "./plates"
import { platesWhole } from "./platesWhole"

/** The fit alone: no search, symmetry, thin parts, stretches of surface or closing, which platesWhole's tests cover. */
const options = {
  faces: 100,
  flatness: 12,
  thickness: 0,
  searchSeconds: 0,
  symmetry: false,
  parts: false,
  primitives: 0,
  close: false
}

type Triple = readonly [number, number, number]

const ball = ballTriangles

/** Two balls side by side, apart: two separate parts. */
const twoBalls = async (): Promise<Float32Array> => {
  await meshReady
  return together(ball(1000), ball(900, [2500, 0, 0]))
}

/** A flat ring about z, `inner` to `outer` across and `2 * half` thick, as one closed mesh of `sides` segments. */
const ring = (inner: number, outer: number, half: number, sides: number): Float32Array => {
  const numbers: Array<number> = []
  const at = (radius: number, k: number, z: number): Triple => {
    const angle = 2 * Math.PI * k / sides
    return [radius * Math.cos(angle), radius * Math.sin(angle), z]
  }
  const quad = (...corners: ReadonlyArray<Triple>) => {
    for (const k of [0, 1, 2, 0, 2, 3]) numbers.push(...(corners[k] ?? []))
  }
  for (let j = 0; j < sides; j++) {
    quad(at(inner, j, half), at(outer, j, half), at(outer, j + 1, half), at(inner, j + 1, half))
    quad(at(inner, j + 1, -half), at(outer, j + 1, -half), at(outer, j, -half), at(inner, j, -half))
    quad(at(outer, j, -half), at(outer, j + 1, -half), at(outer, j + 1, half), at(outer, j, half))
    quad(at(inner, j + 1, -half), at(inner, j, -half), at(inner, j, half), at(inner, j + 1, half))
  }
  return new Float32Array(numbers)
}

const together = (...sets: ReadonlyArray<Float32Array>): Float32Array =>
  new Float32Array(sets.flatMap((set) => [...set]))

const gridOf = (triangles: Float32Array, cells: number) =>
  voxelize(triangles, gridOver(trianglesBox(triangles), cells), { surface: true })

const countOf = (tags: ReadonlyArray<string> | undefined, tag: string): number =>
  (tags ?? []).filter((other) => other === tag).length

describe("plates", () => {
  it("is the whole fit under the least budget that splits a model", async () => {
    await meshReady
    const triangles = together(ball(1000), ball(900, [2500, 0, 0])), grid = gridOf(triangles, 12)
    const made = plates(triangles, grid, { ...options, budget: 8 })
    assert.deepStrictEqual(made.placements, platesWhole(triangles, grid, { ...options, budget: 8 }).placements)
    assert.isUndefined(made.components)
    assert.notProperty(made.stages, "profile")
  })

  it("gives a separate thin part one primitive of its own, after the pieces of the rest fitted alone", async () => {
    await meshReady
    // A rod 80 cm across beside the ball, clear of it.
    const rod = trianglesOfPlacement({
      kind: "cylinder",
      center: { x: 2000, y: 0, z: 0 },
      half: { x: 40, y: 40, z: 1000 },
      rotation: IDENTITY_QUAT
    })
    const triangles = together(ball(1000), rod)
    const shown: Array<number> = []
    const made = plates(triangles, gridOf(triangles, 12), { ...options, budget: 30, profiles: false }, (placements) => {
      shown.push(placements.length)
    })
    assert.isAtMost(made.placements.length, 30)
    assert.isDefined(made.components)
    assert.strictEqual(made.components.limbs, 1)
    assert.strictEqual(made.components.kept, 1)
    assert.isAtLeast(made.components.gain, 0.01)
    assert.strictEqual(made.tags?.length, made.placements.length)
    assert.strictEqual(countOf(made.tags, "component"), 1)
    assert.strictEqual(made.tags?.at(-1), "component")
    const piece = made.placements.at(-1)
    assert.approximately(piece?.center.x ?? 0, 2000, 150)
    assert.isAbove(Math.max(piece?.half.x ?? 0, piece?.half.y ?? 0, piece?.half.z ?? 0), 700)
    assert.includeMembers(Object.keys(made.stages ?? {}), ["componentFits", "componentsChosen", "total"])
    assert.notProperty(made.stages, "profile")
    // Nothing shown was over the budget, the part's piece counted.
    for (const pieces of shown) assert.isAtMost(pieces, 30)
  })

  it("leaves separate parts in the mesh with the split left out", async () => {
    const triangles = await twoBalls()
    const made = plates(triangles, gridOf(triangles, 12), { ...options, budget: 30, split: false })
    assert.isUndefined(made.components)
    assert.strictEqual(countOf(made.tags, "component"), 0)
    assert.isAbove(made.placements.length, 2)
    assert.property(made.stages, "profile")
    assert.property(made.stages, "wholeParts")
  })

  it("makes large parts that each look like one primitive that primitive", async () => {
    const triangles = await twoBalls()
    const made = plates(triangles, gridOf(triangles, 12), { ...options, budget: 30 })
    assert.deepStrictEqual(made.tags, ["component", "component"])
    assert.deepStrictEqual(made.placements.map((piece) => piece.kind), ["sphere", "sphere"])
    assert.sameMembers(made.placements.map((piece) => Math.round(piece.center.x / 100)), [0, 25])
  })

  it("covers a flat profile with flat pieces of its own, before the pieces of what it leaves", async () => {
    await meshReady
    const triangles = together(ring(600, 1000, 50, 24), ball(200))
    const made = plates(triangles, gridOf(triangles, 24), { ...options, budget: 40, split: false })
    assert.isAtMost(made.placements.length, 40)
    const profile = countOf(made.tags, "profile")
    assert.isAbove(profile, 0)
    assert.deepStrictEqual(made.tags?.slice(0, profile), Array.from({ length: profile }, () => "profile"))
    // Flat pieces, in the ring's plane.
    for (const piece of made.placements.slice(0, profile)) assert.approximately(piece.center.z, 0, 30)
    // The ball, all that is left once the ring is covered, is one primitive.
    assert.deepStrictEqual(made.tags?.slice(profile), ["component"])
    assert.strictEqual(made.placements.at(-1)?.kind, "sphere")
    const without = plates(triangles, gridOf(triangles, 24), { ...options, budget: 40, split: false, profiles: false })
    assert.strictEqual(countOf(without.tags, "profile"), 0)
    assert.notProperty(without.stages, "profile")
  })
})
