// The flat caps at a piece's open ends, read off its mesh (docs/qa/connectors.md § The survey). A cap is a flat face
// with a sharp rim that nothing of the mesh stands in front of: the cut end of a track, the ring at a tube's mouth.
// Everything in the piece's own frame, UE cm.
import type { Triangles, Vec } from "./glb.ts"
import { nth } from "./nth.ts"

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
export const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: Vec): Vec => scale(a, 1 / length(a))
/** `v` with its part along unit `axis` taken out, unit length. */
export const squareTo = (v: Vec, axis: Vec): Vec => normalize(sub(v, scale(axis, dot(v, axis))))
/** `v` turned by `angle` radians about unit `axis` (Rodrigues). */
export const rotateAbout = (v: Vec, axis: Vec, angle: number): Vec =>
  add(
    add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))),
    scale(axis, dot(axis, v) * (1 - Math.cos(angle)))
  )

/** Two corners closer than this are one: a corner is repeated once per normal and UV it needs. */
const WELD_CM = 0.01
/** Two triangles this close to one plane make one flat face. */
const FLAT_COS = Math.cos((0.5 * Math.PI) / 180)
const PLANE_CM = 0.05
/** A rim edge is sharp when the face beyond it turns away by more than this, as the Mesh target's edges are. */
const SHARP_COS = Math.cos((30 * Math.PI) / 180)
/** The share of a cap's rim that must be sharp: a facet of a curved surface has smooth neighbours on two sides. */
const SHARP_SHARE = 0.75
/** The smallest cap: the half tunnel's thin ring is 590 cm². */
const MIN_CAP_CM2 = 100
/** How far in front of a cap the mesh may reach and the cap still be open. */
const FRONT_CM = 0.5

interface Triangle {
  readonly corners: readonly [number, number, number]
  readonly normal: Vec
  readonly area: number
}

export interface Mesh {
  readonly points: ReadonlyArray<Vec>
  readonly triangles: ReadonlyArray<Triangle>
  /** The triangles on each welded edge, by `edgeKey`. */
  readonly edges: ReadonlyMap<string, ReadonlyArray<number>>
  /** The surface's area-weighted centre. */
  readonly centroid: Vec
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
const edgesOn = (mesh: Mesh, key: string): ReadonlyArray<number> => mesh.edges.get(key) ?? []
/** A triangle's three sides, as pairs of welded corners in its winding. */
const sidesOf = ([a, b, c]: readonly [number, number, number]) => [[a, b], [b, c], [c, a]] as const

/** Every triangle reached from `seeds` across sides `crosses` lets through, in the order reached. */
const flood = (mesh: Mesh, seeds: Iterable<number>, crosses: (from: number, to: number) => boolean) => {
  const reached = new Set(seeds)
  const list = [...reached]
  for (let q = 0; q < list.length; q++) {
    const from = nth(list, q)
    for (const [a, b] of sidesOf(nth(mesh.triangles, from).corners)) {
      for (const to of edgesOn(mesh, edgeKey(a, b))) {
        if (reached.has(to) || !crosses(from, to)) continue
        reached.add(to)
        list.push(to)
      }
    }
  }
  return list
}

export const meshOf = ({ indices, positions }: Triangles): Mesh => {
  const ids = new Map<string, number>()
  const points: Array<Vec> = []
  const welded = Array.from({ length: positions.length / 3 }, (_, i) => {
    const p: Vec = [nth(positions, i * 3), nth(positions, i * 3 + 1), nth(positions, i * 3 + 2)]
    const key = p.map((c) => Math.round(c / WELD_CM)).join(",")
    const known = ids.get(key)
    if (known !== undefined) return known
    ids.set(key, points.length)
    points.push(p)
    return points.length - 1
  })
  const triangles: Array<Triangle> = []
  let weighted: Vec = [0, 0, 0]
  let total = 0
  for (let i = 0; i < indices.length; i += 3) {
    const corners = [
      nth(welded, nth(indices, i)),
      nth(welded, nth(indices, i + 1)),
      nth(welded, nth(indices, i + 2))
    ] as const
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[0] === corners[2]) continue
    const [a, b, c] = [nth(points, corners[0]), nth(points, corners[1]), nth(points, corners[2])]
    const n = cross(sub(b, a), sub(c, a))
    const area = length(n) / 2
    if (area < 1e-6) continue
    triangles.push({ corners, normal: normalize(n), area })
    weighted = add(weighted, scale(add(add(a, b), c), area / 3))
    total += area
  }
  const edges = new Map<string, Array<number>>()
  triangles.forEach(({ corners }, t) => {
    for (const [a, b] of sidesOf(corners)) {
      const key = edgeKey(a, b)
      const list = edges.get(key)
      if (list === undefined) edges.set(key, [t])
      else list.push(t)
    }
  })
  return { points, triangles, edges, centroid: scale(weighted, 1 / total) }
}

