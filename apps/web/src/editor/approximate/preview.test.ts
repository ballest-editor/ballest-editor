import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { shapeKinds, SHAPES } from "../../domain/approximate/shapes"
import { boxTriangles } from "../../test/boxTriangles"
import { upright } from "../../test/placement"
import { placementMatrix, shadeOf, standInGeometry } from "./pieceGeometry"
import { modelGeometryOf } from "./PreviewModel"

const pointsOf = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute("position")
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i))
}

describe("modelGeometryOf", () => {
  it("turns triangles that came through loadModel's mirror to face outward again", () => {
    const min = [-10, -20, 0] as const, max = [10, 20, 60] as const
    // A box wound outward in a right-handed frame, then Y negated, as a Z-up file comes into the game's frame.
    const mirrored = boxTriangles([min[0], -max[1], min[2]], [max[0], -min[1], max[2]]).map((v, i) =>
      i % 3 === 1 ? -v : v
    )
    const geometry = modelGeometryOf(mirrored)
    assert.deepStrictEqual(geometry.boundingBox?.min.toArray(), [...min])
    assert.deepStrictEqual(geometry.boundingBox?.max.toArray(), [...max])
    const middle = new THREE.Vector3(0, 0, 30)
    const corners = pointsOf(geometry)
    assert.lengthOf(corners, 36)
    for (let t = 0; t < corners.length; t += 3) {
      const [a, b, c] = corners.slice(t, t + 3)
      if (a === undefined || b === undefined || c === undefined) throw new Error("a ragged triangle")
      const normal = b.clone().sub(a).cross(c.clone().sub(a))
      assert.isAbove(normal.dot(a.clone().add(b).add(c).divideScalar(3).sub(middle)), 0)
    }
  })
})

describe("standInGeometry", () => {
  it("fills the piece's bounds, whatever the shape", () => {
    for (const kind of shapeKinds) {
      const { max, min } = SHAPES[kind].bounds
      const box = new THREE.Box3().setFromPoints(pointsOf(standInGeometry(kind, SHAPES[kind].bounds)))
      for (const axis of [0, 1, 2] as const) {
        assert.closeTo(box.min.getComponent(axis), min[axis], 1e-6, `${kind} low ${axis}`)
        assert.closeTo(box.max.getComponent(axis), max[axis], 1e-6, `${kind} high ${axis}`)
      }
    }
  })

  it("points the cone and the pyramid up, the half sphere's dome along +X, and the pyramid's corners along the axes", () => {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-3
    for (const kind of ["cone", "pyramid"] as const) {
      const top = pointsOf(standInGeometry(kind, SHAPES[kind].bounds)).filter((p) => near(p.z, 200))
      assert.isNotEmpty(top)
      assert.isTrue(top.every((p) => near(p.x, 0) && near(p.y, 0)), kind)
    }
    const base = pointsOf(standInGeometry("pyramid", SHAPES.pyramid.bounds)).filter((p) =>
      near(p.z, 0) && !near(p.length(), 0)
    )
    assert.isTrue(base.every((p) => near(Math.abs(p.x) + Math.abs(p.y), 250) && (near(p.x, 0) || near(p.y, 0))))
    const dome = pointsOf(standInGeometry("hemisphere", SHAPES.hemisphere.bounds))
    assert.isTrue(dome.filter((p) => near(p.x, 250)).every((p) => near(p.y, 0) && near(p.z, 0)))
    assert.isTrue(dome.filter((p) => near(p.x, -250)).every((p) => near(Math.hypot(p.y, p.z), 500)))
  })
})

describe("placementMatrix", () => {
  it("takes the piece's bounds to the placement's box", () => {
    const { max, min } = SHAPES.box.bounds
    const matrix = placementMatrix(
      SHAPES.box.bounds,
      upright("box", [100, 200, 300], [10, 20, 30]),
      new THREE.Matrix4()
    )
    assert.deepStrictEqual(new THREE.Vector3(...min).applyMatrix4(matrix).toArray(), [90, 180, 270])
    assert.deepStrictEqual(new THREE.Vector3(...max).applyMatrix4(matrix).toArray(), [110, 220, 330])
  })
})

describe("shadeOf", () => {
  it("gives each piece a lightness of its own, the same every time, and keeps the hue", () => {
    const base = new THREE.Color("#5b8def")
    const lightness = (n: number) => shadeOf(base, n, new THREE.Color()).getHSL({ h: 0, s: 0, l: 0 })
    const all = Array.from({ length: 50 }, (_, n) => lightness(n))
    assert.isAbove(new Set(all.map(({ l }) => l.toFixed(3))).size, 40)
    assert.isTrue(
      all.every(({ h, l }) => l >= 0.2 && l <= 0.85 && Math.abs(h - base.getHSL({ h: 0, s: 0, l: 0 }).h) < 1e-3)
    )
    assert.deepStrictEqual(lightness(7), lightness(7))
  })
})
