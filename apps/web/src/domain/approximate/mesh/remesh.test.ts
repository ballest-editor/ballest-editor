import { assert, describe, it } from "@effect/vitest"
import { sphereTriangles } from "../../../test/triangles"
import { vecLength, vecSub } from "../../ueMath"
import { cellIndex, type VoxelGrid } from "../grid/voxelize"
import { mirrorRemesh } from "../plates/plateMirror"
import { faceCount, type Mesh, meshReady, trianglesOfMesh, welded } from "./mesh"
import { MeshSolid } from "./meshSolid"
import { meshVertex } from "./plateMesh"
import { acuteShare, cleanSurface, needsCleanSurface, PlateSource } from "./remesh"

const RADIUS = 100

/** A sphere of radius 100 about the origin, 24 rings of 32 segments: 1472 faces. */
const sphere = sphereTriangles(24, 32, (i, j) => {
  const polar = Math.PI * i / 24, turn = 2 * Math.PI * (j % 32) / 32
  return [
    RADIUS * Math.sin(polar) * Math.cos(turn),
    RADIUS * Math.sin(polar) * Math.sin(turn),
    RADIUS * Math.cos(polar)
  ]
})

/** The sphere with its first 40 faces missing: a hole at one pole. */
const holed = sphere.slice(9 * 40)

/** A grid of 10 cm cells about the origin whose solid cells are those with their centre in the ball of radius 100. */
const ballGrid = (): VoxelGrid => {
  const n = 24, voxel = 10
  const grid = { n: [n, n, n] as const, origin: { x: -120, y: -120, z: -120 }, voxel, cells: new Uint8Array(n * n * n) }
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const centre = Math.hypot((x + 0.5) * voxel - 120, (y + 0.5) * voxel - 120, (z + 0.5) * voxel - 120)
        if (centre <= RADIUS) grid.cells[cellIndex(grid, x, y, z)] = 1
      }
    }
  }
  return grid
}

const radii = (mesh: Mesh): Array<number> => [...new Set(mesh.indices)].map((i) => vecLength(meshVertex(mesh, i)))

describe("the share of acute faces", () => {
  const face = (...corners: ReadonlyArray<number>): Mesh => ({
    positions: new Float32Array(corners),
    indices: new Uint32Array([0, 1, 2])
  })

  it("counts a face whose corners are all under a right angle, and no other", () => {
    assert.strictEqual(acuteShare(face(0, 0, 0, 2, 0, 0, 1, 2, 0)), 1)
    assert.strictEqual(acuteShare(face(0, 0, 0, 2, 0, 0, 0, 2, 0)), 0)
    assert.strictEqual(acuteShare(face(0, 0, 0, 2, 0, 0, 5, 1, 0)), 0)
    assert.strictEqual(acuteShare({ positions: new Float32Array(0), indices: new Uint32Array(0) }), 0)
  })
})

describe("the clean voxel surface", () => {
  it("tells a closed mesh from one with a hole", () => {
    assert.isFalse(needsCleanSurface(welded(sphere)))
    assert.isTrue(needsCleanSurface(welded(holed)))
  })

  it("is closed, looks outward, and runs halfway between solid and empty cells' centres", () => {
    const surface = cleanSurface(ballGrid())
    assert.isFalse(needsCleanSurface(surface))
    assert.closeTo(new MeshSolid(surface).winding({ x: 0, y: 0, z: 0 }), 1, 1e-9)
    for (const radius of radii(surface)) assert.closeTo(radius, RADIUS, 10)
  })

  it("closes round a solid that fills the grid to its edge", () => {
    const grid: VoxelGrid = { n: [2, 1, 1], origin: { x: 0, y: 0, z: 0 }, voxel: 10, cells: new Uint8Array([1, 1]) }
    const surface = cleanSurface(grid)
    assert.isFalse(needsCleanSurface(surface))
    assert.closeTo(new MeshSolid(surface).winding({ x: 10, y: 5, z: 5 }), 1, 1e-9)
    // Halfway from each cell's centre to the empty space round the grid: the cells' own outer faces, less the corners.
    const { max, min } = { min: Math.min(...surface.positions), max: Math.max(...surface.positions) }
    assert.deepStrictEqual([min, max], [0, 20])
  })
})