/** A flat face: triangles joined edge to edge in one plane. */
export interface FlatFace {
  readonly triangles: ReadonlyArray<number>
  /** Out of the face, unit length. */
  readonly normal: Vec
  /** Its plane's distance from the origin along `normal`. */
  readonly offset: number
  readonly area: number
  /** Its rim, as closed loops of welded corners in the triangles' winding. */
  readonly loops: ReadonlyArray<ReadonlyArray<number>>
  /** The share of its rim whose neighbour beyond turns away sharply, or that has none. */
  readonly sharpShare: number
}

export const flatFacesOf = (mesh: Mesh): ReadonlyArray<FlatFace> => {
  const faceOf = new Int32Array(mesh.triangles.length).fill(-1)
  const faces: Array<FlatFace> = []
  for (let seed = 0; seed < mesh.triangles.length; seed++) {
    if (faceOf[seed] !== -1) continue
    const id = faces.length
    const { normal } = nth(mesh.triangles, seed)
    const offset = dot(normal, nth(mesh.points, nth(mesh.triangles, seed).corners[0]))
    const list = flood(mesh, [seed], (_, to) => {
      const t = nth(mesh.triangles, to)
      return faceOf[to] === -1 && dot(t.normal, normal) >= FLAT_COS &&
        Math.abs(dot(normal, nth(mesh.points, t.corners[0])) - offset) <= PLANE_CM
    })
    for (const t of list) faceOf[t] = id
    // The rim: the face's edges no other triangle of it shares, kept in winding order to chain them.
    const next = new Map<number, Array<number>>()
    let rim = 0
    let sharp = 0
    let area = 0
    let weightedNormal: Vec = [0, 0, 0]
    for (const t of list) {
      const triangle = nth(mesh.triangles, t)
      area += triangle.area
      weightedNormal = add(weightedNormal, scale(triangle.normal, triangle.area))
      for (const [a, b] of sidesOf(triangle.corners)) {
        const on = edgesOn(mesh, edgeKey(a, b))
        const beyond = on.filter((other) => faceOf[other] !== id)
        if (beyond.length === 0 && on.length > 1) continue
        rim++
        if (beyond.every((other) => dot(nth(mesh.triangles, other).normal, normal) < SHARP_COS)) sharp++
        const out = next.get(a)
        if (out === undefined) next.set(a, [b])
        else out.push(b)
      }
    }
    const loops: Array<Array<number>> = []
    for (const start of next.keys()) {
      while ((next.get(start)?.length ?? 0) > 0) {
        const loop = [start]
        let corner = next.get(start)?.pop()
        while (corner !== undefined && corner !== start) {
          loop.push(corner)
          corner = next.get(corner)?.pop()
        }
        loops.push(loop)
      }
    }
    const faceNormal = normalize(weightedNormal)
    faces.push({
      triangles: list,
      normal: faceNormal,
      offset: dot(faceNormal, nth(mesh.points, nth(mesh.triangles, seed).corners[0])),
      area,
      loops,
      sharpShare: rim === 0 ? 0 : sharp / rim
    })
  }
  return faces
}

/** A 2D point in a cap's plane: `r` along its right (up × forward), `u` along its up. */
interface Flat {
  readonly r: number
  readonly u: number
}

const polygonArea = (loop: ReadonlyArray<Flat>) =>
  loop.reduce((sum, p, i) => {
    const q = nth(loop, (i + 1) % loop.length)
    return sum + p.r * q.u - q.r * p.u
  }, 0) / 2

const inside = (loop: ReadonlyArray<Flat>, { r, u }: Flat) => {
  let crossings = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = nth(loop, i)
    const b = nth(loop, j)
    if (a.u > u !== b.u > u && r < ((b.r - a.r) * (u - a.u)) / (b.u - a.u) + a.r) crossings = !crossings
  }
  return crossings
}

export type CapShape =
  | { readonly shape: "rect" | "polygon"; readonly width: number; readonly height: number }
  | { readonly shape: "circle"; readonly radius: number }
  | { readonly shape: "annulus"; readonly radius: number; readonly innerRadius: number }

