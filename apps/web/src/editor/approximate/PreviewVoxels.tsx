/** The approximation preview's Voxels view: the cells the method saw as solid, the ones that show. */
import { useCallback, useMemo } from "react"
import * as THREE from "three"
import { surfaceCubes } from "../../domain/approximate/grid/boxMerge"
import type { VoxelGrid } from "../../domain/approximate/grid/voxelize"
import { PreviewInstances } from "./PreviewInstances"

/** How much of its cell a voxel fills, so neighbours show as separate cubes. */
const FILL = 0.92

/** `grid`'s solid cells that have an empty neighbour, each a cube in the game's frame. */
export function PreviewVoxels({ grid }: { readonly grid: VoxelGrid }) {
  const cubes = useMemo(() => surfaceCubes(grid), [grid])
  const geometry = useMemo(() => {
    const side = grid.voxel * FILL
    return new THREE.BoxGeometry(side, side, side)
  }, [grid.voxel])
  const write = useCallback((mesh: THREE.InstancedMesh) => {
    const matrix = new THREE.Matrix4()
    cubes.forEach(({ center }, n) => mesh.setMatrixAt(n, matrix.makeTranslation(center.x, center.y, center.z)))
  }, [cubes])
  return (
    <PreviewInstances count={cubes.length} geometry={geometry} write={write}>
      <meshStandardMaterial color="#8aa4c8" roughness={0.7} />
    </PreviewInstances>
  )
}
