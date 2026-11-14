import { assert, describe, it } from "@effect/vitest"
import { boxTriangles } from "../../../test/boxTriangles"
import { patchFacing, plateSurface } from "../../../test/plateSurface"
import { assertVec } from "../../../test/vec"
import { vecDot, vecSub } from "../../ueMath"
import { Depths, edgesOf, facesOf, growPatches, mergedPatches } from "./plateFaces"

/** A slab 1000 by 800 cm and 100 cm thick. */
const slab = plateSurface(boxTriangles([0, 0, 0], [1000, 800, 100]))
const centre = { x: 500, y: 400, z: 50 }

const sorted = (list: ReadonlyArray<number>) => [...list].sort((a, b) => a - b)

describe("facesOf", () => {
  it("gives each face its area, its centroid and a normal that looks out of the solid", () => {
    assert.lengthOf(slab.faces, 12)
    for (const face of slab.faces) {
      assert.isAbove(vecDot(face.normal, vecSub(face.centroid, centre)), 0)
      assert.closeTo(Math.hypot(face.normal.x, face.normal.y, face.normal.z), 1, 1e-9)
    }
    const top = slab.faces.filter((face) => face.normal.z > 0.9)
    assert.deepStrictEqual(top.map((face) => face.area), [400000, 400000])
    assert.closeTo((top[0]?.centroid.z ?? 0) + (top[1]?.centroid.z ?? 0), 200, 1e-9)
  })

  it("looks out of a mesh wound inside out, and out of a single face wound against the rest", () => {
    const indices = slab.mesh.indices
    const turned = (from: number, to: number) => {
      const out = indices.slice()
      for (let f = from; f < to; f++) {
        out[3 * f + 1] = indices[3 * f + 2] ?? 0
        out[3 * f + 2] = indices[3 * f + 1] ?? 0
      }
      return { positions: slab.mesh.positions, indices: out }
    }
    for (const mesh of [turned(0, 12), turned(4, 5)]) {
      const faces = facesOf(mesh, slab.grid)
      faces.forEach((face, f) => assertVec(face.normal, slab.faces[f]?.normal ?? centre, `face ${f}`))
    }
  })

  it("leaves out a face with no area", () => {
    const positions = new Float32Array([0, 0, 0, 100, 0, 0, 200, 0, 0, 0, 100, 0])
    const faces = facesOf({ positions, indices: new Uint32Array([0, 1, 2, 0, 1, 3]) }, slab.grid)
    assert.deepStrictEqual(faces.map((face) => face.corners), [[0, 1, 3]])
  })
})

describe("edgesOf", () => {
  it("lists the two faces on each edge of a closed mesh", () => {
    const edges = edgesOf(slab.faces, slab.vertices)
    assert.strictEqual(edges.size, 18)
    for (const faces of edges.values()) assert.lengthOf(faces, 2)
  })
})

describe("growPatches", () => {
  it("makes one patch of each flat side, with its area, middle and direction", () => {
    assert.lengthOf(slab.patches, 6)
    const top = slab.patches[patchFacing(slab, [0, 0, 1])]
    assert.lengthOf(top?.faces ?? [], 2)
    assert.closeTo(top?.area ?? 0, 800000, 1e-6)
    assertVec(top?.centroid ?? centre, { x: 500, y: 400, z: 100 }, "centroid")
    assertVec(top?.normal ?? centre, { x: 0, y: 0, z: 1 }, "normal")
    slab.patches.forEach((patch, id) => {
      for (const f of patch.faces) assert.strictEqual(slab.patchOf[f], id)
    })
    // Largest faces first: the top and bottom lead.
    assert.deepStrictEqual(slab.patches.map((patch) => patch.area), [800000, 800000, 100000, 100000, 80000, 80000])
  })

  it("takes a face in across an edge only when it looks within the flatness of the patch", () => {
    // A roof: two slopes 30° from level, so 60° apart, over a box.
    const roof = new Float32Array([
      Array.from(boxTriangles([0, 0, 0], [1000, 1000, 100]).slice(0, 18)),
      [0, 0, 0, 0, 1000, 0, 500, 1000, 289, 0, 0, 0, 500, 1000, 289, 500, 0, 289],
      [1000, 0, 0, 500, 0, 289, 500, 1000, 289, 1000, 0, 0, 500, 1000, 289, 1000, 1000, 0],
      [0, 0, 0, 500, 0, 289, 1000, 0, 0, 0, 1000, 0, 1000, 1000, 0, 500, 1000, 289]
    ].flat())
    const patchesAt = (flatness: number) => plateSurface(roof, 16, flatness).patches
    const slopes = (flatness: number) => patchesAt(flatness).filter((patch) => patch.normal.z > 0.5)
    assert.deepStrictEqual(slopes(59).map((patch) => patch.faces.length), [2, 2])
    assert.deepStrictEqual(slopes(61).map((patch) => patch.faces.length), [4])
  })
})