/** A cap measured in a frame: its forward and an up square to it. */
export interface CapMeasure {
  readonly forward: Vec
  readonly up: Vec
  readonly right: Vec
  readonly area: number
  /** Across `right` and along `up`, the cap's whole extent. */
  readonly width: number
  readonly height: number
  /** The width of its top: what's within 0.5 cm of its highest point. */
  readonly topWidth: number
  /** How far the top's middle sits right of the whole width's middle: a lopsided cap leans. */
  readonly lean: number
  /** The middle of its top edge, the middle of its width. */
  readonly topMiddle: Vec
  /** The middle of its extent across both directions. */
  readonly centre: Vec
  readonly shape: CapShape
  /** Its rim, in the piece's frame: the outer loop first. */
  readonly rim: ReadonlyArray<ReadonlyArray<Vec>>
}

/** Within this share, a loop's corners are all one distance from its centre: a circle drawn as a polygon. */
const ROUND_SHARE = 0.01
/** A cap whose area is within this share of its box is a rectangle: a tall bevel's chamfered top is 0.16% short. */
const RECT_SHARE = 0.00001

const roundAbout = (loop: ReadonlyArray<Flat>, centre: Flat): number | undefined => {
  if (loop.length < 12) return undefined
  const distances = loop.map((p) => Math.hypot(p.r - centre.r, p.u - centre.u))
  const max = Math.max(...distances)
  return max - Math.min(...distances) <= max * ROUND_SHARE ? max : undefined
}

const loopsIn = (mesh: Mesh, face: FlatFace, right: Vec, up: Vec) =>
  face.loops
    .map((loop) => loop.map((k) => ({ r: dot(nth(mesh.points, k), right), u: dot(nth(mesh.points, k), up) })))
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))

/** The cap `face` seen with `up` as its up. */
export const measureCap = (mesh: Mesh, face: FlatFace, up: Vec): CapMeasure => {
  const forward = face.normal
  const right = cross(up, forward)
  const [outer = [], ...holes] = loopsIn(mesh, face, right, up)
  const rs = outer.map((p) => p.r)
  const us = outer.map((p) => p.u)
  const [minR, maxR, minU, maxU] = [Math.min(...rs), Math.max(...rs), Math.min(...us), Math.max(...us)]
  const top = outer.filter((p) => p.u >= maxU - 0.5).map((p) => p.r)
  const middle = (minR + maxR) / 2
  const inSpace = ({ r, u }: Flat): Vec => add(add(scale(forward, face.offset), scale(right, r)), scale(up, u))
  const box: Flat = { r: middle, u: (minU + maxU) / 2 }
  const circle = (() => {
    const radius = roundAbout(outer, box)
    if (radius === undefined) return undefined
    if (holes.length === 0) return { shape: "circle", radius } as const
    const innerRadius = holes.length === 1 ? roundAbout(nth(holes, 0), box) : undefined
    return innerRadius === undefined ? undefined : { shape: "annulus", radius, innerRadius } as const
  })()
  const width = maxR - minR
  const height = maxU - minU
  const rectangular = holes.length === 0 && face.area >= width * height * (1 - RECT_SHARE) - 1
  return {
    forward,
    up,
    right,
    area: face.area,
    width,
    height,
    topWidth: Math.max(...top) - Math.min(...top),
    lean: (Math.max(...top) + Math.min(...top)) / 2 - middle,
    topMiddle: inSpace({ r: middle, u: maxU }),
    centre: inSpace(box),
    shape: circle ?? { shape: rectangular ? "rect" : "polygon", width, height },
    rim: face.loops.map((loop) => loop.map((k) => nth(mesh.points, k)))
  }
}

/** A straight run of a cap's rim this much shorter than the cap's extent doesn't set its sides. */
const SIDE_SHARE = 0.25
/** Two segments of a rim this close in direction are one straight run. */
const FLAT_ANGLE = (0.5 * Math.PI) / 180
/** How far the cap's sides may turn from the given up and still be taken as its own. */
const ROLL_LIMIT = (30 * Math.PI) / 180

