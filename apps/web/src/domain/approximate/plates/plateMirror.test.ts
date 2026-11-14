import { assert, describe, it } from "@effect/vitest"
import { sphereTriangles } from "../../../test/triangles"
import type { Vec3 } from "../../coords"
import { vecLength, vecSub } from "../../ueMath"
import { trianglesOfPlacement } from "../look/views"
import { faceCount, type Mesh, meshReady, welded } from "../mesh/mesh"
import { meshVertex } from "../mesh/plateMesh"
import type { Plane } from "../parts/symmetry"
import { IDENTITY_QUAT } from "../shapes"
import {
  byPartners,
  halfOf,
  isMirrored,
  mirrorHalf,
  mirrorPoint,
  mirrorRemesh,
  ontoPlane,
  partnersOf,
  signedDistance
} from "./plateMirror"

/** The plane x = 0. */
const plane: Plane = { normal: { x: 1, y: 0, z: 0 }, offset: 0 }

/** A box 120 cm square in y and z, from `from` to `to` along x: its mean edge is over 100 cm. */
const boxAlongX = (from: number, to: number): Mesh =>
  welded(trianglesOfPlacement({
    kind: "box",
    center: { x: (from + to) / 2, y: 0, z: 0 },
    half: { x: (to - from) / 2, y: 60, z: 60 },
    rotation: IDENTITY_QUAT
  }))

const usedVertices = (mesh: Mesh): Array<Vec3> => [...new Set(mesh.indices)].map((i) => meshVertex(mesh, i))

const alongX = (mesh: Mesh) => {
  const xs = usedVertices(mesh).map((p) => p.x)
  return { min: Math.min(...xs), max: Math.max(...xs) }
}

/** The largest distance from a used vertex's mirror image to its partner; Infinity when one has none. */
const mirrorGap = (mesh: Mesh, partners: Int32Array): number => {
  let gap = 0
  for (const i of new Set(mesh.indices)) {
    const j = partners[i] ?? -1
    if (j < 0) return Infinity
    gap = Math.max(gap, vecLength(vecSub(mirrorPoint(meshVertex(mesh, i), plane), meshVertex(mesh, j))))
  }
  return gap
}

/** Every edge of the mesh has a face on each side, running it opposite ways. */
const isClosed = (mesh: Mesh): boolean => {
  const directed = new Set<string>()
  for (let f = 0; f < faceCount(mesh); f++) {
    for (let k = 0; k < 3; k++) directed.add(`${mesh.indices[3 * f + k]},${mesh.indices[3 * f + (k + 1) % 3]}`)
  }
  return directed.size === mesh.indices.length &&
    [...directed].every((edge) => directed.has(edge.split(",").toReversed().join()))
}

describe("points and a mirror plane", () => {
  const tilted: Plane = { normal: { x: 0.6, y: 0.8, z: 0 }, offset: 50 }
  const p = { x: 100, y: 100, z: 7 }

  it("measures, projects and reflects", () => {
    assert.closeTo(signedDistance(tilted, p), 90, 1e-9)
    assert.closeTo(signedDistance(tilted, ontoPlane(tilted, p)), 0, 1e-9)
    assert.closeTo(signedDistance(tilted, mirrorPoint(p, tilted)), -90, 1e-9)
    assert.closeTo(vecLength(vecSub(mirrorPoint(mirrorPoint(p, tilted), tilted), p)), 0, 1e-9)
    assert.strictEqual(mirrorPoint(p, tilted).z, 7)
  })
})

describe("cutting a mesh at its mirror plane", () => {
  it("cuts the faces that cross the plane and keeps one side, its border on the plane", () => {
    const box = boxAlongX(-100, 300)
    const kept = halfOf(box, plane, 1), other = halfOf(box, plane, -1)
    assert.deepStrictEqual(alongX(kept), { min: 0, max: 300 })
    assert.deepStrictEqual(alongX(other), { min: -100, max: 0 })
    // The cut is open at the plane: it gains the crossing vertices and loses the far end's two faces.
    assert.isAbove(kept.positions.length, box.positions.length)
    assert.isFalse(isClosed(kept))
  })

  it("moves a vertex just past the plane onto it instead of cutting", () => {
    // The discarded end is 20 cm past the plane, under 0.3 of the mean edge: its four corners snap.
    const half = halfOf(boxAlongX(-20, 300), plane, 1)
    assert.strictEqual(half.positions.length / 3, 8)
    assert.strictEqual(faceCount(half), 10)
    assert.deepStrictEqual(alongX(half), { min: 0, max: 300 })
  })

  it("keeps a thin feature across the plane: only the discarded side snaps that far", () => {
    // A fin 20 cm thick: its sides are 0.1 of the mean edge from the plane, over the kept side's 0.08.
    const fin = mirrorHalf(halfOf(boxAlongX(-10, 10), plane, 1), plane)
    assert.isTrue(isMirrored(fin.mesh, fin.partners))
    assert.deepStrictEqual(alongX(fin.mesh), { min: -10, max: 10 })
  })
})

