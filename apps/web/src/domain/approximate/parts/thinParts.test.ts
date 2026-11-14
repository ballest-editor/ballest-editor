import { assert, describe, it } from "@effect/vitest"
import { vecDot, vecLength, vecSub } from "../../ueMath"
import { cellIndex, type VoxelGrid } from "../grid/voxelize"
import { trianglesOfMesh } from "../mesh/mesh"
import { cleanSurface } from "../mesh/remesh"
import {
  eigen,
  eligible,
  FLAT_PART,
  momentsOf,
  partFlatness,
  partPrimitives,
  primitiveOf,
  thinParts,
  trimmedSurface
} from "./thinParts"

const VOXEL = 10

/** An empty grid of 10 cm cells with its corner at the origin. */
const emptyGrid = (nx: number, ny: number, nz: number): VoxelGrid => ({
  n: [nx, ny, nz],
  origin: { x: 0, y: 0, z: 0 },
  voxel: VOXEL,
  cells: new Uint8Array(nx * ny * nz)
})

/** Makes the cells from `from` up to, not including, `to` solid, and returns their indices. */
const fill = (grid: VoxelGrid, from: readonly [number, number, number], to: readonly [number, number, number]) => {
  const cells: Array<number> = []
  for (let z = from[2]; z < to[2]; z++) {
    for (let y = from[1]; y < to[1]; y++) {
      for (let x = from[0]; x < to[0]; x++) {
        grid.cells[cellIndex(grid, x, y, z)] = 1
        cells.push(cellIndex(grid, x, y, z))
      }
    }
  }
  return cells
}

/** A block of 24 cells a side with a rod 3 cells across and 12 long standing off the middle of its +x face. */
const blockWithRod = () => {
  const grid = emptyGrid(44, 32, 32)
  fill(grid, [4, 4, 4], [28, 28, 28])
  const rod = fill(grid, [28, 15, 15], [40, 18, 18])
  return { grid, rod }
}

/** The block with a sheet 2 cells thick and 14 wide bent up like an ear, and a rod standing off its top. */
const blockWithSheetAndRod = () => {
  const grid = emptyGrid(48, 32, 60)
  fill(grid, [4, 4, 4], [28, 28, 28])
  fill(grid, [28, 9, 14], [38, 23, 16])
  fill(grid, [36, 9, 16], [38, 23, 26])
  fill(grid, [15, 15, 28], [18, 18, 52])
  const { parts } = thinParts(grid)
  const sheet = parts.find((part) => part.cells.every((i) => i % 48 >= 26))
  const rod = parts.find((part) => part.cells.every((i) => Math.floor(i / (48 * 32)) >= 26 && i % 48 < 26))
  if (sheet === undefined || rod === undefined) throw new Error("no sheet or rod")
  return { grid, sheet, rod }
}

describe("thin parts", () => {
  it("finds a rod standing off a block, with how far it reaches and where it joins", () => {
    const { grid, rod } = blockWithRod()
    const { core, parts, radius } = thinParts(grid)
    // The block is 24 cells through, so its deepest cell is 12 from the outside.
    assert.closeTo(radius, 4, 0.5)
    assert.lengthOf(parts, 1)
    const [part] = parts
    if (part === undefined) return assert.fail("no part")
    const cells = new Set(part.cells)
    // The part is the rod, and may take a few of the block's cells round its foot.
    for (const i of rod) assert.isTrue(cells.has(i) || core[i] === 1)
    assert.isAtLeast(rod.filter((i) => cells.has(i)).length, 80)
    for (const i of part.cells) assert.strictEqual(core[i], 0)
    assert.closeTo(part.reach, 12, 1.5)
    assert.isNotEmpty(part.joint)
    for (const j of part.joint) {
      assert.strictEqual(core[j], 1)
      assert.isTrue([1, -1, 44, -44, 44 * 32, -44 * 32].some((step) => cells.has(j + step)))
    }
    // The block's middle is core.
    assert.strictEqual(core[cellIndex(grid, 16, 16, 16)], 1)
  })

  it("leaves out a nub that doesn't reach far out of the core", () => {
    const grid = emptyGrid(44, 32, 32)
    fill(grid, [4, 4, 4], [28, 28, 28])
    fill(grid, [28, 14, 14], [30, 19, 19])
    assert.isEmpty(thinParts(grid).parts)
  })

  it("doesn't join a part at the end of a row to the cells at the start of the next", () => {
    const grid = emptyGrid(30, 30, 30)
    fill(grid, [3, 3, 3], [27, 27, 27])
    // Two rods on one line of cells, out to the grid's two x ends.
    fill(grid, [27, 14, 14], [30, 17, 17])
    fill(grid, [0, 14, 14], [3, 17, 17])
    fill(grid, [27, 14, 20], [30, 17, 23])
    for (const part of thinParts(grid).parts) {
      const columns = [...part.cells].map((i) => i % 30)
      assert.isTrue(columns.every((x) => x >= 15) || columns.every((x) => x < 15))
    }
  })
})

