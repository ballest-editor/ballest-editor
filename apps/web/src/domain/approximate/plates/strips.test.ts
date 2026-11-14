import { assert, describe, it } from "@effect/vitest"
import { boxTriangles } from "../../../test/boxTriangles"
import { plateSurface, prismTriangles, regularOutline } from "../../../test/plateSurface"
import { meshReady } from "../mesh/mesh"
import { stripsWithin } from "./strips"

describe("stripsWithin", () => {
  it("covers a prism's sides with one strip each and its ends with rectangles", async () => {
    await meshReady
    // Twelve sides 2000 cm long and 2 · 500 · sin 15° = 259 cm wide.
    const { grid, triangles } = plateSurface(prismTriangles(regularOutline(12, 500), 0, 2000), 32)
    const fits = stripsWithin(triangles, grid, grid.voxel, 60)
    assert.isNotEmpty(fits)
    for (const fit of fits) {
      assert.isAtMost(fit.placements.length, 60)
      assert.strictEqual(fit.patches, 14)
      assert.isAtLeast(fit.flatness, 2)
      assert.isAtMost(fit.flatness, 80)
      const strips = fit.placements.filter((plate) => Math.max(plate.half.x, plate.half.y) > 900)
      assert.lengthOf(strips, 12)
      for (const strip of strips) {
        assert.strictEqual(strip.kind, "box")
        assert.closeTo(Math.min(strip.half.x, strip.half.y), 259 / 2, 15)
        assert.closeTo(strip.half.z, grid.voxel / 2, 1e-9)
        // On the side, not out at its edges' radius.
        assert.isBelow(Math.hypot(strip.center.x, strip.center.y), 500 * Math.cos(Math.PI / 12))
      }
    }
  })

  it("makes one fit for each smallest patch area that the budget's patches allow", async () => {
    await meshReady
    const { grid, triangles } = plateSurface(boxTriangles([0, 0, 0], [900, 700, 500]))
    // A box is six patches however flat: half a budget of 8 is too few, and four is the least tried.
    assert.deepStrictEqual(stripsWithin(triangles, grid, grid.voxel, 8), [])
    const fits = stripsWithin(triangles, grid, grid.voxel, 12)
    assert.lengthOf(fits, 2)
    for (const fit of fits) {
      assert.deepStrictEqual([fit.patches, fit.rejected], [6, 0])
      assert.isAtLeast(fit.placements.length, 6)
      assert.isAtMost(fit.placements.length, 12)
    }
    assert.isBelow(fits[0]?.minArea ?? 0, fits[1]?.minArea ?? 0)
  })

  it("drops the smallest rectangles past the budget", async () => {
    await meshReady
    // A step: six flat sides, the two L-shaped ones taking two rectangles each.
    const outline = [[0, 0], [800, 0], [800, 300], [400, 300], [400, 800], [0, 800]] as const
    const { grid, triangles } = plateSurface(prismTriangles(outline, 0, 600), 32)
    const [roomy] = stripsWithin(triangles, grid, grid.voxel, 40)
    const [tight] = stripsWithin(triangles, grid, grid.voxel, 16)
    assert.strictEqual(roomy?.patches, 8)
    assert.isAbove(roomy?.placements.length ?? 0, 8)
    assert.lengthOf(tight?.placements ?? [], Math.min(16, roomy?.placements.length ?? 0))
    const area = (plate: { readonly half: { readonly x: number; readonly y: number } }) => plate.half.x * plate.half.y
    const largestFirst = (plates: ReadonlyArray<Parameters<typeof area>[0]>) => plates.map(area).sort((a, b) => b - a)
    assert.deepStrictEqual(
      largestFirst(tight?.placements ?? []),
      largestFirst(roomy?.placements ?? []).slice(0, tight?.placements.length)
    )
  })
})
