import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { BEAM_REACH, traceBeam } from "./LaserBeam"

/** An item group as ItemObject builds it: a 100 cm cube centred at `x` on the scene's x axis. */
const item = (id: string, x: number): THREE.Group => {
  const group = new THREE.Group()
  group.userData["itemId"] = id
  const cube = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial())
  cube.position.x = x
  group.add(cube)
  return group
}

const scene = (...items: ReadonlyArray<THREE.Group>): THREE.Group => {
  const root = new THREE.Group()
  for (const i of items) root.add(i)
  root.updateMatrixWorld(true)
  return root
}

const origin = new THREE.Vector3(0, 0, 0)
const along = new THREE.Vector3(1, 0, 0)

describe("traceBeam", () => {
  it("stops at the first other item in the beam's way", () => {
    const root = scene(item("laser", 0), item("far", 1500), item("near", 600))
    expect(traceBeam(root, origin, along, "laser", BEAM_REACH)).toBeCloseTo(550)
  })

  it("passes through its own terminal and reaches its full length when nothing is in the way", () => {
    const root = scene(item("laser", 0), item("behind", -600))
    expect(traceBeam(root, origin, along, "laser", BEAM_REACH)).toBe(BEAM_REACH)
  })

  it("ignores what lies beyond its reach", () => {
    const root = scene(item("laser", 0), item("far", 1500))
    expect(traceBeam(root, origin, along, "laser", 1000)).toBe(1000)
  })
})