describe("the eigenvectors of a symmetric matrix", () => {
  it("come largest first, at unit length, each with its own value", () => {
    const m = [[4, 1, 0.5], [1, 3, -0.25], [0.5, -0.25, 1]]
    const { values, vectors } = eigen(m)
    assert.deepStrictEqual(values, [...values].sort((a, b) => b - a))
    assert.closeTo((values[0] ?? 0) + (values[1] ?? 0) + (values[2] ?? 0), 8, 1e-12)
    vectors.forEach((v, k) => {
      assert.closeTo(vecLength(v), 1, 1e-12)
      const e = [v.x, v.y, v.z]
      m.forEach((row, r) => {
        const product = row.reduce((sum, x, c) => sum + x * (e[c] ?? 0), 0)
        assert.closeTo(product, (values[k] ?? 0) * (e[r] ?? 0), 1e-9)
      })
    })
  })

  it("are the axes of a diagonal matrix, and leave their argument alone", () => {
    const m = [[1, 0, 0], [0, 5, 0], [0, 0, 3]]
    assert.deepStrictEqual(eigen(m), {
      values: [5, 3, 1],
      vectors: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }]
    })
    assert.deepStrictEqual(m, [[1, 0, 0], [0, 5, 0], [0, 0, 3]])
  })
})