describe("joining a half to its mirror image", () => {
  const whole = () => mirrorHalf(halfOf(boxAlongX(-100, 300), plane, 1), plane)

  it("makes a closed, symmetric mesh whose vertices are paired", () => {
    const { mesh, partners } = whole()
    assert.isTrue(isClosed(mesh))
    assert.isTrue(isMirrored(mesh, partners))
    assert.deepStrictEqual(alongX(mesh), { min: -300, max: 300 })
    assert.strictEqual(mirrorGap(mesh, partners), 0)
    partners.forEach((j, i) => {
      assert.strictEqual(partners[j], i)
      assert.strictEqual(j === i, meshVertex(mesh, i).x === 0)
    })
  })

  it("finds the same pairs from the mesh alone", () => {
    const { mesh, partners } = whole()
    assert.deepStrictEqual(partnersOf(mesh, plane), partners)
  })

  it("finds no pairs, and no symmetry, in a mesh that has none", () => {
    const lopsided = boxAlongX(-100, 300)
    const partners = partnersOf(lopsided, plane)
    assert.isTrue(partners.every((j) => j === -1))
    assert.isFalse(isMirrored(lopsided, partners))
  })

  it("is not mirrored once a face loses its image", () => {
    const { mesh, partners } = whole()
    assert.isFalse(isMirrored({ positions: mesh.positions, indices: mesh.indices.slice(3) }, partners))
  })
})

describe("keeping a mesh symmetric by its pairs", () => {
  it("moves each pair to mirror images of their mean and a vertex on the plane onto it", () => {
    const { mesh, partners } = mirrorHalf(halfOf(boxAlongX(-100, 300), plane, 1), plane)
    const off = partners.findIndex((j, i) => j !== i), on = partners.findIndex((j, i) => j === i)
    const moved = mesh.positions.slice()
    moved.set([moved[3 * off]! + 30, moved[3 * off + 1]! + 12], 3 * off)
    moved.set([8], 3 * on)
    const before = meshVertex(mesh, off)
    const fixed = byPartners({ positions: moved, indices: mesh.indices }, plane, partners)
    assert.strictEqual(mirrorGap(fixed, partners), 0)
    assert.strictEqual(meshVertex(fixed, on).x, 0)
    // The pair shares the move: half of it each, mirrored.
    assert.deepStrictEqual(meshVertex(fixed, off), { x: before.x + 15, y: before.y + 6, z: before.z })
    assert.strictEqual(fixed.indices, mesh.indices)
  })
})

describe("the symmetric decimation a remesh starts from", () => {
  /** A ball of radius 500, swollen on the side of positive x when `swollen`. */
  const ball = (swollen: boolean) =>
    welded(sphereTriangles(16, 24, (i, j) => {
      const theta = Math.PI * i / 16, phi = 2 * Math.PI * j / 24
      const x = 500 * Math.sin(theta) * Math.cos(phi)
      return [swollen && x > 0 ? 1.5 * x : x, 500 * Math.sin(theta) * Math.sin(phi), 500 * Math.cos(theta)]
    }))

  it("decimates to a symmetric mesh of about the faces asked for", async () => {
    await meshReady
    const fine = ball(false)
    const { mesh, partners } = mirrorRemesh(plane, usedVertices(fine)).decimate(fine, 80)
    assert.isTrue(isMirrored(mesh, partners))
    assert.strictEqual(mirrorGap(mesh, partners), 0)
    assert.isAtLeast(faceCount(mesh), 40)
    assert.isAtMost(faceCount(mesh), 90)
  })

  it("mirrors the side whose mesh stays nearer the samples", async () => {
    await meshReady
    const fine = ball(true)
    const near = (wide: boolean) => usedVertices(fine).filter((p) => (p.x > 0) === wide)
    const reach = (samples: ReadonlyArray<Vec3>) => alongX(mirrorRemesh(plane, samples).decimate(fine, 80).mesh).max
    assert.closeTo(reach(near(true)), 750, 40)
    assert.closeTo(reach(near(false)), 500, 40)
  })
})
