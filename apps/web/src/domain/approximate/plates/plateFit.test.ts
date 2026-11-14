import { assert, describe, it } from "@effect/vitest"
import { boxTriangles } from "../../../test/boxTriangles"
import { upright } from "../../../test/placement"
import { type PlateSurface, plateSurface, prismTriangles, regularOutline } from "../../../test/plateSurface"
import { sphereTriangles } from "../../../test/triangles"
import { assertVec } from "../../../test/vec"
import { meshReady } from "../mesh/mesh"
import { PlateSource } from "../mesh/remesh"
import { fitPlates } from "./plateFit"
import { pieceWorld } from "./platePieces"
import { emptyPaths } from "./plateTypes"

const options = { faces: 0, flatness: 12, thickness: 0 }

/** The plates over `surface`'s own mesh. */
const fitOf = (surface: PlateSurface, extra: Partial<Parameters<typeof fitPlates>[1]> = {}) =>
  fitPlates(surface.grid, { ...options, ...extra }, new PlateSource(surface.triangles, surface.grid), surface.mesh)

/** An octahedron with its corners 500 cm from the origin along the axes. */
const octahedron = plateSurface(
  sphereTriangles(2, 4, (i, j) => {
    const ring = [[500, 0], [0, 500], [-500, 0], [0, -500]][j % 4] ?? [0, 0]
    return i === 1 ? [ring[0] ?? 0, ring[1] ?? 0, 0] : [0, 0, i === 0 ? 500 : -500]
  })
)

/** A ball of radius 500 cm about the origin. */
const ballTriangles = (rings: number, segments: number) =>
  sphereTriangles(rings, segments, (i, j) => {
    const theta = Math.PI * i / rings, phi = 2 * Math.PI * j / segments
    return [500 * Math.sin(theta) * Math.cos(phi), 500 * Math.sin(theta) * Math.sin(phi), 500 * Math.cos(theta)]
  })

