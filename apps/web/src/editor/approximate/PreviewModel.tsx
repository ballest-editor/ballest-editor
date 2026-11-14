/** The model in the approximation preview, solid or as a ghost the pieces show through. */
import * as THREE from "three"

/**
 * The model's triangles as a geometry in the game's frame, where the preview draws everything. The triangles came
 * into the game's frame through a mirror (loadModel.ts), which turned each one to face inward, so every triangle's
 * second and third corners swap back.
 */
export const modelGeometryOf = (triangles: Float32Array): THREE.BufferGeometry => {
  const positions = triangles.slice()
  for (let t = 0; t + 9 <= positions.length; t += 9) {
    positions.copyWithin(t + 3, t + 6, t + 9)
    positions.set(triangles.subarray(t + 3, t + 6), t + 6)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  return geometry
}

export function PreviewModel({ geometry, ghost, x }: {
  readonly geometry: THREE.BufferGeometry
  readonly ghost: boolean
  /** Where it stands along X, in cm. */
  readonly x: number
}) {
  return (
    <mesh geometry={geometry} position={[x, 0, 0]}>
      {/* One material, every prop given either way: a second material in its place came out see-through. */}
      <meshStandardMaterial
        color={ghost ? "#d8dde6" : "#c9ced6"}
        roughness={0.8}
        flatShading
        transparent={ghost}
        opacity={ghost ? 0.22 : 1}
        depthWrite={!ghost}
      />
    </mesh>
  )
}