/** The direction, in the plane, of the longest straight run of `loop`'s rim, and its length. */
const longestRun = (loop: ReadonlyArray<Flat>): { readonly angle: number; readonly length: number } => {
  const segments = loop.map((a, i) => {
    const b = nth(loop, (i + 1) % loop.length)
    return { angle: Math.atan2(b.u - a.u, b.r - a.r), length: Math.hypot(b.r - a.r, b.u - a.u) }
  })
  let best = { angle: 0, length: 0 }
  let run = { angle: 0, length: 0 }
  // Twice round, so a run that crosses where the loop starts is counted whole.
  for (const segment of [...segments, ...segments]) {
    const turn = Math.abs(Math.atan2(Math.sin(segment.angle - run.angle), Math.cos(segment.angle - run.angle)))
    run = run.length > 0 && turn < FLAT_ANGLE ? { angle: run.angle, length: run.length + segment.length } : segment
    if (run.length > best.length) best = run
  }
  return best
}

/**
 * The cap's own up nearest `up`: square to the longest straight run of its rim, so a cap rolled about its forward (a side
 * ramp's raised end) is measured square to itself. A cap with no long straight side, a tube's ring, keeps `up`, and so
 * does one within a hundredth of a degree of it.
 */
export const capUp = (mesh: Mesh, face: FlatFace, up: Vec, limit = ROLL_LIMIT): Vec => {
  const [outer = []] = loopsIn(mesh, face, cross(up, face.normal), up)
  const extent = Math.max(
    Math.max(...outer.map((p) => p.r)) - Math.min(...outer.map((p) => p.r)),
    Math.max(...outer.map((p) => p.u)) - Math.min(...outer.map((p) => p.u))
  )
  const side = longestRun(outer)
  if (side.length < extent * SIDE_SHARE) return up
  // The turn from `up` (a quarter turn from right, in the plane) to the nearest of the four directions square to or
  // along that side. A turn from right toward up is one about forward.
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
  const turn = [0, 1, 2, 3].map((k) => wrap(side.angle + ((k - 1) * Math.PI) / 2))
    .reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
  if (Math.abs(turn) < (0.01 * Math.PI) / 180 || Math.abs(turn) > limit) return up
  return squareTo(rotateAbout(up, face.normal, turn), face.normal)
}

/** Whether anything of the mesh stands more than `FRONT_CM` in front of `face`, over it. */
const coveredInFront = (mesh: Mesh, face: FlatFace): boolean => {
  const up = squareTo(Math.abs(face.normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], face.normal)
  const right = cross(up, face.normal)
  const [outer = []] = loopsIn(mesh, face, right, up)
  return mesh.points.some((p) =>
    dot(p, face.normal) > face.offset + FRONT_CM && inside(outer, { r: dot(p, right), u: dot(p, up) })
  )
}

/** The flat faces of `mesh` that are caps. */
export const capsOf = (mesh: Mesh): ReadonlyArray<FlatFace> =>
  flatFacesOf(mesh).filter((face) =>
    face.area >= MIN_CAP_CM2 && face.loops.length > 0 && face.sharpShare >= SHARP_SHARE &&
    !coveredInFront(mesh, face)
  )

/**
 * The triangles of the surface that leaves `face` across its rim near `edge`: everything reached from there across
 * edges that don't turn sharply. On a track it is the running surface from one end to the other.
 */
export const surfaceFrom = (mesh: Mesh, face: FlatFace, near: (p: Vec) => boolean, side: Vec): ReadonlySet<number> => {
  const own = new Set(face.triangles)
  const seeds = face.triangles.flatMap((t) =>
    sidesOf(nth(mesh.triangles, t).corners).flatMap(([a, b]) =>
      near(nth(mesh.points, a)) && near(nth(mesh.points, b))
        ? edgesOn(mesh, edgeKey(a, b)).filter((other) =>
          !own.has(other) && dot(nth(mesh.triangles, other).normal, side) > 0.5
        )
        : []
    )
  )
  return new Set(
    flood(
      mesh,
      seeds,
      (from, to) => !own.has(to) && dot(nth(mesh.triangles, to).normal, nth(mesh.triangles, from).normal) >= SHARP_COS
    )
  )
}

/** Whether any of `triangles` borders `face` on its rim near a point that `near` picks. */
export const touches = (mesh: Mesh, face: FlatFace, triangles: ReadonlySet<number>, near: (p: Vec) => boolean) =>
  face.triangles.some((t) =>
    sidesOf(nth(mesh.triangles, t).corners).some(([a, b]) =>
      near(nth(mesh.points, a)) && near(nth(mesh.points, b)) &&
      edgesOn(mesh, edgeKey(a, b)).some((other) => triangles.has(other))
    )
  )
