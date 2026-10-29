import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { frameBox, SerialQueue, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from "./thumbnails"

describe("thumbnail framing", () => {
  const fits = (min: readonly [number, number, number], max: readonly [number, number, number], aspect: number) => {
    const framing = frameBox(min, max, aspect)
    const camera = new THREE.PerspectiveCamera(35, aspect, framing.near, framing.far)
    camera.position.set(...framing.position)
    camera.lookAt(...framing.target)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    )
    const corners = [min, max].flatMap((a) => [min, max].flatMap((b) => [min, max].map((c) => [a[0], b[1], c[2]])))
    return corners.every(([x, y, z]) => frustum.containsPoint(new THREE.Vector3(x, y, z)))
  }

  it("keeps every corner of the box in view, for cubes and long flat pieces, at the thumbnail aspect", () => {
    const aspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
    assert.isTrue(fits([-50, -50, -50], [50, 50, 50], aspect))
    assert.isTrue(fits([-262, 0, -250], [262, 145, 250], aspect)) // Curve1 S
    assert.isTrue(fits([-1000, -5, -20], [1000, 5, 20], aspect)) // a plank
    assert.isTrue(fits([0, 0, 0], [0, 0, 0], aspect)) // degenerate: still a finite camera
  })

  it("looks at the box centre from the front-right, above", () => {
    const framing = frameBox([0, 0, 0], [100, 100, 100], 1)
    assert.deepStrictEqual(framing.target, [50, 50, 50])
    assert.isTrue(framing.position.every((c, i) => c > framing.target[i]!))
    assert.isTrue(framing.near > 0 && framing.far > framing.near)
  })
})

describe("SerialQueue", () => {
  it("runs tasks one at a time in order, and a failure doesn't block the next", async () => {
    const queue = new SerialQueue()
    const log: Array<string> = []
    const task = (name: string, ms: number, fail = false) => () =>
      new Promise<string>((resolve, reject) =>
        setTimeout(() => {
          log.push(name)
          if (fail) reject(new Error(name))
          else resolve(name)
        }, ms)
      )
    const a = queue.run(task("a", 20))
    const b = queue.run(task("b", 1, true)).then(
      () => "resolved",
      (e: unknown) => `rejected ${e instanceof Error ? e.message : String(e)}`
    )
    const c = queue.run(task("c", 1))
    assert.strictEqual(await a, "a")
    assert.strictEqual(await b, "rejected b")
    assert.strictEqual(await c, "c")
    assert.deepStrictEqual(log, ["a", "b", "c"])
  })
})
