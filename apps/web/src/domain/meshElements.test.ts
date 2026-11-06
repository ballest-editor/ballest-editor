import { assert, describe, it } from "@effect/vitest"
import { assertVec } from "../test/vec"
import type { Vec3 } from "./coords"
import { meshElementsOf, placedMesh } from "./meshElements"
import { ORIGIN } from "./ueMath"

const quad = (a: Array<number>, b: Array<number>, c: Array<number>, d: Array<number>) => [a, b, c, a, c, d].flat()
const p = (x: number, y: number, z: number) => [x * 100, y * 100, z * 100]

/** A 100 cm cube of 12 triangles, with its corners repeated per face as a real mesh's are. */
const cube = (top = quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1))) =>
  new Float32Array([
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)),
    ...top,
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)),
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)),
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)),
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1))
  ])

/** A round bar of `sides` flat sides, each too small to count as a face, 100 cm across and 100 cm long. */
const bar = (sides: number) => {
  const at = (i: number, z: number) => {
    const angle = i / sides * Math.PI * 2
    return [Math.cos(angle) * 50, Math.sin(angle) * 50, z]
  }
  return new Float32Array(
    Array.from({ length: sides }, (_, i) => [
      [at(i, 0), at(i + 1, 0), at(i + 1, 100), at(i, 0), at(i + 1, 100), at(i, 100)],
      [[0, 0, 0], at(i + 1, 0), at(i, 0)],
      [[0, 0, 100], at(i, 100), at(i + 1, 100)]
    ]).flat(3)
  )
}

describe("meshElementsOf", () => {
  it("welds a mesh's repeated corners, and leaves a flat face's triangulation out of its edges", () => {
    const elements = meshElementsOf(cube(), null, 30)
    assert.lengthOf(elements.vertices, 8)
    assert.lengthOf(elements.edges, 12)
    assert.lengthOf(elements.faceCentres, 6)
  })

  it("leaves a vertex in the middle of a flat face out", () => {
    const rim = [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]
    const fan = rim.flatMap((at, i) => [p(0.5, 0.5, 1), at, rim[(i + 1) % 4] ?? at].flat())
    const elements = meshElementsOf(cube(fan), null, 30)
    assert.lengthOf(elements.vertices, 8)
    assert.lengthOf(elements.edges, 12)
    assert.lengthOf(elements.faceCentres, 6)
  })

  it("puts a face's centre in the middle of the whole face, not of a triangle", () => {
    const { faceCentres } = meshElementsOf(cube(), null, 30)
    assert.isTrue(faceCentres.some((c) => c.x === 50 && c.y === 50 && c.z === 0))
  })

  it("counts an edge only past the sharp angle", () => {
    assert.lengthOf(meshElementsOf(cube(), null, 95).edges, 0)
  })

  it("counts the rim of an open surface, which has one face", () => {
    const sheet = new Float32Array([0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 0, 0, 100, 100, 0, 0, 100, 0])
    assert.lengthOf(meshElementsOf(sheet, null, 30).edges, 4)
  })

  it("reads an index when the mesh has one", () => {
    const sheet = new Float32Array([0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0])
    const elements = meshElementsOf(sheet, new Uint16Array([0, 1, 2, 0, 2, 3]), 30)
    assert.lengthOf(elements.vertices, 4)
    assert.lengthOf(elements.faceCentres, 1)
  })

  it("gives each flat face a unit normal out of it and the rectangle around it", () => {
    const { faces } = meshElementsOf(cube(), null, 30)
    assert.lengthOf(faces, 6)
    assert.isTrue(faces.every(({ normal }) => Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) < 1e-9))
    const top = faces.find(({ centre }) => centre.z === 100)
    assert.deepStrictEqual(top?.normal, { x: 0, y: 0, z: 1 })
    const [xs, ys] = [top?.corners.map(({ x }) => x) ?? [], top?.corners.map(({ y }) => y) ?? []]
    assert.deepStrictEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 100, 0, 100])
  })

  it("leaves the facets of something curved out of its faces, and not out of its face centres", () => {
    const { faceCentres, faces } = meshElementsOf(bar(512), null, 30)
    assert.lengthOf(faceCentres, 514)
    assert.deepStrictEqual(faces.map(({ normal }) => normal.z).toSorted((a, b) => a - b), [-1, 1])
  })

  it("turns a face's normal with a transform, and flips it along a mirrored axis", () => {
    const [face] = meshElementsOf(new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]), null, 30).faces
    if (face === undefined) return assert.fail("a triangle is a face")
    const elements = { vertices: [], edges: [], faceCentres: [], faces: [face] }
    const normalUnder = (place: (p: Vec3) => Vec3) => placedMesh(elements, place).faces[0]?.normal ?? ORIGIN
    assertVec(normalUnder(({ x, y, z }) => ({ x: z, y, z: -x })), { x: 1, y: 0, z: 0 }, "a quarter turn")
    assertVec(normalUnder(({ x, y, z }) => ({ x, y, z: -z })), { x: 0, y: 0, z: -1 }, "mirrored along it")
    assertVec(normalUnder(({ x, y, z }) => ({ x: -x, y, z })), { x: 0, y: 0, z: 1 }, "mirrored across it")
    assertVec(normalUnder(({ x, y, z }) => ({ x: x * 3, y, z })), { x: 0, y: 0, z: 1 }, "stretched")
  })

  it("places every element under a transform", () => {
    const elements = meshElementsOf(new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]), null, 30)
    const placed = placedMesh(elements, (point) => ({ ...point, z: point.z + 7 }))
    assert.isTrue(placed.vertices.every((v) => v.z === 7))
    assert.isTrue(placed.edges.every(([a, b]) => a.z === 7 && b.z === 7))
    assert.isTrue(placed.faces.every(({ centre, corners }) => [centre, ...corners].every(({ z }) => z === 7)))
  })
})