describe("fitPlates", () => {
  it("covers each flat side of a box with one rectangle, a voxel thick, its outer face on the side", () => {
    const box = plateSurface(boxTriangles([0, 0, 0], [800, 800, 800]))
    const fit = fitOf(box)
    assert.strictEqual(fit.representation, "mesh")
    assert.deepStrictEqual([fit.faces, fit.patches, fit.plates, fit.triangles], [12, 6, 6, 0])
    assert.deepStrictEqual(fit.tags, ["rectangle", "rectangle", "rectangle", "rectangle", "rectangle", "rectangle"])
    assert.deepStrictEqual(fit.paths, { ...emptyPaths(), rectangle: 12 })
    for (const plate of fit.placements) {
      assert.strictEqual(plate.kind, "box")
      assert.closeTo(plate.half.z, box.grid.voxel / 2, 1e-9)
      // Past each side by 15% of the thickness.
      assert.closeTo(plate.half.x, 400 + box.grid.voxel * 0.15, 1e-3)
      assert.closeTo(plate.half.y, 400 + box.grid.voxel * 0.15, 1e-3)
      const outer = pieceWorld(plate)(0, 0, 1)
      assert.closeTo(Math.max(Math.abs(outer.x - 400), Math.abs(outer.y - 400), Math.abs(outer.z - 400)), 400, 1e-3)
    }
    assert.strictEqual(fit.surfaceMesh, box.mesh)
  })

  it("keeps plates as thick as asked", () => {
    const fit = fitOf(plateSurface(boxTriangles([0, 0, 0], [800, 800, 800])), { thickness: 30 })
    for (const plate of fit.placements) assert.closeTo(plate.half.z, 15, 1e-9)
  })

  it("gives an acute face one side of a pyramid that fills the model behind it", () => {
    const fit = fitOf(octahedron)
    assert.deepStrictEqual([fit.faces, fit.patches, fit.plates, fit.triangles], [8, 8, 0, 8])
    assert.deepStrictEqual(fit.paths, { ...emptyPaths(), one: 8 })
    assert.deepStrictEqual([...new Set(fit.tags)], ["one"])
    // Each pyramid is half the octahedron: its base the square through four corners, its apex the fifth.
    for (const pyramid of fit.placements) {
      assert.strictEqual(pyramid.kind, "pyramid")
      assertVec(pyramid.half, { x: 500, y: 500, z: 250 }, "half", 1e-2)
      assert.closeTo(Math.hypot(pyramid.center.x, pyramid.center.y, pyramid.center.z), 250, 1e-2)
    }
  })

  it("covers a face that isn't acute with two overlapping pyramid sides, and falls back to lenses in a thin model", () => {
    // A ball of four rings: the faces round its middle are quads cut in two, with a wide corner each.
    const fit = fitOf(plateSurface(ballTriangles(4, 8)))
    assert.deepStrictEqual(fit.paths, { ...emptyPaths(), one: 32, overlap: 16 })
    assert.deepStrictEqual([fit.plates, fit.triangles], [0, 64])
    assert.lengthOf(fit.tags?.filter((tag) => tag === "pair") ?? [], 32)
    for (const piece of fit.placements) assert.strictEqual(piece.kind, "pyramid")

    // A corner cut off a cube: behind each of its faces a pyramid would come out of another.
    const corner = plateSurface(
      new Float32Array([
        [0, 0, 0, 0, 600, 0, 600, 0, 0],
        [0, 0, 0, 0, 0, 600, 0, 600, 0],
        [0, 0, 0, 600, 0, 0, 0, 0, 600],
        [600, 0, 0, 0, 600, 0, 0, 0, 600]
      ].flat())
    )
    const lenses = fitOf(corner)
    assert.deepStrictEqual({ ...lenses.paths, thinned: 0 }, { ...emptyPaths(), lensDepth: 1, splitDepth: 3 })
    assert.deepStrictEqual([...new Set(lenses.tags)], ["lens"])
  })

  it("covers a face with lenses where a pyramid behind it would come out of the model's other side", () => {
    // A triangular plate 20 cm thick: a pyramid behind either cap is some 700 cm deep.
    const plate = plateSurface(prismTriangles(regularOutline(3, 600), 0, 20), 32)
    const fit = fitOf(plate)
    assert.deepStrictEqual({ ...fit.paths, thinned: 0 }, { ...emptyPaths(), lensDepth: 2, rectangle: 6 })
    // The rectangles on its sides are halved until their inner corners fit its sharp corners.
    assert.isAbove(fit.paths.thinned, 0)
    assert.deepStrictEqual([fit.plates, fit.triangles], [3, 2])
    const lenses = fit.placements.filter((_, k) => fit.tags?.[k] === "lens")
    assert.lengthOf(lenses, 2)
    for (const lens of lenses) {
      // An equilateral cap is one lens, grown 4% to tuck under the rectangles and no thicker than the plate.
      assert.closeTo(lens.half.y, 600 * Math.sqrt(3) / 2 * 1.04, 1e-2)
      assert.isAtMost(lens.half.x * 2, 20)
      assert.isTrue(lens.center.z > 0 && lens.center.z < 20)
    }
  })

  it("gives no pieces to the faces a cover hides, and puts the covers first", () => {
    const ball = upright("sphere", [0, 0, 0], [600, 600, 600])
    const hidden = fitOf(octahedron, { covers: [ball], coverGrow: 5 })
    assert.deepStrictEqual(hidden.placements, [ball])
    assert.deepStrictEqual(hidden.tags, ["bulk"])
    assert.deepStrictEqual(hidden.paths, { ...emptyPaths(), hidden: 8 })
    assert.deepStrictEqual([hidden.covers, hidden.coverGrow], [[ball], 5])

    // A ball over the top corner alone hides no whole face: the corners below stand out of it.
    const cap = upright("sphere", [0, 0, 500], [300, 300, 300])
    const shown = fitOf(octahedron, { covers: [cap] })
    assert.deepStrictEqual(shown.placements.slice(0, 1), [cap])
    assert.deepStrictEqual(shown.paths, { ...emptyPaths(), one: 8 })
    assert.strictEqual(shown.coverGrow, 0)
    assert.isUndefined(fitOf(octahedron).covers)
  })

  it("remeshes the source to the face count asked for when no mesh is supplied", async () => {
    await meshReady
    const ball = plateSurface(ballTriangles(16, 32))
    const source = new PlateSource(ball.triangles, ball.grid)
    const fit = fitPlates(ball.grid, { ...options, faces: 60 }, source)
    assert.closeTo(fit.faces, 60, 4)
    assert.strictEqual(fit.source, source)
    assert.isFalse(fit.repaired)
    assert.strictEqual(fit.placements.length, fit.plates + fit.triangles)
    assert.lengthOf(fit.tags ?? [], fit.placements.length)
    const counted = fit.paths.one + fit.paths.overlap + fit.paths.lensDepth + fit.paths.lensProtrusion +
      fit.paths.splitDepth + fit.paths.splitProtrusion + fit.paths.splitNonAcute + fit.paths.rectangle
    assert.strictEqual(counted, fit.faces)
    assert.isAbove(fit.acuteAfter, 0)
  })
})