describe("the moments of some cells", () => {
  const grid = emptyGrid(40, 20, 20)
  /** 20 × 6 × 2 cells: 200 × 60 × 20 cm about (150, 80, 60). */
  const slab = fill(grid, [5, 5, 5], [25, 11, 7])

  it("are their centroid, their axes longest first and a solid box's spread along each", () => {
    const { axes, centroid, skew, variance } = momentsOf(grid, slab)
    assert.closeTo(vecLength(vecSub(centroid, { x: 150, y: 80, z: 60 })), 0, 1e-9)
    assert.closeTo(variance[0], 200 ** 2 / 12, 1e-6)
    assert.closeTo(variance[1], 60 ** 2 / 12, 1e-6)
    assert.closeTo(variance[2], 20 ** 2 / 12, 1e-6)
    assert.closeTo(Math.abs(axes[0].x), 1, 1e-9)
    assert.closeTo(Math.abs(axes[1].y), 1, 1e-9)
    assert.closeTo(Math.abs(axes[2].z), 1, 1e-9)
    assert.closeTo(skew, 0, 1e-3)
  })

  it("have a skew toward the cells' long tail", () => {
    // A thick foot and a thin tail along +x.
    const tapered = [...fill(grid, [5, 12, 12], [9, 18, 18]), ...fill(grid, [9, 14, 14], [30, 16, 16])]
    const { axes, skew } = momentsOf(grid, tapered)
    assert.isAbove(skew * axes[0].x, 0)
  })

  it("make a box and an ellipsoid as big as the cells, flat along their own z", () => {
    const moments = momentsOf(grid, slab)
    const box = primitiveOf("box", moments)
    assert.deepStrictEqual(box.center, moments.centroid)
    assert.closeTo(box.half.x, 100, 1e-6)
    assert.closeTo(box.half.y, 30, 1e-6)
    assert.closeTo(box.half.z, 10, 1e-6)
    const ball = primitiveOf("sphere", moments)
    assert.closeTo(ball.half.x / box.half.x, Math.sqrt(5 / 3), 1e-9)
    assert.closeTo(ball.half.z / box.half.z, Math.sqrt(5 / 3), 1e-9)
  })

  it("make a cylinder and a capsule along the longest axis", () => {
    const moments = momentsOf(grid, slab)
    for (const kind of ["cylinder", "capsule"] as const) {
      const piece = primitiveOf(kind, moments)
      assert.closeTo(piece.half.z, 100, 1e-6)
      assert.closeTo(piece.half.x, 2 * Math.sqrt(300), 1e-6)
      assert.closeTo(piece.half.y, 2 * Math.sqrt(100 / 3), 1e-6)
    }
  })

  it("make a cone whose centroid is the cells', pointing along their tail or, reversed, against it", () => {
    const moments = { ...momentsOf(grid, slab), skew: 1 }
    const toward = primitiveOf("cone", moments), away = primitiveOf("cone", moments, true)
    const height = 2 * toward.half.z
    assert.closeTo(height, Math.sqrt(80 * moments.variance[0] / 3), 1e-9)
    assert.closeTo(vecDot(vecSub(toward.center, moments.centroid), moments.axes[0]), height / 4, 1e-9)
    assert.closeTo(vecDot(vecSub(away.center, moments.centroid), moments.axes[0]), -height / 4, 1e-9)
    assert.deepStrictEqual(primitiveOf("cone", { ...moments, skew: -1 }), away)
  })

  it("make a half sphere domed along the thinnest axis, either way", () => {
    const moments = momentsOf(grid, slab)
    const up = primitiveOf("hemisphere", moments), down = primitiveOf("hemisphere", moments, true)
    assert.closeTo(2 * up.half.z, Math.sqrt(320 * moments.variance[2] / 19), 1e-9)
    assert.closeTo(vecDot(vecSub(up.center, moments.centroid), moments.axes[2]), up.half.z / 4, 1e-9)
    assert.closeTo(vecDot(vecSub(down.center, moments.centroid), moments.axes[2]), -up.half.z / 4, 1e-9)
  })

  it("never make a piece thinner than half a centimetre", () => {
    const flat = { ...momentsOf(grid, slab), variance: [100, 100, 0] as const }
    for (const kind of ["box", "sphere", "cylinder", "capsule", "cone", "pyramid", "hemisphere"] as const) {
      const { half } = primitiveOf(kind, flat)
      assert.isAtLeast(Math.min(half.x, half.y, half.z), kind === "hemisphere" ? 0.125 : 0.25)
    }
  })
})

