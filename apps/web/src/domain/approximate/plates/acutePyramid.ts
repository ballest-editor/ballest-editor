/**
 * A flat triangle as one side of a pyramid. The catalog's pyramid stands on a diamond whose corners sit on its own X
 * and Y axes, so the side between +X, +Y and the apex is a triangle, and its three corners can be any acute triangle:
 * the squares of the pyramid's two base half-widths and of its height are what the law of cosines gives for the
 * triangle's corners, which are all positive only when every corner is under 90°. A triangle with a right or wide
 * corner is covered by two acute ones instead (`overlappingAcute`).
 */
import type { Vec3 } from "../../coords"
import { quatFromFrame, vecAdd, vecCross, vecDot, vecLength, vecNormalize, vecScale, vecSub } from "../../ueMath"
import type { Placement } from "../shapes"

type Triangle = readonly [Vec3, Vec3, Vec3]

/** A corner counts as acute when its share of the longest side's square is above this. */
const ACUTE_LEAST = 1e-8

/**
 * The pyramid whose +X, +Y, apex side is the triangle `a`, `b`, `c`, with the rest of it behind the triangle as
 * `normal` sees it; undefined unless the triangle is acute. `a` lands on the pyramid's +X corner.
 */
export const acutePyramid = (a: Vec3, b: Vec3, c: Vec3, normal: Vec3): Placement | undefined => {
  // The corners go round `normal` anticlockwise: swapping two keeps the fit a turn, where a mirror image would
  // need a mirrored piece.
  const [p, q] = vecDot(vecCross(vecSub(b, a), vecSub(c, a)), normal) < 0 ? [c, b] : [b, c]
  const ap = vecSub(p, a), aq = vecSub(q, a), pq = vecSub(q, p)
  const ap2 = vecDot(ap, ap), aq2 = vecDot(aq, aq), pq2 = vecDot(pq, pq)
  // Each is two sides' lengths times the cosine of the corner between them: at `a`, at `p` and at `q`.
  const atA = (ap2 + aq2 - pq2) / 2, atP = (ap2 + pq2 - aq2) / 2, atQ = (aq2 + pq2 - ap2) / 2
  if (Math.min(atA, atP, atQ) <= ACUTE_LEAST * Math.max(ap2, aq2, pq2)) return undefined
  const hx = Math.sqrt(atA), hy = Math.sqrt(atP), height = Math.sqrt(atQ)

  // The side's frame in the pyramid's own axes: along its base edge, out of its face, and square to both.
  const ownU = vecNormalize({ x: -hx, y: hy, z: 0 })
  const ownN = vecNormalize({ x: hy * height, y: hx * height, z: hx * hy })
  const ownV = vecCross(ownN, ownU)
  // The same frame on the triangle: the pyramid's own axes are what carries the one onto the other.
  const u = vecScale(ap, 1 / vecLength(ap)), n = vecNormalize(normal), v = vecCross(n, u)
  const axis = (x: number, y: number, z: number) =>
    vecAdd(
      vecAdd(
        vecScale(u, x * ownU.x + y * ownU.y + z * ownU.z),
        vecScale(v, x * ownV.x + y * ownV.y + z * ownV.z)
      ),
      vecScale(n, x * ownN.x + y * ownN.y + z * ownN.z)
    )
  const x = axis(1, 0, 0), z = axis(0, 0, 1)
  return {
    kind: "pyramid",
    center: vecAdd(vecSub(a, vecScale(x, hx)), vecScale(z, height / 2)),
    half: { x: hx, y: hy, z: height / 2 },
    rotation: quatFromFrame(x, z)
  }
}

/** The cosine of the corner at `p` between `q` and `r`. */
export const cornerCosine = (p: Vec3, q: Vec3, r: Vec3) => {
  const u = vecSub(q, p), v = vecSub(r, p)
  return vecDot(u, v) / Math.max(1e-12, vecLength(u) * vecLength(v))
}

/** The cosine of a triangle's widest corner: the higher it is, the further every corner is from 90°. */
const widestCosine = ([u, v, w]: Triangle) =>
  Math.min(cornerCosine(u, v, w), cornerCosine(v, w, u), cornerCosine(w, u, v))

/** Where `value` is highest between `low` and `high`, by ternary search: `value` rises to one peak and falls. */
const peakBetween = (low: number, high: number, value: (s: number) => number): number => {
  for (let i = 0; i < 40; i++) {
    const l = (2 * low + high) / 3, h = (low + 2 * high) / 3
    if (value(l) < value(h)) low = l
    else high = h
  }
  return (low + high) / 2
}

/**
 * Two acute triangles inside a triangle that isn't acute, which cover it between them: each keeps the widest corner
 * and one of the others, and its third corner is on the far side of the widest corner's altitude, so the two overlap
 * about the altitude. Undefined for a triangle with no area.
 */
export const overlappingAcute = (a: Vec3, b: Vec3, c: Vec3): readonly [Triangle, Triangle] | undefined => {
  const corners = [a, b, c] as const
  const cosines = [cornerCosine(a, b, c), cornerCosine(b, c, a), cornerCosine(c, a, b)]
  const widest = cosines.indexOf(Math.min(...cosines))
  const p = corners[widest] ?? a, q = corners[(widest + 1) % 3] ?? b, r = corners[(widest + 2) % 3] ?? c
  const qr = vecSub(r, q), length = vecLength(qr)
  if (length < 1e-6) return undefined
  // The altitude from the widest corner meets the far side `d` along it from `q`.
  const direction = vecScale(qr, 1 / length), d = vecDot(vecSub(p, q), direction)
  const foot = vecAdd(q, vecScale(direction, d)), height = vecLength(vecSub(p, foot))
  if (height < 1e-6 || d <= 0 || d >= length) return undefined
  /** The triangle on `base`'s side whose widest corner is least, its third corner up to `reach` past the foot. */
  const half = (base: Vec3, sign: number, reach: number): Triangle => {
    const faceAt = (s: number): Triangle => [p, base, vecAdd(foot, vecScale(direction, sign * s))]
    return faceAt(peakBetween(reach * 1e-6, reach * (1 - 1e-6), (s) => widestCosine(faceAt(s))))
  }
  // Past the foot by more than height² over the base's distance, the corner at `p` is no longer acute.
  return [
    half(q, 1, Math.min(length - d, height * height / d)),
    half(r, -1, Math.min(d, height * height / (length - d)))
  ]
}
