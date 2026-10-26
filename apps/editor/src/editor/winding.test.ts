import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { UE_TO_THREE_MATRIX } from "../domain/coords"
import { repoRoot } from "../test/samples"
import { fixWinding, normalAgreement } from "./winding"

const loadGlb = async (rel: string) => {
  const buf = fs.readFileSync(path.join(repoRoot, "assets/pieces", rel))
  return new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "")
}
const meshesOf = (root: THREE.Object3D) => {
  const out: Array<THREE.Mesh> = []
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o)
  })
  return out
}

/**
 * What three.js draws as the front: a triangle is front-facing when its screen winding is
 * CCW, with gl.frontFace flipped when the world matrix is mirrored. Equivalently: the
 * local-space right-handed face normal agrees with the local vertex normal.
 */
const frontFacesPointOutward = (mesh: THREE.Mesh) => (normalAgreement(mesh.geometry) ?? 0) > 0.99

describe("glb winding", () => {
  it("flips clockwise triangles once, and leaves correct ones alone", () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3)) // CW seen from +z
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
    g.setIndex([0, 1, 2])
    expect(normalAgreement(g)).toBe(0)
    expect(fixWinding(g)).toBe(true)
    expect(normalAgreement(g)).toBe(1)
    expect(fixWinding(g)).toBe(false) // idempotent
    const ok = g.clone()
    ok.userData = {}
    expect(fixWinding(ok)).toBe(false)
  })

  const pieces = ["Maps/_GENERATED/PC/Torus.glb", "Maps/_GENERATED/PC/SM_Sphere.glb", "Maps/_GENERATED/PC/SM_500.glb"]
  const present = pieces.filter((p) => fs.existsSync(path.join(repoRoot, "assets/pieces", p)))
  it.skipIf(present.length === 0).each(present)("%s renders outward faces under the mirror root", async (rel) => {
    const gltf = await loadGlb(rel)
    const root = new THREE.Group()
    root.matrixAutoUpdate = false
    root.matrix.set(...UE_TO_THREE_MATRIX)
    root.add(gltf.scene)
    root.updateMatrixWorld(true)
    for (const mesh of meshesOf(root)) {
      fixWinding(mesh.geometry)
      expect(mesh.matrixWorld.determinant()).toBeLessThan(0) // three will use CW front faces...
      expect(frontFacesPointOutward(mesh)).toBe(true) // ...which now are the outward ones
      expect((mesh.material as THREE.Material).side).toBe(THREE.FrontSide)
    }
  })
})