describe("primitives for a thin part", () => {
  it("fit a rod with one piece that covers it and stays inside the model, best first", () => {
    const { grid } = blockWithRod()
    const [part] = thinParts(grid).parts
    if (part === undefined) return assert.fail("no part")
    const options = partPrimitives(grid, part)
    const [best] = options
    if (best === undefined) return assert.fail("no option")
    assert.lengthOf(best.pieces, 1)
    assert.isTrue(eligible(best))
    assert.isAtLeast(best.coverage, 0.6)
    assert.isBelow(best.spill, 0.05)
    // Those that fit well enough come first, and each group is by fit.
    const order = options.map((option) => [eligible(option) ? 0 : 1, -option.fit] as const)
    order.forEach(([group, fit], k) => {
      const [nextGroup, nextFit] = order[k + 1] ?? [2, 0]
      assert.isTrue(group < nextGroup || (group === nextGroup && fit <= nextFit))
    })
    for (const option of options) {
      assert.closeTo(option.fit, option.coverage - 2 * option.spill - 0.05 * (option.pieces.length - 1), 1e-12)
    }
  })

  it("offer chains along the part, named by their links", () => {
    const { grid } = blockWithRod()
    const [part] = thinParts(grid).parts
    if (part === undefined) return assert.fail("no part")
    const chains = partPrimitives(grid, part).filter((option) => option.pieces.length > 1)
    assert.isNotEmpty(chains)
    for (const chain of chains) {
      assert.isAtMost(chain.pieces.length, 4)
      assert.match(chain.label, /^(\d (flat )?[a-z ]+(s|es)|[a-z ]+( \+ [a-z ]+)+)$/)
    }
  })

  it("call an option that covers too little or spills too much unfit", () => {
    const option = { label: "box", pieces: [], fit: 0 }
    assert.isTrue(eligible({ ...option, coverage: 0.6, spill: 0.15 }))
    assert.isFalse(eligible({ ...option, coverage: 0.59, spill: 0 }))
    assert.isFalse(eligible({ ...option, coverage: 1, spill: 0.16 }))
  })

  it("count a bent sheet as flat and a rod as round", () => {
    const { grid, rod, sheet } = blockWithSheetAndRod()
    const triangles = trianglesOfMesh(cleanSurface(grid))
    assert.isBelow(partFlatness(grid, sheet, triangles), FLAT_PART)
    assert.isAbove(partFlatness(grid, rod, triangles), FLAT_PART)
    // With no surface inside the part there is nothing to call flat.
    assert.strictEqual(partFlatness(grid, sheet, new Float32Array(0)), 1)
  })

  it("give a flat part only flat boxes and flat ellipsoids, at most two", () => {
    const { grid, sheet } = blockWithSheetAndRod()
    const options = partPrimitives(grid, sheet, true)
    assert.isNotEmpty(options)
    for (const option of options) {
      assert.isAtMost(option.pieces.length, 2)
      for (const piece of option.pieces) assert.include(["box", "sphere"], piece.kind)
      assert.match(option.label, /^(2 )?flat (box|ellipsoid)(es|s)?$/)
    }
  })
})

describe("the surface a model keeps once a part is cut out", () => {
  it("is the model's own triangles away from the cut and the voxel surface over it", () => {
    const { grid } = blockWithRod()
    const [part] = thinParts(grid).parts
    if (part === undefined) return assert.fail("no part")
    const removed = new Uint8Array(grid.cells.length)
    for (const i of part.cells) removed[i] = 1
    const trimmed = { ...grid, cells: grid.cells.map((c, i) => removed[i] === 1 ? 0 : c) }
    const model = trianglesOfMesh(cleanSurface(grid))
    const kept = trimmedSurface(model, trimmed, removed)
    const centres = (list: Float32Array) =>
      Array.from(
        { length: list.length / 9 },
        (_, t) =>
          [0, 1, 2].map((k) => ((list[9 * t + k] ?? 0) + (list[9 * t + 3 + k] ?? 0) + (list[9 * t + 6 + k] ?? 0)) / 3)
      )
    // Nothing is left of the rod past the cut's cover, and the block's far side is all there.
    const far = (x: number) => x < 100
    assert.isTrue(centres(kept).every(([x = 0]) => x < 28 * VOXEL + 3 * VOXEL))
    assert.strictEqual(
      centres(kept).filter(([x = 0]) => far(x)).length,
      centres(model).filter(([x = 0]) => far(x)).length
    )
    // The cut is closed over by the voxel surface of what is left: the rod's first cell stays with the core, so it
    // ends halfway between that cell's centre (x = 285) and the next.
    assert.isTrue(
      centres(kept).some(([x = 0, y = 0, z = 0]) =>
        Math.abs(x - 290) < 1 && Math.abs(y - 165) < 10 && Math.abs(z - 165) < 10
      )
    )
    assert.isAbove(kept.length, 0)
    assert.isBelow(kept.length, model.length)
  })
})
