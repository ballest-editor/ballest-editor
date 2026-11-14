import { assert, describe, it } from "@effect/vitest"
import { boxTriangles, countOf } from "../../../test/boxTriangles"
import { sphereTriangles } from "../../../test/triangles"
import {
  at,
  cellCount,
  cellIndex,
  forEachSolid,
  gridOver,
  pointAt,
  trianglesBox,
  type VoxelGrid,
  voxelize
} from "./voxelize"

/** The volume of `triangles`' solid cells at `resolution`, in cubic cm. */
const volumeOf = (triangles: Float32Array, resolution: number, surface = false) => {
  const grid = voxelize(triangles, gridOver(trianglesBox(triangles), resolution), { surface })
  return countOf(grid.cells) * grid.voxel ** 3
}

const BLOCK = 1000 * 2000 * 500
const block = () => boxTriangles([0, 0, 0], [1000, 2000, 500])

/** `triangles` with the corners of the triangles `which` picks swapped, so they face the other way. */
const flipped = (triangles: Float32Array, which: (triangle: number) => boolean): Float32Array => {
  const out = triangles.slice()
  for (let t = 0; t < triangles.length / 9; t++) {
    if (!which(t)) continue
    out.set(triangles.subarray(9 * t + 3, 9 * t + 6), 9 * t + 6)
    out.set(triangles.subarray(9 * t + 6, 9 * t + 9), 9 * t + 3)
  }
  return out
}

describe("gridOver", () => {
  it("lays the resolution along the longest side, with an empty cell all round, centred on the box", () => {
    const frame = gridOver(trianglesBox(block()), 20)
    assert.strictEqual(frame.voxel, 100)
    assert.deepStrictEqual(frame.n, [12, 22, 7])
    assert.deepStrictEqual(frame.origin, { x: -100, y: -100, z: -100 })
    assert.strictEqual(cellCount(frame), 12 * 22 * 7)
    assert.strictEqual(cellIndex(frame, 3, 2, 1), 3 + 12 * (2 + 22))
  })

  it("gives a flat model one cell of thickness", () => {
    const sheet = new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0])
    assert.deepStrictEqual(gridOver(trianglesBox(sheet), 10).n, [12, 12, 3])
  })
})

describe("trianglesBox", () => {
  it("spans every corner", () => {
    const box = trianglesBox(new Float32Array([1, -2, 3, -4, 5, 6, 7, 8, -9]))
    assert.deepStrictEqual(box, { min: { x: -4, y: -2, z: -9 }, max: { x: 7, y: 8, z: 6 } })
    assert.deepStrictEqual(pointAt(new Float32Array([1, -2, 3, -4, 5, 6]), 1), { x: -4, y: 5, z: 6 })
  })
})

describe("voxelize", () => {
  it("fills a box exactly when its sides fall on cell boundaries", () => {
    assert.closeTo(volumeOf(block(), 20), BLOCK, 1e-6 * BLOCK)
  })

  it("fills a closed round mesh's volume", () => {
    const ball = sphereTriangles(24, 48, (i, j) => {
      const theta = Math.PI * i / 24, phi = 2 * Math.PI * j / 48
      return [1000 * Math.sin(theta) * Math.cos(phi), 1000 * Math.sin(theta) * Math.sin(phi), 1000 * Math.cos(theta)]
    })
    const exact = 4 / 3 * Math.PI * 1000 ** 3
    assert.isBelow(Math.abs(volumeOf(ball, 48) - exact) / exact, 0.05)
  })

  it("fills two closed shells pushed through each other as their union", () => {
    // Parity would call the overlap empty: a ray through it crosses four faces.
    const a = boxTriangles([0, 0, 0], [1000, 1000, 1000]), b = boxTriangles([500, 500, 500], [1500, 1500, 1500])
    const union = 2 * 1000 ** 3 - 500 ** 3
    assert.closeTo(volumeOf(Float32Array.of(...a, ...b), 30), union, 1e-6 * union)
  })

  it("fills a shell wound inside out, or with some faces wound the wrong way", () => {
    assert.closeTo(volumeOf(flipped(block(), () => true), 20), BLOCK, 1e-6 * BLOCK)
    // The top's two triangles: rays through them no longer count back to zero, and fall back to parity.
    assert.closeTo(volumeOf(flipped(block(), (t) => t === 2 || t === 3), 20), BLOCK, 1e-6 * BLOCK)
  })

  it("fills a box with a side missing: the rays through the hole don't vote, and the other two agree", () => {
    assert.closeTo(volumeOf(block().subarray(0, 9 * 10), 20), BLOCK, 1e-6 * BLOCK)
  })

  it("shows an open sheet only with its surface cells filled", () => {
    const sheet = block().subarray(0, 18)
    assert.strictEqual(volumeOf(sheet, 20), 0)
    // The sheet is 10 cells by 20 on a cell boundary; the samples on its far edges fall in the next cells over.
    assert.strictEqual(volumeOf(sheet, 20, true), 11 * 21 * 100 ** 3)
  })

  it("adds the cells the surface passes through to a closed mesh's", () => {
    const tilted = Float32Array.of(...block(), 0, 0, 500, 1000, 0, 900, 0, 2000, 900)
    assert.isAbove(volumeOf(tilted, 20, true), volumeOf(tilted, 20))
  })
})

describe("forEachSolid", () => {
  it("visits the solid cells x first, then y, then z, and calls everything past the grid empty", () => {
    const grid: VoxelGrid = {
      n: [2, 2, 2],
      origin: { x: 0, y: 0, z: 0 },
      voxel: 1,
      cells: Uint8Array.of(0, 1, 1, 0, 0, 0, 0, 1)
    }
    const seen: Array<ReadonlyArray<number>> = []
    forEachSolid(grid, grid.cells, (x, y, z, solid) => {
      seen.push([x, y, z])
      assert.isTrue(solid(x, y, z))
      assert.isFalse(solid(-1, y, z) || solid(x, 2, z) || solid(x, y, 2))
    })
    assert.deepStrictEqual(seen, [[1, 0, 0], [0, 1, 0], [1, 1, 1]])
    assert.strictEqual(at(grid.cells, cellIndex(grid, 1, 1, 1)), 1)
  })
})
