import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { UE_TO_THREE_MATRIX, ueToScene } from "../domain/coords"
import { edgesOf, SelectionOutline } from "./selectionOutline"
import { isLine } from "./threeGuards"

/** A wedge (ramp) in UE local space: 400 long in X, 100 wide in Y, rising 0..30 cm in Z. */
const wedge = (): THREE.BufferGeometry => {
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(400, 0), new THREE.Vector2(400, 30)])
  // extruded along Z, then turned so the extrusion runs along UE Y
  return new THREE.ExtrudeGeometry(shape, { depth: 100, bevelEnabled: false }).rotateX(Math.PI / 2)
}

/** An item group like ItemObject builds: item transform -> mirror root -> UE-space mesh. */
const makeItem = (geometry: THREE.BufferGeometry) => {
  const half = (37 * Math.PI) / 360
  const t = ueToScene({
    translation: { x: 100, y: -50, z: 20 },
    rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }, // 37 deg about game Z
    scale3D: { x: 1, y: 2, z: 0.5 }
  })
  const item = new THREE.Group()
  item.position.set(...t.position)
  item.quaternion.set(...t.quaternion)
  item.scale.set(...t.scale)
  const mirror = new THREE.Group()
  mirror.matrixAutoUpdate = false
  mirror.matrix.set(...UE_TO_THREE_MATRIX)
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(50, 0, 0)
  mirror.add(mesh)
  item.add(mirror)
  item.updateMatrixWorld(true)
  return { item, mesh }
}

/** World-space endpoints of every drawn segment, rounded so they compare as strings. */
const segments = (line: THREE.Line): Array<string> => {
  const position = line.geometry.getAttribute("position")
  const out: Array<string> = []
  for (let i = 0; i < position.count; i += 2) {
    const ends = [i, i + 1].map((j) =>
      new THREE.Vector3().fromBufferAttribute(position, j).applyMatrix4(line.matrixWorld).toArray().map((n) =>
        Math.round(n * 1000) / 1000
      ).join(",")
    )
    out.push(ends.sort().join(" | "))
  }
  return out.sort()
}

const firstLine = (outline: THREE.Group): THREE.Line => {
  const line = outline.children[0]
  if (line === undefined || !isLine(line)) throw new Error("outline has no lines")
  return line
}

describe("selection outline", () => {
  it("draws a ramp's own edges, not its bounding box", () => {
    // a triangular prism has 9 edges; its bounding box would have 12
    expect(edgesOf(wedge()).getAttribute("position").count / 2).toBe(9)
  })

  it("lands every edge on the mesh in world space, through the item's transform", () => {
    const { item, mesh } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    outline.updateMatrixWorld(true)
    expect(outline.visible).toBe(true)
    expect(outline.children).toHaveLength(1)
    const line = firstLine(outline)
    const expected = new THREE.LineSegments(edgesOf(mesh.geometry))
    expected.matrixWorld.copy(mesh.matrixWorld)
    expect(segments(line)).toEqual(segments(expected))
  })

  it("follows meshes as they load and leave, and is never raycast", () => {
    const { item, mesh } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    const second = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10))
    mesh.parent!.add(second)
    outline.update(item)
    expect(outline.children).toHaveLength(2)
    outline.update(item) // idempotent: the outline's own lines are not meshes
    expect(outline.children).toHaveLength(2)
    second.removeFromParent()
    mesh.removeFromParent()
    outline.update(item)
    expect(outline.children).toHaveLength(0)
    expect(outline.visible).toBe(false)

    item.add(mesh)
    outline.update(item)
    // a ray straight through a drawn vertex still hits nothing
    const line = firstLine(outline)
    line.updateMatrixWorld(true)
    const vertex = new THREE.Vector3().fromBufferAttribute(line.geometry.getAttribute("position"), 0)
      .applyMatrix4(line.matrixWorld)
    const ray = new THREE.Raycaster(vertex.clone().add(new THREE.Vector3(0, 1000, 0)), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObject(outline, true)).toHaveLength(0)
  })

  it("caches edges per geometry and frees them with it", () => {
    const geometry = wedge()
    const edges = edgesOf(geometry)
    expect(edgesOf(geometry)).toBe(edges)
    geometry.dispose()
    expect(edgesOf(geometry)).not.toBe(edges)
  })
})
