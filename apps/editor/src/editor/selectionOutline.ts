/**
 * Selection outline along the mesh's own edges, like the game draws it: one LineSegments per
 * mesh under the item, over that mesh's EdgesGeometry (cached per geometry; glb clones share
 * theirs). The outline group is parented to the item and each line carries its mesh's matrix
 * relative to the item, so it follows the item's world transform with no per-frame geometry
 * work. A ramp or bevel shows its real shape instead of an oriented bounding box.
 */
import * as THREE from "three"
import { isMesh } from "./threeGuards"

/** Faces meeting at more than this angle draw an edge; curved strips stay smooth. */
const EDGE_THRESHOLD_DEG = 30

/**
 * How far each line vertex is pulled toward the eye, as a fraction of its view distance.
 * The edges lie exactly on the mesh surface; without this they z-fight with it.
 */
const DEPTH_PULL = 0.002

const edgesCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>()

/** The hard edges of `geometry`, built once and freed with it. */
export const edgesOf = (geometry: THREE.BufferGeometry): THREE.EdgesGeometry => {
  const cached = edgesCache.get(geometry)
  if (cached !== undefined) return cached
  const edges = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEG)
  edgesCache.set(geometry, edges)
  geometry.addEventListener("dispose", () => {
    edgesCache.delete(geometry)
    edges.dispose()
  })
  return edges
}

/** Shared by every outline line; one small material for the editor's lifetime. */
const outlineMaterial = new THREE.LineBasicMaterial({ color: "#ffb020", toneMapped: false })
outlineMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    "#include <project_vertex>",
    `#include <project_vertex>
    mvPosition.xyz += (isPerspectiveMatrix(projectionMatrix) ? -mvPosition.xyz : vec3(0.0, 0.0, length(mvPosition.xyz))) * ${DEPTH_PULL};
    gl_Position = projectionMatrix * mvPosition;`
  )
}

const inverse = new THREE.Matrix4()

/** The outline of one item: add it to the item, then `update` it from that item. Never raycast. */
export class SelectionOutline extends THREE.Group {
  private readonly lines: Array<THREE.LineSegments> = []

  /**
   * Matches the lines to the meshes under `item` (the outline itself holds no meshes) and
   * places each in `item`'s local space. Cheap enough per frame: glbs load async, so the
   * caller keeps it fresh.
   */
  update(item: THREE.Object3D): void {
    item.updateMatrixWorld(true)
    inverse.copy(item.matrixWorld).invert()
    let count = 0
    item.traverse((object) => {
      if (!isMesh(object)) return
      const edges = edgesOf(object.geometry)
      let line = this.lines[count]
      if (line === undefined) {
        line = new THREE.LineSegments(edges, outlineMaterial)
        line.matrixAutoUpdate = false
        line.raycast = () => {}
        this.lines.push(line)
      }
      line.geometry = edges
      line.matrix.multiplyMatrices(inverse, object.matrixWorld)
      if (line.parent !== this) this.add(line)
      count++
    })
    for (const extra of this.lines.slice(count)) extra.removeFromParent()
    this.visible = count > 0
  }
}
