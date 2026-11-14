import { assert, describe, it } from "@effect/vitest"
import { sphereTriangles } from "../../../test/triangles"
import { vecLength } from "../../ueMath"
import { cornerData, faceCount, meshReady, simplified, trianglesOfMesh, welded } from "./mesh"
import { meshFace, meshNormal, meshVertex } from "./plateMesh"

/** A unit square in the plane z = 0 as two triangles that share the diagonal from (0, 0) to (1, 1). */
const square = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0])

/** A sphere of radius 100 about the origin, 16 rings of 24 segments. */
const sphere = sphereTriangles(16, 24, (i, j) => {
  const polar = Math.PI * i / 16, turn = 2 * Math.PI * (j % 24) / 24
  return [100 * Math.sin(polar) * Math.cos(turn), 100 * Math.sin(polar) * Math.sin(turn), 100 * Math.cos(polar)]
})

describe("welded", () => {
  it("makes one vertex of corners that coincide, in the order they first appear", () => {
    const mesh = welded(square)
    assert.deepStrictEqual([...mesh.positions], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    assert.deepStrictEqual([...mesh.indices], [0, 1, 2, 0, 2, 3])
    assert.strictEqual(faceCount(mesh), 2)
  })

  it("welds corners a millionth of the model's size apart, and not ones a thousandth apart", () => {
    const near = square.slice()
    near[9] = 1e-6
    assert.strictEqual(welded(near).positions.length / 3, 4)
    const far = square.slice()
    far[9] = 1e-3
    assert.strictEqual(welded(far).positions.length / 3, 5)
  })

  it("drops a face whose corners weld to fewer than three vertices", () => {
    const sliver = new Float32Array([...square, 0, 0, 0, 1, 0, 0, 1, 0, 0])
    assert.strictEqual(faceCount(welded(sliver)), 2)
  })

  it("gives the same triangles back", () => {
    assert.deepStrictEqual(trianglesOfMesh(welded(square)), square)
  })
})

describe("mesh reads", () => {
  const mesh = welded(square)

  it("lists the corners of the faces asked for, nine numbers each", () => {
    assert.deepStrictEqual([...cornerData(mesh, [meshFace(mesh, 1), [3, 3, 1]])], [
      0,
      0,
      0,
      1,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      1,
      0,
      0
    ])
  })

  it("reads a vertex, a face, and a normal twice the face's area long that follows its winding", () => {
    assert.deepStrictEqual(meshVertex(mesh, 2), { x: 1, y: 1, z: 0 })
    assert.deepStrictEqual(meshFace(mesh, 1), [0, 2, 3])
    assert.deepStrictEqual(meshNormal(mesh, [0, 1, 2]), { x: 0, y: 0, z: 1 })
    assert.deepStrictEqual(meshNormal(mesh, [0, 2, 1]), { x: 0, y: 0, z: -1 })
  })
})

describe("simplified", () => {
  it("returns a mesh already within the budget as it is", async () => {
    await meshReady
    const mesh = welded(sphere)
    assert.strictEqual(simplified(mesh, faceCount(mesh)), mesh)
  })

  it("cuts a closed mesh down to about the budget, on its own vertices, and keeps it on the surface", async () => {
    await meshReady
    const mesh = welded(sphere)
    const coarse = simplified(mesh, 100)
    assert.strictEqual(coarse.positions, mesh.positions)
    assert.isAtMost(faceCount(coarse), 100)
    assert.isAtLeast(faceCount(coarse), 80)
    for (const i of coarse.indices) assert.closeTo(vecLength(meshVertex(coarse, i)), 100, 1e-3)
  })

  it("falls back to the sloppy simplifier where the topology stops the first one", async () => {
    await meshReady
    // Triangles that share no vertex: every edge is a border, which the first simplifier keeps.
    const loose = new Float32Array(sphere.length)
    for (let t = 0; t < sphere.length; t += 9) {
      for (let k = 0; k < 9; k++) loose[t + k] = (sphere[t + k] ?? 0) + (k % 3 === 0 ? t : 0)
    }
    const mesh = welded(loose)
    assert.strictEqual(faceCount(mesh), sphere.length / 9)
    assert.isAtMost(faceCount(simplified(mesh, 100)), 150)
  })
})
