import { afterEach, assert, describe, it } from "@effect/vitest"
import { sphereTriangles } from "../../../test/triangles"
import type { Vec3 } from "../../coords"
import { vecAdd, vecScale } from "../../ueMath"
import { setClock } from "../clock"
import { gridOver, trianglesBox, voxelize } from "../grid/voxelize"
import { trianglesOfPlacement } from "../look/views"
import { faceCount, type Mesh, meshReady, welded } from "../mesh/mesh"
import { meshVertex } from "../mesh/plateMesh"
import { PlateSource } from "../mesh/remesh"
import { Surface } from "../mesh/surface"
import type { Plane } from "../parts/symmetry"
import { IDENTITY_QUAT } from "../shapes"
import { isMirrored, mirrorRemesh, partnersOf } from "./plateMirror"
import { collapseMeshEdge, meshEdges, searchPlateMesh, splitMeshEdge } from "./plateSearch"

const cube = (): Mesh =>
  welded(trianglesOfPlacement({
    kind: "box",
    center: { x: 0, y: 0, z: 0 },
    half: { x: 500, y: 500, z: 500 },
    rotation: IDENTITY_QUAT
  }))

/** Two apexes over a triangle 1, 2, 3: each side of the triangle has both apexes and the third corner beside it. */
const bipyramid = (): Mesh => ({
  positions: new Float32Array([0, 0, 100, 100, 0, 0, -50, 87, 0, -50, -87, 0, 0, 0, -100]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 4, 2, 1, 4, 3, 2, 4, 1, 3])
})

const middleOf = (mesh: Mesh, a: number, b: number): Vec3 =>
  vecScale(vecAdd(meshVertex(mesh, a), meshVertex(mesh, b)), 0.5)

/** A closed mesh has three edges to every two faces, each with a face on both sides. */
const isClosed = (mesh: Mesh): boolean => 2 * meshEdges(mesh).length === 3 * faceCount(mesh)

/** A ball of radius 1000 about x = 250, y and z = 0, stretched along z: x = 250 is one of its mirror planes. */
const ballSource = (): PlateSource => {
  const triangles = sphereTriangles(12, 16, (i, j) => {
    const theta = Math.PI * i / 12, phi = 2 * Math.PI * j / 16
    return [
      250 + 1000 * Math.sin(theta) * Math.cos(phi),
      1000 * Math.sin(theta) * Math.sin(phi),
      1600 * Math.cos(theta)
    ]
  })
  return new PlateSource(triangles, voxelize(triangles, gridOver(trianglesBox(triangles), 16), { surface: true }))
}
const plane: Plane = { normal: { x: 1, y: 0, z: 0 }, offset: 250 }

/** Scores a mesh by how near the source's samples lie to it, refusing one of more than `most` faces. */
const nearness = (source: PlateSource, most: number) => {
  const samples = source.samples.filter((_, i) => i % 8 === 0)
  return (mesh: Mesh) => {
    if (faceCount(mesh) > most) return undefined
    const surface = new Surface(mesh)
    return { result: mesh, score: -samples.reduce((sum, p) => sum + surface.nearest(p).squared, 0) / samples.length }
  }
}

/** A clock a millisecond later each time it is read, so a search is bounded by its own work. */
const tickingClock = () => {
  let ticks = 0
  setClock(() => ticks++)
}

afterEach(() => setClock(() => performance.now()))

describe("the edges of a mesh", () => {
  it("lists each edge between two faces once, with the faces and their third corners", () => {
    const mesh = cube(), edges = meshEdges(mesh)
    assert.strictEqual(edges.length, 18)
    for (const edge of edges) {
      assert.strictEqual(edge.faces.length, 2)
      edge.faces.forEach((f, k) => {
        const corners = [...mesh.indices.subarray(3 * f, 3 * f + 3)].toSorted((a, b) => a - b)
        assert.deepStrictEqual(corners, [edge.a, edge.b, edge.opposite[k] ?? -1].toSorted((a, b) => a - b))
      })
    }
  })

  it("leaves out an edge with a face on one side only", () => {
    const open = { positions: cube().positions, indices: cube().indices.slice(3) }
    assert.strictEqual(meshEdges(open).length, 15)
  })
})

