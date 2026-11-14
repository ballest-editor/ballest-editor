/**
 * A closed surface shaped like a sphere, as a flat triangle list. `point(i, j)` is the corner on ring `i` (0 and
 * `rings` are the poles) at segment `j` around; each quad between two rings is split along the same diagonal, and a
 * quad at a pole, where two of its corners meet, gives one triangle.
 */
export const sphereTriangles = (
  rings: number,
  segments: number,
  point: (i: number, j: number) => ReadonlyArray<number>
): Float32Array => {
  const corners: Array<ReadonlyArray<number>> = []
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = point(i, j), b = point(i + 1, j), c = point(i + 1, j + 1), d = point(i, j + 1)
      if (i > 0) corners.push(a, b, d)
      if (i < rings - 1) corners.push(b, c, d)
    }
  }
  return new Float32Array(corners.flat())
}

/** A ball of `radius` cm about `centre`, as `sphereTriangles` of `rings` rings and `segments` segments. */
export const ballTriangles = (
  radius: number,
  [x, y, z]: readonly [number, number, number] = [0, 0, 0],
  rings = 10,
  segments = 14
): Float32Array =>
  sphereTriangles(rings, segments, (i, j) => {
    const theta = Math.PI * i / rings, phi = 2 * Math.PI * j / segments
    return [
      x + radius * Math.sin(theta) * Math.cos(phi),
      y + radius * Math.sin(theta) * Math.sin(phi),
      z + radius * Math.cos(theta)
    ]
  })
