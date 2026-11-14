import { assert, describe, it } from "@effect/vitest"
import type { Vec3 } from "../../coords"
import { vecAdd, vecLength, vecScale, vecSub } from "../../ueMath"
import type { Mesh } from "./mesh"
import { MeshSolid } from "./meshSolid"
import { meshFace, meshVertex } from "./plateMesh"
import { Surface } from "./surface"

/** A cube about the origin with half side `half`, wound to look outward, or inward with `inward`. */
const cube = (half: number, inward = false): Mesh => {
  const positions = new Float32Array(24)
  for (let i = 0; i < 8; i++) positions.set([i & 1 ? half : -half, i & 2 ? half : -half, i & 4 ? half : -half], 3 * i)
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
  const faces = quads.flatMap(([a = 0, b = 0, c = 0, d = 0]) => inward ? [a, c, b, a, d, c] : [a, b, c, a, c, d])
  return { positions, indices: new Uint32Array(faces) }
}

/** A fine cube: each face of the 100 cm cube as a 6 × 6 lattice, so the tree has several levels. */
const fineCube = (): Mesh => {
  const positions: Array<number> = [], indices: Array<number> = []
  const frames: ReadonlyArray<readonly [Vec3, Vec3, Vec3]> = [
    [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
    [{ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }],
    [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }],
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }],
    [{ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]
  ]
  for (const [normal, s, t] of frames) {
    const first = positions.length / 3
    for (let j = 0; j <= 6; j++) {
      for (let i = 0; i <= 6; i++) {
        const p = vecAdd(vecScale(normal, 100), vecAdd(vecScale(s, 100 * (i / 3 - 1)), vecScale(t, 100 * (j / 3 - 1))))
        positions.push(p.x, p.y, p.z)
      }
    }
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++) {
        const a = first + 7 * j + i
        indices.push(a, a + 1, a + 8, a, a + 8, a + 7)
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

describe("the nearest point of a surface", () => {
  const mesh = fineCube()
  const surface = new Surface(mesh)

  it.each([
    ["a face", { x: 20, y: -30, z: 170 }, { x: 20, y: -30, z: 100 }],
    ["an edge", { x: 180, y: 160, z: 10 }, { x: 100, y: 100, z: 10 }],
    ["a corner", { x: -180, y: -160, z: -170 }, { x: -100, y: -100, z: -100 }],
    ["a face from inside", { x: 10, y: 20, z: -90 }, { x: 10, y: 20, z: -100 }]
  ])("is on %s", (_, p, expected) => {
    const hit = surface.nearest(p)
    assert.closeTo(vecLength(vecSub(hit.point, expected)), 0, 1e-9)
    assert.closeTo(hit.squared, vecLength(vecSub(p, expected)) ** 2, 1e-6)
  })

  it("names the face the point is on and the point's weights over its corners", () => {
    const hit = surface.nearest({ x: 41, y: 13, z: 250 })
    const [a, b, c] = meshFace(mesh, hit.face).map((i) => meshVertex(mesh, i))
    if (a === undefined || b === undefined || c === undefined) return assert.fail("no face")
    const [wa, wb, wc] = hit.weights
    assert.closeTo(wa + wb + wc, 1, 1e-12)
    for (const w of hit.weights) assert.isAtLeast(w, 0)
    const mixed = vecAdd(vecAdd(vecScale(a, wa), vecScale(b, wb)), vecScale(c, wc))
    assert.deepStrictEqual(mixed, hit.point)
  })

  it("agrees with the distance to the cube wherever the point is", () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let k = 0; k < 500; k++) {
      const p = { x: 600 * random() - 300, y: 600 * random() - 300, z: 600 * random() - 300 }
      const outside = Math.hypot(...[p.x, p.y, p.z].map((v) => Math.max(0, Math.abs(v) - 100)))
      const inside = 100 - Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
      assert.closeTo(Math.sqrt(surface.nearest(p).squared), outside > 0 ? outside : inside, 1e-6)
    }
  })

  it("is nowhere on a mesh with no faces", () => {
    const empty = new Surface({ positions: new Float32Array(0), indices: new Uint32Array(0) })
    assert.strictEqual(empty.nearest({ x: 1, y: 2, z: 3 }).squared, Infinity)
    assert.strictEqual(empty.along({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 }, 0), Infinity)
  })
})

describe("a ray along a surface", () => {
  const surface = new Surface(fineCube())
  const down = { x: 0, y: 0, z: -1 }

  it("stops at the first face it meets", () => {
    assert.closeTo(surface.along({ x: 15, y: 25, z: 400 }, down, 0), 300, 1e-9)
    assert.closeTo(surface.along({ x: 15, y: 25, z: 99 }, down, 0), 199, 1e-9)
  })

  it("passes what is nearer than the minimum", () => {
    assert.closeTo(surface.along({ x: 15, y: 25, z: 400 }, down, 300.5), 500, 1e-9)
    assert.strictEqual(surface.along({ x: 15, y: 25, z: 400 }, down, 500.5), Infinity)
  })

  it("goes on for ever where it misses or points away", () => {
    assert.strictEqual(surface.along({ x: 150, y: 25, z: 400 }, down, 0), Infinity)
    assert.strictEqual(surface.along({ x: 15, y: 25, z: 400 }, { x: 0, y: 0, z: 1 }, 0), Infinity)
  })

  it("measures along a slanted direction in that direction's own lengths", () => {
    // From (-300, 0, 0) along (2, 1, 0) the ray meets the face x = -100 at t = 100.
    assert.closeTo(surface.along({ x: -300, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }, 0), 100, 1e-9)
  })
})

describe("the solid a closed mesh bounds", () => {
  it("winds once about a point inside, by the way its faces look, and not at all about one outside", () => {
    const inside = { x: 10, y: -40, z: 90 }, outside = { x: 150, y: 0, z: 0 }
    assert.closeTo(new MeshSolid(cube(100)).winding(inside), 1, 1e-9)
    assert.closeTo(new MeshSolid(cube(100, true)).winding(inside), -1, 1e-9)
    assert.closeTo(new MeshSolid(cube(100)).winding(outside), 0, 1e-9)
  })

  it("is no distance from a point inside, wound either way, and the distance to its surface from one outside", () => {
    for (const solid of [new MeshSolid(cube(100)), new MeshSolid(cube(100, true))]) {
      assert.strictEqual(solid.outside({ x: 99, y: 99, z: -99 }), 0)
      assert.closeTo(solid.outside({ x: 130, y: 0, z: 0 }), 30, 1e-9)
      assert.closeTo(solid.outside({ x: 130, y: 140, z: 0 }), 50, 1e-9)
    }
  })
})
