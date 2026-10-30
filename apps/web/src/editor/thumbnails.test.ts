import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { parseMaterialsFile } from "../domain/Materials"
import { materialsFile, OUTLINE, PIPE, primitive, WIND } from "../test/materials"
import { applySlotMaterials, materialFor, shaderPatchOf } from "./materials"
import { isTexture } from "./threeGuards"
import { frameBox, SerialQueue, texturesOf, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, whenTexturesReady } from "./thumbnails"

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

describe("texture readiness", () => {
  it("collects every texture a piece's materials sample, patch samplers included", () => {
    const table = parseMaterialsFile(materialsFile)
    const root = new THREE.Group()
    root.add(primitive("0:Outline"), primitive("1:Pipe"), primitive("2:Wind"))
    applySlotMaterials(root, table, [OUTLINE, PIPE, WIND])
    const textures = new Set(texturesOf(root))
    const outline = materialFor(table, OUTLINE), pipe = materialFor(table, PIPE), wind = materialFor(table, WIND)
    for (const t of [outline.normalMap, shaderPatchOf(outline)?.uniforms.uVariationMap.value]) {
      assert.isTrue(textures.has(t!))
    }
    assert.isTrue(textures.has(shaderPatchOf(outline)!.uniforms.uNormalMap2.value!)) // the second normal layer
    assert.isTrue(textures.has(shaderPatchOf(pipe)!.uniforms.uColorMap1.value!)) // a colour layer
    assert.isTrue(textures.has(shaderPatchOf(wind)!.uniforms.uAlphaMap.value!)) // the alpha layer
    const programRead: unknown = shaderPatchOf(wind)!.uniforms["uTex0"]!.value
    assert.isTrue(isTexture(programRead) && textures.has(programRead)) // a program's read
  })

  it("waits for the textures to load or fail, and no longer than the timeout", async () => {
    const a = new THREE.Texture(), b = new THREE.Texture()
    const settled: Array<string> = []
    const loaded = (t: THREE.Texture) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          settled.push(t === a ? "a" : "b")
          resolve()
        }, t === a ? 5 : 1000)
      )
    const start = performance.now()
    await whenTexturesReady([a, b], 40, loaded)
    const elapsed = performance.now() - start
    assert.deepStrictEqual(settled, ["a"]) // b (a hung load) does not hold the queue past the timeout
    assert.isBelow(elapsed, 500)
    await whenTexturesReady([a], 1000, loaded) // all settled: back well before the timeout
    assert.isBelow(performance.now() - start, 500)
    await whenTexturesReady([], 1000, loaded)
  })
})
