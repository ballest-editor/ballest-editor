import { assert, describe, it } from "@effect/vitest"
import { ballTriangles } from "../../../test/triangles"
import { gridOver, trianglesBox, type VoxelGrid, voxelize } from "../grid/voxelize"
import { meshReady } from "../mesh/mesh"
import { PlateSource } from "../mesh/remesh"
import type { Placement } from "../shapes"
import { candidatesOf } from "./plateCandidates"

const options = { faces: 100, flatness: 12, thickness: 0 }

/** A ball of radius 1000 on a 16-cell grid. */
const ball = (): { readonly grid: VoxelGrid; readonly source: PlateSource } => {
  const triangles = ballTriangles(1000, [0, 0, 0], 12, 16)
  const grid = voxelize(triangles, gridOver(trianglesBox(triangles), 16), { surface: true })
  return { grid, source: new PlateSource(triangles, grid) }
}

describe("candidatesOf", () => {
  it("gives up to three meshes within the budget, finest first, and shows every fit within it", async () => {
    await meshReady
    const { grid, source } = ball()
    const shown: Array<ReadonlyArray<Placement>> = []
    const found = candidatesOf(grid, options, source, 40, { show: (placements) => shown.push(placements) })
    assert.isAbove(found.length, 0)
    assert.isAtMost(found.length, 3)
    for (const result of found) assert.isAtMost(result.placements.length, 40)
    const faces = found.map((result) => result.faces)
    assert.deepStrictEqual(faces, faces.toSorted((a, b) => b - a))
    // The finest lands near the budget: a face takes a piece or two.
    assert.isAtLeast(found[0]?.placements.length ?? 0, 30)
    for (const placements of shown) assert.isAtMost(placements.length, 40)
    for (const result of found) assert.include(shown, result.placements)
  })

  it("gives nothing when four faces already take more than the budget", async () => {
    await meshReady
    const { grid, source } = ball()
    assert.isEmpty(candidatesOf(grid, options, source, 2))
  })

  it("makes at most three fits from a start that is near, and tries no neighbouring counts", async () => {
    await meshReady
    const { grid, source } = ball()
    const best = candidatesOf(grid, options, source, 40)[0]
    assert.isDefined(best)
    const shown: Array<ReadonlyArray<Placement>> = []
    const near = candidatesOf(grid, options, source, 40, {
      show: (placements) => shown.push(placements),
      start: best.faces,
      near: true
    })
    assert.isAtMost(shown.length, 3)
    assert.strictEqual(near[0]?.faces, best.faces)
    assert.deepStrictEqual(near[0]?.placements, best.placements)
  })

  it("tries a finer mesh when primitives cover part of the surface", async () => {
    await meshReady
    const { grid, source } = ball()
    const cover: Placement = {
      kind: "sphere",
      center: { x: 0, y: 0, z: 0 },
      half: { x: 1000, y: 1000, z: 1000 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }
    }
    const plain = candidatesOf(grid, options, source, 12)[0]
    const covered = candidatesOf(grid, { ...options, covers: [cover], coverGrow: 200 }, source, 12)[0]
    assert.isDefined(plain)
    assert.isDefined(covered)
    // Faces the ball hides take no pieces, so the same budget holds more of them.
    assert.isAbove(covered.faces, plain.faces)
    assert.isAbove(covered.paths.hidden, 0)
  })
})
