import { assert, describe, it } from "@effect/vitest"
import { patchFacing, type PlateSurface, plateSurface, prismTriangles } from "../../../test/plateSurface"
import type { Vec3 } from "../../coords"
import { vecDot } from "../../ueMath"
import { PatchPlane, type Rect, rectanglesOf } from "./patchPlane"

/**
 * An L, 400 cm along x and y with arms 200 cm wide, 100 cm tall. Its top is an L of four faces; the side that looks
 * along +y from the end of the arm along x meets the side of the other arm in a concave edge at x = 200.
 */
const ell = plateSurface(prismTriangles([[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]], 0, 100), 32)

const planeOf = (surface: PlateSurface, id: number): PatchPlane => {
  const patch = surface.patches[id]
  if (patch === undefined) throw new Error("no such patch")
  return new PatchPlane(patch, surface.mesh, surface.faces, surface.edges, surface.patchOf, id)
}

/** The rectangle's bounds in the world. */
const boundsOf = (plane: PatchPlane, rect: Rect) => {
  const corners = [[rect.s0, rect.t0], [rect.s1, rect.t0], [rect.s0, rect.t1], [rect.s1, rect.t1]] as const
  const world = corners.map(([s, t]) => plane.world(s, t))
  const span = (of: (p: Vec3) => number) => [Math.min(...world.map(of)), Math.max(...world.map(of))] as const
  return { x: span((p) => p.x), y: span((p) => p.y), z: span((p) => p.z) }
}

const inEll = (x: number, y: number) => x >= 0 && y >= 0 && x <= 400 && y <= 400 && (x <= 200 || y <= 200)

describe("PatchPlane", () => {
  const top = planeOf(ell, patchFacing(ell, [0, 0, 1]))

  it("lies in the patch's plane with its axes square to each other and along the patch's sides", () => {
    assert.closeTo(vecDot(top.s, top.t), 0, 1e-9)
    assert.closeTo(vecDot(top.s, top.patch.normal), 0, 1e-9)
    assert.closeTo(Math.max(Math.abs(top.s.x), Math.abs(top.s.y)), 1, 1e-9)
    assert.closeTo(top.to[0] - top.from[0], 400, 1e-3)
    assert.closeTo(top.to[1] - top.from[1], 400, 1e-3)
    assert.closeTo(top.world(0, 0).z, 100, 1e-9)
  })

  it("turns its axes to the smallest rectangle round the patch", () => {
    const turn = (
      x: number,
      y: number
    ) => [x * Math.cos(0.5) - y * Math.sin(0.5), x * Math.sin(0.5) + y * Math.cos(0.5)]
    const outline = ([[0, 0], [600, 0], [600, 200], [0, 200]] as const).map(([x, y]) => {
      const [u = 0, v = 0] = turn(x, y)
      return [u, v] as const
    })
    const turned = plateSurface(prismTriangles(outline, 0, 100), 32)
    const plane = planeOf(turned, patchFacing(turned, [0, 0, 1]))
    const sides = [plane.to[0] - plane.from[0], plane.to[1] - plane.from[1]].sort((a, b) => a - b)
    assert.closeTo(sides[0] ?? 0, 200, 1e-2)
    assert.closeTo(sides[1] ?? 0, 600, 1e-2)
  })

  it("holds the patch's faces and only the edges of its outline", () => {
    assert.lengthOf(top.triangles, 4)
    // Six edges round the L; the three inside it are shared by two of its faces.
    assert.lengthOf(top.outline, 6)
    assert.isTrue(top.outline.every((edge) => !edge.concave))
  })

  it("finds the face at a point, and lets a plate past a concave edge only", () => {
    const inside = top.triangles[0]?.corners.reduce((sum, p) => [sum[0] + p[0] / 3, sum[1] + p[1] / 3] as const, [0, 0])
    assert.strictEqual(top.faceAt(inside ?? [0, 0]), top.triangles[0]?.face)
    const outside = [top.to[0] + 10, top.to[1] + 10] as const
    assert.strictEqual(top.faceAt(outside), -1)
    assert.isFalse(top.open(outside, 50))

    const tread = planeOf(ell, patchFacing(ell, [0.1, 1, 0]))
    assert.deepStrictEqual(tread.outline.map((edge) => edge.concave).filter(Boolean), [true])
    // The tread's middle is at x = 300: 110 cm along the tread's long axis is past one end of it or the other.
    const along = Math.abs(tread.s.x) > 0.5 ? 0 : 1
    const past = (by: number): readonly [number, number] => along === 0 ? [by, 0] : [0, by]
    const concaveEnd = [past(110), past(-110)].filter((p) => tread.world(...p).x < 200)
    const convexEnd = [past(110), past(-110)].filter((p) => tread.world(...p).x > 400)
    assert.lengthOf(concaveEnd, 1)
    assert.lengthOf(convexEnd, 1)
    for (const p of concaveEnd) {
      assert.isTrue(tread.open(p, 15))
      assert.isFalse(tread.open(p, 5))
      assert.isTrue(tread.pastConcaveEdge(p, 15))
    }
    for (const p of convexEnd) assert.isFalse(tread.open(p, 15))
  })
})