describe("a plate source", () => {
  it("starts from a closed model's own mesh, and samples its surface evenly", () => {
    const source = new PlateSource(sphere, ballGrid())
    assert.isFalse(source.repaired)
    assert.deepStrictEqual(trianglesOfMesh(source.mesh), trianglesOfMesh(welded(sphere)))
    assert.lengthOf(source.samples, 4000)
    for (const p of source.samples) assert.closeTo(vecLength(p), RADIUS, 1.5)
    // As many samples on one half as on the other, to the width of a face.
    const above = source.samples.filter((p) => p.z > 0).length
    assert.closeTo(above, 2000, 4000 / 24)
  })

  it("starts from the voxel surface where the model's mesh has a hole, and still follows the model", () => {
    const source = new PlateSource(holed, ballGrid())
    assert.isTrue(source.repaired)
    assert.isFalse(needsCleanSurface(source.mesh))
    assert.closeTo(source.surface.nearest({ x: 0, y: 150, z: 0 }).squared, 50 ** 2, 60)
  })

  it("follows the surface it is given in place of the model", () => {
    const source = new PlateSource(new Float32Array(0), ballGrid(), true, false, sphere)
    assert.isTrue(source.repaired)
    assert.lengthOf(source.samples, 4000)
    for (const p of source.samples) assert.closeTo(vecLength(p), RADIUS, 1.5)
  })

  it("shares its solid, surface and samples with its variants, which stay repaired once they are", () => {
    const source = new PlateSource(sphere, ballGrid())
    const clean = source.variant(true, false), locked = clean.variant(false, true)
    for (const variant of [clean, locked]) {
      assert.strictEqual(variant.solid, source.solid)
      assert.strictEqual(variant.surface, source.surface)
      assert.strictEqual(variant.samples, source.samples)
      assert.isTrue(variant.repaired)
    }
    assert.isFalse(needsCleanSurface(clean.mesh))
    assert.notStrictEqual(clean.mesh, source.mesh)
    assert.strictEqual(locked.mesh, clean.mesh)
    assert.isFalse(clean.lockCoarseCorners)
    assert.isTrue(locked.lockCoarseCorners)
    assert.isFalse(source.variant(false, true).repaired)
  })
})

describe("a remesh", () => {
  it("gives a copy of a mesh already within the budget", async () => {
    await meshReady
    const source = new PlateSource(sphere, ballGrid())
    const result = source.remesh(5000)
    assert.deepStrictEqual(result.mesh, source.mesh)
    assert.notStrictEqual(result.mesh.positions, source.mesh.positions)
    assert.strictEqual(result.acuteAfter, result.acuteBefore)
  })

  it("keeps to the budget, stays closed and on the model, and leaves more faces acute than it found", async () => {
    await meshReady
    const source = new PlateSource(sphere, ballGrid())
    const { acuteAfter, acuteBefore, mesh } = source.remesh(120)
    assert.isAtMost(faceCount(mesh), 120)
    assert.isAtLeast(faceCount(mesh), 100)
    assert.isFalse(needsCleanSurface(mesh))
    assert.closeTo(new MeshSolid(mesh).winding({ x: 0, y: 0, z: 0 }), 1, 1e-9)
    // The fit pulls coarse faces out to the model, which leaves their corners a little outside it.
    for (const radius of radii(mesh)) assert.closeTo(radius, RADIUS, 8)
    assert.strictEqual(acuteAfter, acuteShare(mesh))
    assert.isAbove(acuteAfter, acuteBefore)
    // The source's own mesh is left as it was.
    assert.deepStrictEqual(trianglesOfMesh(source.mesh), trianglesOfMesh(welded(sphere)))
  })

  it("brings a repaired source's blocky voxel surface back onto the model", async () => {
    await meshReady
    const { mesh } = new PlateSource(holed, ballGrid()).remesh(150)
    assert.isFalse(needsCleanSurface(mesh))
    assert.isAtMost(faceCount(mesh), 150)
    // The hole is 40 faces at a pole; everywhere else the model's surface is the sphere.
    for (const radius of radii(mesh)) assert.closeTo(radius, RADIUS, 8)
  })

  it("stays closed and a mirror image of itself with a mirror", async () => {
    await meshReady
    const source = new PlateSource(sphere, ballGrid())
    const plane = { normal: { x: 1, y: 0, z: 0 }, offset: 0 }
    const { mesh } = source.remesh(120, mirrorRemesh(plane, source.samples))
    assert.isAtMost(faceCount(mesh), 120)
    assert.isFalse(needsCleanSurface(mesh))
    const vertices = [...new Set(mesh.indices)].map((i) => meshVertex(mesh, i))
    for (const p of vertices) {
      const image = { ...p, x: -p.x }
      assert.isTrue(vertices.some((q) => vecLength(vecSub(q, image)) < 1e-3))
    }
  })
})
