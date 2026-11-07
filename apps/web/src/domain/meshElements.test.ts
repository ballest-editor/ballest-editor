import { assert, describe, it } from "@effect/vitest"
import { assertVec } from "../test/vec"
import type { Vec3 } from "./coords"
import { meshElementsOf, placedMesh, runMidpoints } from "./meshElements"
import { ORIGIN, vecDistance } from "./ueMath"

const quad = (a: Array<number>, b: Array<number>, c: Array<number>, d: Array<number>) => [a, b, c, a, c, d].flat()
const p = (x: number, y: number, z: number) => [x * 100, y * 100, z * 100]

const fan = (centre: Array<number>, rim: ReadonlyArray<Array<number>>) =>
  rim.flatMap((at, i) => [centre, at, rim[(i + 1) % rim.length] ?? at].flat())

/** A 100 cm cube of 12 triangles, with its corners repeated per face as a real mesh's are. */
const cube = (
  top = quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),
  front = quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1))
) =>
  new Float32Array([
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)),
    ...top,
    ...front,
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

/** A flat strip around the origin, 100 cm wide with its outer lip at 1000 cm, of `segments` bends of `degrees` each. */
const strip = (degrees: number, segments: number) => {
  const at = (radius: number, i: number) => {
    const angle = i * degrees * Math.PI / 180
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0]
  }
  return new Float32Array(
    Array.from({ length: segments }, (_, i) => quad(at(900, i), at(1000, i), at(1000, i + 1), at(900, i + 1))).flat()
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
    const top = fan(p(0.5, 0.5, 1), [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)])
    const elements = meshElementsOf(cube(top), null, 30)
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

  it("welds a straight edge the mesh splits into one run, with no vertex or middle at the splits", () => {
    const [near, far] = [p(1 / 3, 0, 1), p(2 / 3, 0, 1)]
    const elements = meshElementsOf(
      cube(
        fan(p(0.5, 0.5, 1), [p(0, 0, 1), near, far, p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]),
        fan(p(0.5, 0, 0.5), [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), far, near, p(0, 0, 1)])
      ),
      null,
      30
    )
    assert.lengthOf(elements.vertices, 8)
    assert.lengthOf(elements.edges, 14, "every segment stays an edge")
    assert.lengthOf(elements.runs, 12)
    assert.lengthOf(elements.runs.filter((run) => run.length === 4), 1)
    const middles = runMidpoints(elements)
    assert.lengthOf(middles, 12)
    assert.isTrue(middles.some(({ x, y, z }) => Math.abs(x - 50) < 1e-3 && y === 0 && z === 100))
  })

  it("welds a curved lip of gentle bends into one run, with its ends for vertices and one middle", () => {
    const elements = meshElementsOf(strip(2, 30), null, 30)
    assert.lengthOf(elements.vertices, 4, "the two ends of each lip")
    assert.lengthOf(elements.edges, 62)
    assert.lengthOf(elements.runs, 4, "two lips and two ends")
    const lips = elements.runs.filter((run) => run.length === 31)
    assert.lengthOf(lips, 2)
    const middles = runMidpoints(elements)
    assert.lengthOf(middles, 4)
    const arcMiddle = { x: Math.cos(Math.PI / 6) * 1000, y: 500, z: 0 }
    assert.isTrue(middles.some((middle) => vecDistance(middle, arcMiddle) < 1e-3), "the outer lip's middle")
  })

  it("ends a run where it bends by the sharp angle or more", () => {
    const elements = meshElementsOf(strip(90, 2), null, 30)
    assert.lengthOf(elements.vertices, 6)
    assert.lengthOf(elements.runs, 6)
    assert.lengthOf(meshElementsOf(strip(29, 2), null, 30).vertices, 4)
    assert.lengthOf(meshElementsOf(strip(31, 2), null, 30).vertices, 6)
  })

  it("gives a closed rim with no corner one run and no vertex", () => {
    const { edges, runs, vertices } = meshElementsOf(bar(512), null, 30)
    assert.lengthOf(vertices, 0)
    assert.lengthOf(edges, 1024)
    assert.deepStrictEqual(runs.map((run) => run.length), [513, 513])
    assert.isTrue(runs.every((run) => run[0] === run[512]))
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
    const elements = { vertices: [], edges: [], runs: [], faceCentres: [], faces: [face] }
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
    assert.lengthOf(placed.runs, 3)
    assert.isTrue(placed.runs.flat().every(({ z }) => z === 7))
    assert.isTrue(placed.faces.every(({ centre, corners }) => [centre, ...corners].every(({ z }) => z === 7)))
  })
})

describe("runMidpoints", () => {
  it("halves a run by its length, not by its points", () => {
    const run = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }]
    const middles = runMidpoints({ vertices: [], edges: [], runs: [run], faceCentres: [], faces: [] })
    assert.deepStrictEqual(middles, [{ x: 50, y: 0, z: 0 }])
  })

  it("takes each edge of a mesh without runs as a run", () => {
    const edge = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }] as const
    const middles = runMidpoints({ vertices: [], edges: [edge], faceCentres: [], faces: [] })
    assert.deepStrictEqual(middles, [{ x: 50, y: 0, z: 0 }])
  })
})