describe("rectanglesOf", () => {
  it("covers a rectangular patch with one rectangle to its outline", () => {
    const side = planeOf(ell, patchFacing(ell, [-1, 0, 0]))
    const { bare, rects } = rectanglesOf(side, 0, 100)
    assert.lengthOf(rects, 1)
    assert.deepStrictEqual(bare, [])
    const bounds = boundsOf(side, rects[0] ?? { s0: 0, s1: 0, t0: 0, t1: 0 })
    assert.closeTo(bounds.y[0], 0, 1e-3)
    assert.closeTo(bounds.y[1], 400, 1e-3)
    assert.closeTo(bounds.z[0], 0, 1e-3)
    assert.closeTo(bounds.z[1], 100, 1e-3)
  })

  it("covers an L with two overlapping rectangles that stay inside it", () => {
    const top = planeOf(ell, patchFacing(ell, [0, 0, 1]))
    const { bare, rects } = rectanglesOf(top, 0, 100)
    assert.lengthOf(rects, 2)
    assert.deepStrictEqual(bare, [])
    const bounds = rects.map((rect) => boundsOf(top, rect))
    for (let x = 10; x < 420; x += 20) {
      for (let y = 10; y < 420; y += 20) {
        const covered = bounds.some((b) => x >= b.x[0] && x <= b.x[1] && y >= b.y[0] && y <= b.y[1])
        assert.strictEqual(covered, inEll(x, y), `${x}, ${y}`)
      }
    }
  })

  it("reaches past a concave edge by the reach to the nearest cell, and past no other edge", () => {
    const tread = planeOf(ell, patchFacing(ell, [0.1, 1, 0]))
    // The tread is 200 by 100 cm, so its cells are 6.25 cm.
    const reaching = rectanglesOf(tread, 30, 100).rects.map((rect) => boundsOf(tread, rect))
    assert.lengthOf(reaching, 1)
    assert.closeTo(reaching[0]?.x[0] ?? 0, 170, 6.25)
    assert.closeTo(reaching[0]?.x[1] ?? 0, 400, 6.25)
    assert.closeTo(reaching[0]?.z[0] ?? 0, 0, 6.25)
    assert.closeTo(reaching[0]?.z[1] ?? 0, 100, 6.25)
    const held = rectanglesOf(tread, 0, 100).rects.map((rect) => boundsOf(tread, rect))
    assert.closeTo(held[0]?.x[0] ?? 0, 200, 1e-3)
    assert.closeTo(held[0]?.x[1] ?? 0, 400, 1e-3)
  })

  it("names the faces its rectangles leave bare, by their share of the face or by their area", () => {
    // A right triangle: rectangles grown from its deepest cells leave its corners bare.
    const wedge = plateSurface(prismTriangles([[0, 0], [600, 0], [0, 600]], 0, 100), 32)
    const id = patchFacing(wedge, [0, 0, 1])
    const plane = planeOf(wedge, id)
    const { bare, rects } = rectanglesOf(plane, 0, Infinity)
    assert.isAtLeast(rects.length, 1)
    assert.isAtMost(rects.length, 6)
    assert.deepStrictEqual(bare, [])
    // Under 30% of the face is bare, but more than a square of 30 cm.
    assert.deepStrictEqual(rectanglesOf(plane, 0, 900).bare, [...(wedge.patches[id]?.faces ?? [])])
  })
})
