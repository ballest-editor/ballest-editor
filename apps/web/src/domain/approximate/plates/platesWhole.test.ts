import { afterEach, assert, describe, it } from "@effect/vitest"
import { boxTriangles } from "../../../test/boxTriangles"
import { ballTriangles, sphereTriangles } from "../../../test/triangles"
import { setClock } from "../clock"
import { gridOver, trianglesBox, voxelize } from "../grid/voxelize"
import { lookOfPlacements, modelViews } from "../look/views"
import { meshReady } from "../mesh/mesh"
import type { Placement } from "../shapes"
import { platesWhole, searchCap } from "./platesWhole"

/** The fit alone: no search, and none of the stages that have tests of their own or cost seconds. */
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

const gridOf = (triangles: Float32Array, cells = 16) =>
  voxelize(triangles, gridOver(trianglesBox(triangles), cells), { surface: true })

/** A ball of radius 1000 swollen toward +z, so that it has mirror planes but is no primitive. */
const pear = (): Float32Array =>
  sphereTriangles(10, 14, (i, j) => {
    const theta = Math.PI * i / 10, phi = 2 * Math.PI * j / 14
    const wide = 1000 * Math.sin(theta) * (1 + 0.3 * Math.cos(theta))
    return [wide * Math.cos(phi), wide * Math.sin(phi), 1000 * Math.cos(theta)]
  })

const block = (): Float32Array => boxTriangles([0, 0, 0], [1000, 2000, 500])

/** The pear within 40 pieces, and what the fit showed on the way, made once. */
const pearFit = (() => {
  let made: ReturnType<typeof fit> | undefined
  const fit = () => {
    const triangles = pear()
    const shown: Array<ReadonlyArray<Placement>> = []
    const result = platesWhole(triangles, gridOf(triangles), { ...options, budget: 40 }, (placements) => {
      shown.push(placements)
    })
    return { triangles, result, shown }
  }
  return () => made ??= fit()
})()

/** What a fit keeps to itself, which no report may hold. */
const PRIVATE = ["source", "surfaceMesh", "mirror", "fitGrid", "primitives", "covers", "coverGrow"]

afterEach(() => setClock(() => performance.now()))

describe("platesWhole without a budget", () => {
  it("fits one mesh of the faces asked for: a box is one plate a side", async () => {
    await meshReady
    const triangles = block()
    const result = platesWhole(triangles, gridOf(triangles), options)
    assert.strictEqual(result.representation, "mesh")
    assert.strictEqual(result.plates, 6)
    assert.strictEqual(result.placements.length, 6)
    assert.isUndefined(result.stages)
    assert.isUndefined(result.alternatives)
    for (const key of PRIVATE) assert.notProperty(result, key)
  })
})