describe("mergedPatches", () => {
  const merged = (minArea: number) => mergedPatches(slab.faces, slab.edges, slab.vertices, 12, minArea)

  it("is the grown patches where none is too small", () => {
    assert.deepStrictEqual(merged(0), growPatches(slab.faces, slab.edges, slab.vertices, 12))
    assert.lengthOf(merged(80000).patches, 6)
  })

  it("merges patches under the least area into a neighbour until they are big enough", () => {
    // The four sides are under 150,000 cm²; every neighbour is square to them, so each joins the first it meets.
    const { patches, patchOf } = merged(150000)
    assert.isBelow(patches.length, 6)
    for (const patch of patches) assert.isAtLeast(patch.area, 150000)
    assert.closeTo(patches.reduce((sum, patch) => sum + patch.area, 0), 1960000, 1e-6)
    assert.deepStrictEqual(sorted(patches.flatMap((patch) => patch.faces)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    patches.forEach((patch, id) => {
      for (const f of patch.faces) assert.strictEqual(patchOf[f], id)
    })
  })

  it("stops at one patch when nothing is big enough", () => {
    const { patches } = merged(Infinity)
    assert.lengthOf(patches, 1)
    assert.lengthOf(patches[0]?.faces ?? [], 12)
  })
})

describe("Depths", () => {
  const top = patchFacing(slab, [0, 0, 1])
  const depths = new Depths(slab.mesh, slab.faces, slab.patchOf)
  const down = { x: 0, y: 0, z: -1 }

  it("finds the nearest face of another patch along a ray", () => {
    assert.closeTo(depths.along({ x: 300, y: 300, z: 100 }, down, top), 100, 1e-9)
    // In lengths of the direction.
    assert.closeTo(depths.along({ x: 300, y: 300, z: 100 }, { x: 0, y: 0, z: -4 }, top), 25, 1e-9)
    assert.closeTo(depths.along({ x: 300, y: 300, z: 60 }, { x: 1, y: 0, z: 0 }, top), 700, 1e-9)
  })

  it("passes the faces of the point's own patch, and finds nothing where the ray leaves the model", () => {
    assert.closeTo(depths.along({ x: 300, y: 300, z: 150 }, down, top), 150, 1e-9)
    assert.closeTo(depths.along({ x: 300, y: 300, z: 150 }, down, patchFacing(slab, [0, 0, -1])), 50, 1e-9)
    assert.strictEqual(depths.along({ x: 300, y: 300, z: 100 }, { x: 0, y: 0, z: 1 }, top), Infinity)
    assert.strictEqual(depths.along({ x: 3000, y: 300, z: 100 }, down, top), Infinity)
  })

  it("lets a plate be 90% of the model behind it thick, the most asked for at most, and half a cm at least", () => {
    const points = [{ x: 300, y: 300, z: 100 }, { x: 600, y: 500, z: 100 }]
    const up = { x: 0, y: 0, z: 1 }
    assert.closeTo(depths.thickness(points, up, top, 500), 90, 1e-3)
    assert.strictEqual(depths.thickness(points, up, top, 40), 40)
    assert.strictEqual(depths.thickness([{ x: 300, y: 300, z: 0.2 }], up, top, 40), 0.5)
    // Nothing behind a point is no limit.
    assert.strictEqual(depths.thickness([{ x: 3000, y: 300, z: 100 }], up, top, 40), 40)
  })
})
