/** One geometry drawn many times in the approximation preview: an instanced mesh that its user fills in. */
import { type ReactNode, useCallback } from "react"
import type * as THREE from "three"

export function PreviewInstances({ children, count, geometry, write }: {
  readonly count: number
  readonly geometry: THREE.BufferGeometry
  /** Sets the matrix of each of the first `count` instances, and its colour where they have one. */
  readonly write: (mesh: THREE.InstancedMesh) => void
  /** The material. */
  readonly children: ReactNode
}) {
  // An instanced mesh can't grow. Room for the next power of two means a run's pieces, which come a few more at a
  // time, seldom need a new one.
  const capacity = 2 ** Math.ceil(Math.log2(Math.max(count, 1)))
  // As a ref, this runs for a new mesh as well as for new instances.
  const fill = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (mesh === null) return
    mesh.count = count
    write(mesh)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    // What the renderer culls by, which three works out once and keeps.
    mesh.computeBoundingSphere()
  }, [count, write])
  return (
    <instancedMesh key={`${geometry.uuid} ${capacity}`} ref={fill} args={[geometry, undefined, capacity]}>
      {children}
    </instancedMesh>
  )
}
