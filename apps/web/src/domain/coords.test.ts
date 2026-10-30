import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import * as THREE from "three"
import { listSamples, readSample } from "../test/samples"
import { expectVec } from "../test/vec"
import {
  type Quat4,
  sceneToUe,
  threeToUeQuat,
  threeToUeVector,
  UE_TO_THREE_MATRIX,
  ueBoundsToScene,
  ueToScene,
  ueToThreeQuat,
  ueToThreeVector,
  type Vec3
} from "./coords"
import { MapFile } from "./MapFile"

const decodeSample = Schema.decodeSync(Schema.fromJsonString(MapFile))

/** FQuat::RotateVector: v' = v + 2w(q x v) + 2 q x (q x v), evaluated on raw UE components. */
const ueRotate = (q: Quat4, v: Vec3): Vec3 => {
  const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  })
  const t = cross(q, v)
  const t2 = { x: 2 * t.x, y: 2 * t.y, z: 2 * t.z }
  const u = cross(q, t2)
  return { x: v.x + q.w * t2.x + u.x, y: v.y + q.w * t2.y + u.y, z: v.z + q.w * t2.z + u.z }
}

const threeRotate = (q: Quat4, v: Vec3): Vec3 => {
  const r = new THREE.Vector3(v.x, v.y, v.z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w))
  return { x: r.x, y: r.y, z: r.z }
}

const UE_FORWARD = { x: 1, y: 0, z: 0 }
const UE_RIGHT = { x: 0, y: 1, z: 0 }
const UE_UP = { x: 0, y: 0, z: 1 }
const probes: ReadonlyArray<Vec3> = [UE_FORWARD, UE_RIGHT, UE_UP, { x: 0.3, y: -1.7, z: 2.2 }]

describe("coords", () => {
  it("keeps forward/right/up: right = forward x up in three's right-handed frame", () => {
    const f = ueToThreeVector(UE_FORWARD)
    const r = ueToThreeVector(UE_RIGHT)
    const u = ueToThreeVector(UE_UP)
    expect(u).toEqual({ x: 0, y: 1, z: 0 }) // Z-up -> Y-up
    const fxu = new THREE.Vector3(f.x, f.y, f.z).cross(new THREE.Vector3(u.x, u.y, u.z))
    expectVec(fxu, r)
  })

  it("rejects the rotation-only mapping (x, z, -y): it would mirror maps", () => {
    const f = new THREE.Vector3(1, 0, 0)
    const u = new THREE.Vector3(0, 1, 0)
    const rightUnderProperRotation = new THREE.Vector3(0, 0, -1)
    expect(f.clone().cross(u).equals(rightUnderProperRotation)).toBe(false)
  })

  it("maps the sample checkpoint rotation (-90 deg about UE Y: forward pitches up)", () => {
    const q = { x: 0, y: -Math.SQRT1_2, z: 0, w: 0.70710678118654768 }
    // In UE this rotation turns forward (+X) into up (+Z).
    expectVec(ueRotate(q, UE_FORWARD), UE_UP)
    const q3 = ueToThreeQuat(q)
    // +90 deg about three Z
    expect(q3.x).toBeCloseTo(0, 12)
    expect(q3.y).toBeCloseTo(0, 12)
    expect(q3.z).toBeCloseTo(Math.SQRT1_2, 12)
    expect(q3.w).toBeCloseTo(Math.SQRT1_2, 12)
    expectVec(threeRotate(q3, ueToThreeVector(UE_FORWARD)), ueToThreeVector(UE_UP))
  })

  it("maps UE +90 yaw (forward turns right) to the same turn in three", () => {
    const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    expectVec(ueRotate(yaw90, UE_FORWARD), UE_RIGHT)
    expectVec(threeRotate(ueToThreeQuat(yaw90), ueToThreeVector(UE_FORWARD)), ueToThreeVector(UE_RIGHT))
  })

  const samples = listSamples()
  it.each(samples.map((s) => [s.name, s] as const))(
    "conjugation and exact round-trip for every transform in %s",
    (_name, sample) => {
      const map = decodeSample(readSample(sample))
      // Rotating then mapping == mapping then rotating, for the first 200 items.
      for (const item of map.items.slice(0, 200)) {
        const q = item.itemTransform.rotation
        const q3 = ueToThreeQuat(q)
        for (const p of probes) {
          expectVec(threeRotate(q3, ueToThreeVector(p)), ueToThreeVector(ueRotate(q, p)), 6)
        }
      }
      // Round trips are bit-exact (only permutations and negations).
      for (const item of map.items) {
        const t = item.itemTransform
        expect(sceneToUe(ueToScene(t))).toEqual({
          translation: t.translation,
          rotation: t.rotation,
          scale3D: t.scale3D
        })
        expect(threeToUeQuat(ueToThreeQuat(t.rotation))).toEqual(t.rotation)
        expect(threeToUeVector(ueToThreeVector(t.translation))).toEqual(t.translation)
      }
    }
  )

  it("agrees with a THREE.Object3D world matrix for a full item transform", () => {
    const t = {
      translation: { x: 1280, y: -1863, z: 8896 },
      rotation: { x: -0.09466589589358565, y: -0.6000308767388327, z: 0.05820851444896724, w: 0.79222035063506 },
      scale3D: { x: 1.5, y: 2, z: 3 }
    }
    const s = ueToScene(t)
    const obj = new THREE.Object3D()
    obj.position.set(...s.position)
    obj.quaternion.set(...s.quaternion)
    obj.scale.set(...s.scale)
    obj.updateMatrixWorld()
    const local = { x: 10, y: -20, z: 30 }
    // UE: world = T + R(S * local)
    const r = ueRotate(t.rotation, { x: local.x * t.scale3D.x, y: local.y * t.scale3D.y, z: local.z * t.scale3D.z })
    const ueWorld = { x: r.x + t.translation.x, y: r.y + t.translation.y, z: r.z + t.translation.z }
    const l3 = ueToThreeVector(local)
    const w3 = new THREE.Vector3(l3.x, l3.y, l3.z).applyMatrix4(obj.matrixWorld)
    expectVec(w3, ueToThreeVector(ueWorld), 6)
  })

  it("converts bounds, and the glb matrix equals the vector mapping (a reflection)", () => {
    expect(ueBoundsToScene([-50, -100, 0], [50, 100, 20])).toEqual({ size: [100, 20, 200], center: [0, 10, 0] })
    const m = new THREE.Matrix4().set(...UE_TO_THREE_MATRIX)
    expect(m.determinant()).toBe(-1)
    const v = { x: 3, y: -5, z: 7 }
    expectVec(new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(m), ueToThreeVector(v))
  })
})
