import { assert, describe, it } from "@effect/vitest"
import { meshElementsOf, placedMesh } from "./meshElements"

/** A 100 cm cube of 12 triangles, with its corners repeated per face as a real mesh's are. */
const cube = () => {
  const quad = (a: Array<number>, b: Array<number>, c: Array<number>, d: Array<number>) => [a, b, c, a, c, d].flat()
  const p = (x: number, y: number, z: number) => [x * 100, y * 100, z * 100]
  return new Float32Array([
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)),
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)),
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)),
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)),
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1))
  ])
}

describe("meshElementsOf", () => {
  it("welds a mesh's repeated corners, and leaves a flat face's triangulation out of its edges", () => {
    const elements = meshElementsOf(cube(), null, 30)
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

  it("places every element under a transform", () => {
    const elements = meshElementsOf(new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]), null, 30)
    const placed = placedMesh(elements, (p) => ({ ...p, z: p.z + 7 }))
    assert.isTrue(placed.vertices.every((v) => v.z === 7))
    assert.isTrue(placed.edges.every(([a, b]) => a.z === 7 && b.z === 7))
  })
})