describe("local edits to a mesh", () => {
  it("splits an edge into a closed mesh with a vertex and two faces more", () => {
    const mesh = cube(), edge = meshEdges(mesh)[0]
    assert.isDefined(edge)
    const split = splitMeshEdge(mesh, edge, middleOf(mesh, edge.a, edge.b))
    assert.isDefined(split)
    assert.strictEqual(split.positions.length / 3, 9)
    assert.strictEqual(faceCount(split), 14)
    assert.isTrue(isClosed(split))
    assert.strictEqual(faceCount(mesh), 12, "the mesh given is left alone")
  })

  it("refuses a split whose point turns a face over", () => {
    const mesh = cube(), edge = meshEdges(mesh)[0]
    assert.isDefined(edge)
    const a = meshVertex(mesh, edge.a), b = meshVertex(mesh, edge.b)
    // Past the edge's end: the half between the new vertex and that end runs backwards.
    assert.isUndefined(splitMeshEdge(mesh, edge, vecAdd(b, vecScale(vecAdd(b, vecScale(a, -1)), 0.5))))
  })

  it("collapses an edge into a closed mesh with two faces fewer", () => {
    const mesh = cube(), edge = meshEdges(mesh)[0]
    assert.isDefined(edge)
    const middle = middleOf(mesh, edge.a, edge.b)
    const split = splitMeshEdge(mesh, edge, middle)
    assert.isDefined(split)
    const added = meshEdges(split).find((e) => e.a === 8 || e.b === 8)
    assert.isDefined(added)
    const collapsed = collapseMeshEdge(split, added, middle)
    assert.isDefined(collapsed)
    assert.strictEqual(faceCount(collapsed), 12)
    assert.isTrue(isClosed(collapsed))
    assert.notInclude([...collapsed.indices], added.b)
    assert.deepStrictEqual(meshVertex(collapsed, added.a), middle)
  })

  it("refuses a collapse whose ends share more than two neighbours", () => {
    const mesh = bipyramid()
    const side = meshEdges(mesh).find((e) => e.a !== 0 && e.a !== 4 && e.b !== 0 && e.b !== 4)
    const spoke = meshEdges(mesh).find((e) => e.a === 0 || e.b === 0)
    assert.isDefined(side)
    assert.isDefined(spoke)
    assert.isUndefined(collapseMeshEdge(mesh, side, middleOf(mesh, side.a, side.b)))
    assert.isDefined(collapseMeshEdge(mesh, spoke, middleOf(mesh, spoke.a, spoke.b)))
  })

  it("refuses a collapse that folds a face over", () => {
    const mesh = cube(), edge = meshEdges(mesh)[0]
    assert.isDefined(edge)
    // The kept end pushed through the cube to its far side.
    const through = vecScale(middleOf(mesh, edge.a, edge.b), -3)
    assert.isUndefined(collapseMeshEdge(mesh, edge, through))
  })
})

describe("the plate mesh search", () => {
  it("gives nothing when the mesh it starts from can't be used", () => {
    assert.isUndefined(searchPlateMesh(cube(), ballSource(), 1, () => undefined))
  })

  it("gives the mesh it started from when it has no time", () => {
    tickingClock()
    const mesh = cube(), source = ballSource()
    const found = searchPlateMesh(mesh, source, 0, nearness(source, 100))
    assert.strictEqual(found?.result, mesh)
    assert.strictEqual(found?.stats.tried, 0)
    assert.strictEqual(found?.stats.after, found?.stats.before)
  })

  it("keeps only edits that score better, within what the caller allows", async () => {
    await meshReady
    tickingClock()
    const source = ballSource(), { mesh } = source.remesh(40)
    const most = faceCount(mesh) + 4
    const found = searchPlateMesh(mesh, source, 3, nearness(source, most))
    assert.isDefined(found)
    const { accepted, after, before, moved, tried } = found.stats
    assert.isAbove(after, before)
    assert.strictEqual(nearness(source, most)(found.result)?.score, after)
    assert.isAtMost(faceCount(found.result), most)
    assert.isTrue(isClosed(found.result))
    assert.isAbove(moved.length, 0)
    assert.isAtLeast(tried, moved.length)
    assert.strictEqual(Object.values(accepted).reduce((sum, n) => sum + n, 0), moved.length)
  })

  it("makes the same edits whenever the clock reads the same", async () => {
    await meshReady
    const source = ballSource(), { mesh } = source.remesh(40)
    const run = () => {
      tickingClock()
      return searchPlateMesh(mesh, source, 2, nearness(source, 60))
    }
    const first = run()
    assert.deepStrictEqual(run(), first)
    // The clock is read once to start and once to end, and a tick is a millisecond.
    assert.isAtLeast(first?.stats.seconds ?? 0, 2)
    assert.isBelow(first?.stats.seconds ?? 0, 2.2)
  })

  it("keeps a symmetric mesh symmetric, edit by edit", async () => {
    await meshReady
    tickingClock()
    const source = ballSource()
    const { mesh } = source.remesh(40, mirrorRemesh(plane, source.samples))
    const score = nearness(source, 60)
    let tried = 0
    const found = searchPlateMesh(mesh, source, 3, (candidate) => {
      tried++
      assert.isTrue(isMirrored(candidate, partnersOf(candidate, plane)))
      return score(candidate)
    }, plane)
    assert.isAbove(tried, 1)
    assert.isAbove(found?.stats.after ?? -Infinity, found?.stats.before ?? Infinity)
  })

  it("searches free when the mesh isn't symmetric in the plane it is given", async () => {
    await meshReady
    const source = ballSource(), { mesh } = source.remesh(40)
    const elsewhere: Plane = { normal: { x: 0.6, y: 0, z: 0.8 }, offset: 90 }
    const run = (mirror?: Plane) => {
      tickingClock()
      return searchPlateMesh(mesh, source, 1, nearness(source, 60), mirror)
    }
    assert.deepStrictEqual(run(elsewhere), run())
  })
})
