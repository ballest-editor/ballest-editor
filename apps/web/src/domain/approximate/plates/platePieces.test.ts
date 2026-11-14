import { assert, describe, it } from "@effect/vitest"
import { boxTriangles } from "../../../test/boxTriangles"
import { upright } from "../../../test/placement"
import { patchFacing, plateSurface } from "../../../test/plateSurface"
import { assertVec } from "../../../test/vec"
import type { Vec3 } from "../../coords"
import { quatFromAxisAngle, vecCross, vecDot, vecLength, vecSub } from "../../ueMath"
import type { Placement } from "../shapes"
import { PatchPlane } from "./patchPlane"
import { pieceWorld, plateOverlap, rectanglePlate, shifted, trianglePieces, tucked } from "./platePieces"

type Triangle = readonly [Vec3, Vec3, Vec3]

/** A point of the x, y plane, tilted and moved, so the pieces' own frames are checked too. */
const tilted = (x: number, y: number): Vec3 => ({ x: x + 17, y: y * 0.6 - 31, z: y * 0.8 + 43 })

/** Whether `p`, in the triangle's plane, is in it or within `slack` of its edges. */
const holds = ([a, b, c]: Triangle, p: Vec3, slack = 1e-6): boolean => {
  const n = vecCross(vecSub(b, a), vecSub(c, a))
  const edges = [[a, b], [b, c], [c, a]] as const
  return edges.every(([q, r]) => vecDot(vecCross(vecSub(r, q), vecSub(p, q)), n) >= -slack * vecDot(n, n))
}

/** A lens's middle slice: its apex and the two ends of its base. */
const sliceOf = (lens: Placement): Triangle => {
  const world = pieceWorld(lens)
  return [world(0, 0, 1), world(0, -1, -1), world(0, 1, -1)]
}

describe("trianglePieces", () => {
  const shapes = { acute: [350, 900], right: [0, 700], wide: [300, 200] } as const

  for (const [name, [x, y]] of Object.entries(shapes)) {
    it(`covers a ${name} triangle with two isosceles lenses that stay inside it`, () => {
      const triangle: Triangle = [tilted(0, 0), tilted(1000, 0), tilted(x, y)]
      const lenses = trianglePieces(...triangle, 10)
      assert.lengthOf(lenses, 2)
      const slices = lenses.map(sliceOf)
      for (const lens of lenses) assert.strictEqual(lens.kind, "pyramid")
      for (const slice of slices) {
        assert.closeTo(vecLength(vecSub(slice[0], slice[1])), vecLength(vecSub(slice[0], slice[2])), 1e-6)
        for (const corner of slice) assert.isTrue(holds(triangle, corner))
      }
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20 - i; j++) {
          const p = tilted(1000 * i / 20 + x * j / 20, y * j / 20)
          assert.isTrue(slices.some((slice) => holds(slice, p)), `${i}, ${j}`)
        }
      }
    })
  }

  it("uses one lens for a triangle that is isosceles to within 3% of its shortest side", () => {
    const exact = trianglePieces(tilted(0, 1000), tilted(-100, 0), tilted(100, 0), 10)
    assert.lengthOf(exact, 1)
    const slice = sliceOf(exact[0] ?? upright("pyramid", [0, 0, 0], [1, 1, 1]))
    assertVec(slice[0], tilted(0, 1000), "apex", 1e-6)
    // The long sides differ by 0.1 cm, the shortest side being 200: the apex moves onto the base's bisector.
    const near = trianglePieces(tilted(0.5, 1000), tilted(-100, 0), tilted(100, 0), 10)
    assert.lengthOf(near, 1)
    assertVec(sliceOf(near[0] ?? upright("pyramid", [0, 0, 0], [1, 1, 1]))[0], tilted(0, 1000), "apex", 1e-6)
    // They differ by 20 cm.
    assert.lengthOf(trianglePieces(tilted(100, 1000), tilted(-100, 0), tilted(100, 0), 10), 2)
  })

  it("gives nothing for a triangle with no area or a side under half a cm", () => {
    assert.deepStrictEqual(trianglePieces(tilted(0, 0), tilted(100, 0), tilted(200, 0), 10), [])
    assert.deepStrictEqual(trianglePieces(tilted(0, 0), tilted(0.4, 0), tilted(0, 300), 10), [])
  })

  it("keeps a lens as thin as asked, and thinner where it is small", () => {
    const thicknessOf = (size: number, thickness: number) =>
      trianglePieces(tilted(0, size), tilted(-size / 2, 0), tilted(size / 2, 0), thickness)[0]?.half.x
    // Half the thickness, 0.2% of the lesser of the half width and the height, and a quarter cm at least.
    assert.strictEqual(thicknessOf(1000, 0.8), 0.4)
    assert.closeTo(thicknessOf(1000, 10) ?? 0, 1, 1e-9)
    assert.strictEqual(thicknessOf(100, 10), 0.25)
  })
})

