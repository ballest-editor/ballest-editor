import type { VoxelGrid } from "../domain/approximate/grid/voxelize"

type Corner = readonly [number, number, number]

const QUADS = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] as const

/**
 * A closed box from `min` to `max` along the axes, wound outward, as a flat triangle list: two triangles a side, the
 * sides in the order -Z, +Z, -Y, +Y, -X, +X.
 */
export const boxTriangles = (min: Corner, max: Corner): Float32Array => {
  const corner = (i: number): Corner => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]
  return new Float32Array(QUADS.flatMap(([a, b, c, d]) => [a, b, c, a, c, d].flatMap((i) => [...corner(i)])))
}

/** A grid of `n` cells of `voxel` cm from the origin, solid where `solid` says. */
export const gridWhere = (
  n: readonly [number, number, number],
  voxel: number,
  solid: (x: number, y: number, z: number) => boolean
): VoxelGrid => {
  const cells = new Uint8Array(n[0] * n[1] * n[2])
  for (let z = 0; z < n[2]; z++) {
    for (let y = 0; y < n[1]; y++) {
      for (let x = 0; x < n[0]; x++) if (solid(x, y, z)) cells[x + n[0] * (y + n[1] * z)] = 1
    }
  }
  return { n, origin: { x: 0, y: 0, z: 0 }, voxel, cells }
}

/** How many of `marks` are 1. */
export const countOf = (marks: Uint8Array): number => marks.reduce((sum, mark) => sum + mark, 0)
