import { assert, describe, it } from "@effect/vitest"
import type { Vec3 } from "../../coords"
import { quatFromAxisAngle, rotateVec, vecAdd, vecCross, vecDistance, vecDot, vecNormalize, vecSub } from "../../ueMath"
import type { Placement } from "../shapes"
import { acutePyramid, cornerCosine, overlappingAcute } from "./acutePyramid"

const point = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** A pyramid's corner at (x, y, z) of its own box, each from -1 to 1. */
const cornerOf = (pyramid: Placement, x: number, y: number, z: number): Vec3 =>
  vecAdd(
    pyramid.center,
    rotateVec(pyramid.rotation, point(x * pyramid.half.x, y * pyramid.half.y, z * pyramid.half.z))
  )

/** The side of a pyramid between its +X and +Y base corners and its apex. */
const sideOf = (
  pyramid: Placement
) => [cornerOf(pyramid, 1, 0, -1), cornerOf(pyramid, 0, 1, -1), cornerOf(pyramid, 0, 0, 1)]

const ACUTE = [
  [point(0, 0, 0), point(100, 0, 0), point(50, 86.60254, 0)],
  [point(10, 20, 30), point(130, 30, 20), point(55, 105, 45)],
  [point(0, 0, 0), point(150, 0, 0), point(20, 80, 0)]
] as const

/** Each acute triangle, turned and moved a few ways. */
const posed = ACUTE.flatMap((corners) =>
  [0, 0.7, 2.4].map((angle) => {
    const turn = quatFromAxisAngle(vecNormalize(point(1, 2, 3)), angle)
    const [a, b, c] = corners.map((p) => vecAdd(rotateVec(turn, p), point(300, -500, 100)))
    return [a ?? point(0, 0, 0), b ?? point(0, 0, 0), c ?? point(0, 0, 0)] as const
  })
)

describe("acutePyramid", () => {
  it("lays the pyramid's +X, +Y, apex side on the triangle, with the rest of it behind", () => {
    for (const [a, b, c] of posed) {
      const front = vecNormalize(vecCross(vecSub(b, a), vecSub(c, a)))
      for (const normal of [front, point(-front.x, -front.y, -front.z)]) {
        const pyramid = acutePyramid(a, b, c, normal)
        if (pyramid === undefined) return assert.fail("no pyramid for an acute triangle")
        assert.strictEqual(pyramid.kind, "pyramid")
        for (const p of [a, b, c]) {
          assert.isBelow(Math.min(...sideOf(pyramid).map((corner) => vecDistance(p, corner))), 1e-3)
        }
        assert.isBelow(vecDistance(cornerOf(pyramid, 1, 0, -1), a), 1e-3)
        for (const behind of [cornerOf(pyramid, -1, 0, -1), cornerOf(pyramid, 0, -1, -1)]) {
          assert.isBelow(vecDot(vecSub(behind, a), normal), 1e-3)
        }
      }
    }
  })

  it("makes the same pyramid whichever way round the corners are given", () => {
    for (const [a, b, c] of posed) {
      const normal = vecCross(vecSub(b, a), vecSub(c, a))
      assert.deepStrictEqual(acutePyramid(a, c, b, normal), acutePyramid(a, b, c, normal))
    }
  })

  it("has none for a right, a wide or a flat triangle", () => {
    for (const c of [point(0, 100, 0), point(-20, 30, 0), point(50, 0, 0), point(0, 0, 0)]) {
      assert.isUndefined(acutePyramid(point(0, 0, 0), point(100, 0, 0), c, point(0, 0, 1)))
    }
  })
})

describe("cornerCosine", () => {
  it("is the cosine of the corner at the first point", () => {
    assert.closeTo(cornerCosine(point(0, 0, 0), point(5, 0, 0), point(0, 7, 0)), 0, 1e-12)
    assert.closeTo(cornerCosine(point(0, 0, 0), point(2, 0, 0), point(1, Math.sqrt(3), 0)), 0.5, 1e-12)
    assert.closeTo(cornerCosine(point(0, 0, 0), point(2, 0, 0), point(-3, 0, 0)), -1, 1e-12)
  })

  it("is 0 where a side has no length", () => {
    assert.strictEqual(cornerCosine(point(1, 1, 1), point(1, 1, 1), point(4, 1, 1)), 0)
  })
})

/** Whether `p` is in the triangle `face`, both in the z = 0 plane. */
const inside = (p: Vec3, [u, v, w]: readonly [Vec3, Vec3, Vec3]) => {
  const turns = [[u, v], [v, w], [w, u]] as const
  const crosses = turns.map(([q, r]) => vecCross(vecSub(r, q), vecSub(p, q)).z)
  return crosses.every((z) => z >= -1e-6) || crosses.every((z) => z <= 1e-6)
}

describe("overlappingAcute", () => {
  const b = point(0, 0, 0), c = point(100, 0, 0)

  it("covers a right or wide triangle with two acute ones inside it", () => {
    for (const a of [point(20, 30, 0), point(50, 50, 0), point(80, 15, 0)]) {
      const pair = overlappingAcute(a, b, c)
      if (pair === undefined) return assert.fail("no cover")
      for (const face of pair) {
        assert.isDefined(acutePyramid(...face, point(0, 0, 1)))
        for (const corner of face) assert.isTrue(inside(corner, [a, b, c]))
      }
      // Points all over the triangle, by their weights on its corners.
      for (let i = 0; i <= 30; i++) {
        for (let j = 0; j <= 30 - i; j++) {
          const k = 30 - i - j
          const p = point((a.x * i + b.x * j + c.x * k) / 30, (a.y * i + b.y * j + c.y * k) / 30, 0)
          assert.isTrue(pair.some((face) => inside(p, face)))
        }
      }
    }
  })

  it("has none for a triangle with no area", () => {
    assert.isUndefined(overlappingAcute(point(40, 0, 0), b, c))
    assert.isUndefined(overlappingAcute(b, b, b))
  })
})