describe("tucked", () => {
  it("grows a lens 4% about its middle slice's centroid and sinks it as far as its edges moved", () => {
    const lens: Placement = {
      ...upright("pyramid", [100, 200, 300], [1, 60, 90]),
      rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.7)
    }
    const inward = pieceWorld({ ...lens, center: { x: 0, y: 0, z: 0 } })(-1, 0, 0)
    const grown = tucked(lens, { x: inward.x * 5, y: inward.y * 5, z: inward.z * 5 })
    assert.deepStrictEqual(grown.half, { x: 1, y: 60 * 1.04, z: 90 * 1.04 })
    assert.deepStrictEqual(grown.rotation, lens.rotation)
    // The slice's inradius is its area over half its outline: 120 · 180 / (120 + 2 · √(60² + 180²)).
    const sunk = 0.04 * 120 * 180 / (120 + 2 * Math.hypot(60, 180))
    const centroid = (piece: Placement) => pieceWorld(piece)(0, 0, -1 / 3)
    const moved = vecSub(centroid(grown), centroid(lens))
    assertVec(moved, { x: inward.x * sunk, y: inward.y * sunk, z: inward.z * sunk }, "sunk", 1e-9)
  })
})

describe("shifted and pieceWorld", () => {
  const piece = upright("box", [10, 20, 30], [1, 2, 3])

  it("moves a piece along a direction of any length", () => {
    assert.deepStrictEqual(shifted(piece, { x: 0, y: 0, z: -7 }, 5), { ...piece, center: { x: 10, y: 20, z: 25 } })
  })

  it("places a point of the piece's own box in the world", () => {
    assert.deepStrictEqual(pieceWorld(piece)(1, -1, 0.5), { x: 11, y: 18, z: 31.5 })
    const turned = { ...piece, rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2) }
    assertVec(pieceWorld(turned)(1, 0, 0), { x: 10, y: 21, z: 30 }, "turned", 1e-9)
  })
})

describe("rectanglePlate", () => {
  // A slab 1000 by 800 cm and 100 cm thick; the plates go on its top.
  const slab = plateSurface(boxTriangles([0, 0, 0], [1000, 800, 100]))
  const id = patchFacing(slab, [0, 0, 1])
  const patch = slab.patches[id] ?? { faces: [], normal: { x: 0, y: 0, z: 1 }, centroid: { x: 0, y: 0, z: 0 }, area: 0 }
  const plane = new PatchPlane(patch, slab.mesh, slab.faces, slab.edges, slab.patchOf, id)
  /** How far `p` is outside the slab. */
  const outside = (p: Vec3) => Math.max(0, -p.x, p.x - 1000, -p.y, p.y - 800, -p.z, p.z - 100)
  /** As `outside`, with everything under `floor` far outside. */
  const outsideAbove = (floor: number) => (p: Vec3) => p.z < floor ? 1000 : outside(p)
  const whole = { s0: plane.from[0], s1: plane.to[0], t0: plane.from[1], t1: plane.to[1] }
  const inner = { s0: plane.from[0] + 100, s1: plane.to[0] - 100, t0: plane.from[1] + 100, t1: plane.to[1] - 100 }

  it("puts a plate's outer face on the patch, as thick as asked and past each side by the overlap", () => {
    const asked: Array<ReadonlyArray<Vec3>> = []
    const { halved, onSurface, plate } = rectanglePlate(
      plane,
      inner,
      (points) => {
        asked.push(points)
        return 40
      },
      6,
      outside
    )
    assert.isTrue(onSurface)
    assert.strictEqual(halved, 0)
    assert.strictEqual(plate.kind, "box")
    assertVec(plate.center, { x: 500, y: 400, z: 80 }, "centre", 1e-3)
    assert.closeTo(plate.half.z, 20, 1e-9)
    assert.deepStrictEqual([plate.half.x, plate.half.y].map(Math.round).sort((a, b) => a - b), [306, 406])
    assertVec(pieceWorld(plate)(0, 0, 1), { x: 500, y: 400, z: 100 }, "outer face", 1e-3)
    // The thickness is asked at the middle and at four points 15% in from the corners.
    assert.lengthOf(asked, 1)
    assert.lengthOf(asked[0] ?? [], 5)
    for (const p of asked[0] ?? []) assert.closeTo(p.z, 100, 1e-3)
  })

  it("halves a plate, its outer face staying put, until its inner corners are inside the container", () => {
    // Only the top 10 cm is inside: 64 cm thick goes to 32, 16 and 8.
    const { halved, onSurface, plate } = rectanglePlate(plane, inner, () => 64, 6, outsideAbove(90))
    assert.isTrue(onSurface)
    assert.strictEqual(halved, 3)
    assert.closeTo(plate.half.z, 4, 1e-9)
    assert.closeTo(plate.center.z, 96, 1e-3)
  })

  it("stops halving after six times, or once the plate is under 1 cm thick", () => {
    const nowhere = outsideAbove(99.99)
    assert.strictEqual(rectanglePlate(plane, inner, () => 640, 6, nowhere).halved, 6)
    const thin = rectanglePlate(plane, inner, () => 3, 6, nowhere)
    assert.strictEqual(thin.halved, 2)
    assert.closeTo(thin.plate.half.z, 0.375, 1e-9)
  })

  it("says when the rectangle's outline leaves the container's surface, within 5% of its shorter side", () => {
    const past = (by: number) => rectanglePlate(plane, { ...whole, s1: whole.s1 + by }, () => 40, 6, outside)
    assert.isTrue(past(30).onSurface)
    const off = past(60)
    assert.isFalse(off.onSurface)
    assert.strictEqual(off.halved, 0)
    assert.strictEqual(off.plate.half.z, 0.25)
  })
})

describe("plateOverlap", () => {
  it("is 15% of the plate's thickness, and of a voxel at most", () => {
    assert.closeTo(plateOverlap(10, 50), 1.5, 1e-9)
    assert.closeTo(plateOverlap(100, 50), 7.5, 1e-9)
  })
})