describe("platesWhole within a budget", () => {
  it("gives the model's bounds as one cube when even four faces take too many pieces", async () => {
    await meshReady
    const triangles = pear()
    // A thickness leaves out the rectangles through the solid, of which two would do.
    const thick = { ...options, thickness: 20 }
    const result = platesWhole(triangles, gridOf(triangles), { ...thick, budget: 2 })
    assert.strictEqual(result.representation, "bounds")
    assert.strictEqual(result.placements.length, 1)
    const { max, min } = trianglesBox(triangles)
    const cube = result.placements[0]
    assert.isDefined(cube)
    assert.strictEqual(cube.kind, "box")
    assert.approximately(cube.center.z, (min.z + max.z) / 2, 1e-3)
    assert.approximately(cube.half.x, (max.x - min.x) / 2, 1e-3)
    assert.isEmpty(platesWhole(triangles, gridOf(triangles), { ...thick, budget: 0 }).placements)
  })

  it("stays within the budget, times its stages and reports the best of each representation", async () => {
    await meshReady
    const { result, triangles } = pearFit()
    assert.isAtMost(result.placements.length, 40)
    assert.strictEqual(result.representation, "mesh")
    assert.strictEqual(result.tags?.length, result.placements.length)
    assert.includeMembers(Object.keys(result.stages ?? {}), [
      "mesh",
      "slabs",
      "strips",
      "extrusions",
      "score",
      "parts",
      "search",
      "total"
    ])
    assert.isUndefined(result.search)
    assert.isDefined(result.sweep)
    const mesh = result.alternatives?.mesh
    assert.isDefined(mesh)
    assert.strictEqual(mesh.pieces, mesh.placements.length)
    assert.approximately(mesh.score, lookOfPlacements(modelViews(triangles), mesh.placements).score, 1e-12)
    for (const key of PRIVATE) assert.notProperty(result, key)
  })

  it("takes rectangles through the solid where they look better than a mesh: a box is one", async () => {
    await meshReady
    const triangles = block()
    const result = platesWhole(triangles, gridOf(triangles), { ...options, budget: 12 })
    assert.strictEqual(result.representation, "rectangles")
    assert.strictEqual(result.placements.length, 1)
    assert.deepStrictEqual(result.tags, ["slab"])
    assert.isDefined(result.alternatives?.mesh)
    // The slab is clipped to the model's bounds.
    assert.approximately(result.placements[0]?.half.y ?? 0, 1000, 1e-3)
  })

  it("stands one primitive in for a stretch of surface that follows it, and reports it", async () => {
    await meshReady
    const triangles = ballTriangles(1000)
    const result = platesWhole(triangles, gridOf(triangles), { ...options, budget: 12, primitives: 1 })
    // Twelve pieces make a poor ball; one sphere hides every face of the mesh.
    assert.deepStrictEqual(result.placements.map((piece) => piece.kind), ["sphere"])
    assert.deepStrictEqual(result.tags, ["bulk"])
    assert.deepStrictEqual(result.bulk?.map(({ kind }) => kind), ["sphere"])
    assert.includeMembers(Object.keys(result.stages ?? {}), ["bulkFit", "bulkJudged", "bulk"])
    const never = platesWhole(triangles, gridOf(triangles), { ...options, budget: 12 })
    assert.isUndefined(never.bulk)
    assert.notProperty(never.stages, "bulkFit")
  })

  it("tries no rectangles through the model's depth with a thickness set", async () => {
    await meshReady
    const triangles = block()
    const result = platesWhole(triangles, gridOf(triangles), { ...options, thickness: 20, budget: 12 })
    assert.notProperty(result.stages, "slabs")
    assert.isUndefined(result.alternatives?.rectangles)
    assert.notInclude(result.tags ?? [], "slab")
    assert.notInclude(result.tags ?? [], "strip")
  })

  it("shows only candidates that look better than the last shown, and ends on the best it showed", async () => {
    await meshReady
    const { result, shown, triangles } = pearFit()
    const views = modelViews(triangles)
    assert.isAbove(shown.length, 0)
    const scores = shown.map((placements) => lookOfPlacements(views, placements).score)
    scores.forEach((score, i) => {
      if (i > 0) assert.isAbove(score, scores[i - 1] ?? 0)
    })
    for (const placements of shown) assert.isAtMost(placements.length, 40)
    assert.isAtLeast(lookOfPlacements(views, result.placements).score + 0.01, scores.at(-1) ?? 0)
  })

  it("says whether the mesh is symmetric only where the model has a mirror plane and symmetry is on", async () => {
    await meshReady
    const triangles = pear(), grid = gridOf(triangles)
    const tied = platesWhole(triangles, grid, { ...options, budget: 24, symmetry: true })
    assert.isBoolean(tied.symmetric)
    assert.property(tied.stages, "symmetry")
    assert.property(tied.stages, "mirror")
    const free = platesWhole(triangles, grid, { ...options, budget: 24 })
    assert.isUndefined(free.symmetric)
    assert.notProperty(free.stages, "symmetry")
    assert.notProperty(free.stages, "mirror")
  })

  it("searches the best mesh when given seconds, and never ends worse than it began", async () => {
    await meshReady
    // A clock that ticks 50 ms a read: the search ends on its reads, not on the machine's speed.
    let ticks = 0
    setClock(() => 50 * ticks++)
    const triangles = pear(), grid = gridOf(triangles, 12)
    const result = platesWhole(triangles, grid, { ...options, budget: 24, searchSeconds: 1 })
    assert.isDefined(result.search)
    assert.isAtLeast(result.search.after, result.search.before)
    assert.isAtMost(result.placements.length, 24)
  })
})

describe("searchCap", () => {
  it("is the seconds asked for, between none and the slider's most, and the most when none are asked for", () => {
    assert.strictEqual(searchCap({ ...options, searchSeconds: 7 }), 7)
    assert.strictEqual(searchCap({ ...options, searchSeconds: -1 }), 0)
    assert.strictEqual(searchCap({ ...options, searchSeconds: 99 }), 20)
    assert.strictEqual(searchCap({ faces: 100, flatness: 12, thickness: 0 }), 20)
  })
})
