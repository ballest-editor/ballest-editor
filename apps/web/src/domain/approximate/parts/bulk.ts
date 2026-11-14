/**
 * Bulk primitives for plates: catalog shapes that stand in for a whole stretch of the model's surface, so the faces
 * they hide cost no pieces. A sphere scales to any ellipsoid, a cylinder to any elliptic cylinder, and so on
 * (shapes.ts), and one of them is worth taking where the model's surface runs along its own for a long way: a duck's
 * head and body, a leg, a tail.
 *
 * Candidates start from the deepest places inside the solid and from its thin parts, as the box, ellipsoid, cylinder,
 * capsule, cone and half sphere (the last two either way up) with the same spread as the cells around them. A hill
 * climb then moves, turns and stretches each one to explain the most surface. A sample of the model's surface is
 * explained when it lies no more than `tolerance` under the piece's surface and `proud` over it, so the piece sits
 * just over what it replaces and hides the mesh's faces there; every point of the piece's surface further than
 * `tolerance` outside the model counts against it. A greedy cover keeps the candidates that each explain enough
 * surface nothing before them did.
 */
import type { Vec3 } from "../../coords"
import { quatFromAxisAngle, quatMul, quatNormalize, rotateVec, vecAdd, vecScale } from "../../ueMath"
import { depthInside } from "../grid/distance"
import { rotationMatrix } from "../grid/raster"
import type { PlateSolid } from "../grid/solid"
import { at, type VoxelGrid } from "../grid/voxelize"
import { type Placement, type ShapeKind, SHAPES } from "../shapes"
import { momentsOf, primitiveOf, type ThinPart } from "./thinParts"

// --- points inside a piece ----------------------------------------------------------------------------------------

/** A piece's world-to-own-box transform, for many point tests. */
interface Frame {
  readonly kind: ShapeKind
  readonly centre: Vec3
  readonly turn: ReturnType<typeof rotationMatrix>
  readonly half: Vec3
}

/** The frame of `piece` grown by `grow` cm along each of its own axes. */
const frameOf = (piece: Placement, grow: number): Frame => ({
  kind: piece.kind,
  centre: piece.center,
  turn: rotationMatrix(piece.rotation),
  half: { x: piece.half.x + grow, y: piece.half.y + grow, z: piece.half.z + grow }
})

const holds = ({ centre, half, kind, turn }: Frame, p: Vec3): boolean => {
  if (half.x <= 0 || half.y <= 0 || half.z <= 0) return false
  const dx = p.x - centre.x, dy = p.y - centre.y, dz = p.z - centre.z
  // `p` in the piece's own box, each axis from -1 to 1 across it.
  const x = (turn[0] * dx + turn[3] * dy + turn[6] * dz) / half.x
  const y = (turn[1] * dx + turn[4] * dy + turn[7] * dz) / half.y
  const z = (turn[2] * dx + turn[5] * dy + turn[8] * dz) / half.z
  if (x < -1 || x > 1 || y < -1 || y > 1 || z < -1 || z > 1) return false
  return SHAPES[kind].inside(x, y, z)
}

/** Whether points are inside any of `pieces`, each grown by `grow` cm along its own axes. */
export const holder = (pieces: ReadonlyArray<Placement>, grow = 0): (p: Vec3) => boolean => {
  const frames = pieces.map((piece) => frameOf(piece, grow))
  return (p) => frames.some((frame) => holds(frame, p))
}

// --- points of a unit shape ---------------------------------------------------------------------------------------

type UnitPoint = readonly [number, number, number]

/** `n` points round the circle of `radius` at height `z`. */
const ring = (n: number, z: number, radius: number): Array<UnitPoint> =>
  Array.from({ length: n }, (_, k) => {
    const angle = 2 * Math.PI * (k + 0.5) / n
    return [radius * Math.cos(angle), radius * Math.sin(angle), z]
  })

const LEVELS = [-0.8, -0.4, 0, 0.4, 0.8]

/** Points spread over each unit shape's surface, in its own box. */
const SURFACE_POINTS: Readonly<Record<ShapeKind, ReadonlyArray<UnitPoint>>> = (() => {
  const box = LEVELS.flatMap((u) =>
    LEVELS.flatMap((v) => [-1, 1].flatMap((s): Array<UnitPoint> => [[s, u, v], [u, s, v], [u, v, s]]))
  )
  const sphere = Array.from({ length: 150 }, (_, k): UnitPoint => {
    const z = 1 - 2 * (k + 0.5) / 150, radius = Math.sqrt(1 - z * z), angle = k * Math.PI * (3 - Math.sqrt(5))
    return [radius * Math.cos(angle), radius * Math.sin(angle), z]
  })
  const top = [...ring(6, 1, 0.45), ...ring(12, 1, 0.85)]
  const base = top.map(([x, y]): UnitPoint => [x, y, -1])
  const cylinder = [...LEVELS.flatMap((z) => ring(18, z, 1)), ...top, ...base]
  const cone = [...[-0.9, -0.6, -0.2, 0.2, 0.6].flatMap((z) => ring(z < 0 ? 18 : 10, z, (1 - z) / 2)), ...base]
  // The sphere's upper half squashed onto each shape's dome: z from 0 to 1 on the sphere is 0 to 1 of the dome's height.
  const dome = sphere.filter(([, , z]) => z >= 0)
  const hemisphere = [...dome.map(([x, y, z]): UnitPoint => [x, y, 2 * z - 1]), ...base]
  const capsule = [
    ...[-0.4, 0, 0.4].flatMap((z) => ring(18, z, 1)),
    ...dome.map(([x, y, z]): UnitPoint => [x, y, 0.5 + z / 2]),
    ...dome.map(([x, y, z]): UnitPoint => [x, y, -0.5 - z / 2])
  ]
  return { box, sphere, cylinder, cone, pyramid: cone, hemisphere, capsule }
})()

/** Points spread through each unit shape's inside, in its own box. */
const INSIDE_POINTS: Readonly<Record<ShapeKind, ReadonlyArray<UnitPoint>>> = (() => {
  const steps = [-0.75, -0.25, 0.25, 0.75]
  const lattice = steps.flatMap((x) => steps.flatMap((y) => steps.map((z): UnitPoint => [x, y, z])))
  const within = (kind: ShapeKind) => lattice.filter(([x, y, z]) => SHAPES[kind].inside(x, y, z))
  const cone = within("cone")
  return {
    box: within("box"),
    sphere: within("sphere"),
    cylinder: within("cylinder"),
    cone,
    pyramid: cone,
    hemisphere: within("hemisphere"),
    capsule: within("capsule")
  }
})()

// --- what a piece is worth ----------------------------------------------------------------------------------------

export interface BulkPiece {
  readonly piece: Placement
  /** The share of the model's surface samples only this piece explains, in the order the cover took them. */
  readonly share: number
  /** The share of the piece's own surface outside the model. */
  readonly spill: number
  /** The surface samples it explains, x, y, z each: where it shows. */
  readonly points: Float64Array
}

interface BulkOptions {
  /** How far, in cm, the model's surface may lie under a piece's for the piece to stand in for it there. */
  readonly tolerance: number
  /** How far, in cm, it may stand proud of the piece's. */
  readonly proud: number
  /** The least share of the surface a piece must newly explain to be kept. */
  readonly minShare: number
  /** The most pieces kept. */
  readonly most: number
}

/** A point of the piece's surface outside the model weighs this many explained samples' worth of surface. */
const SPILL_WEIGHT = 3
/** The most of a piece's surface that may lie outside the model. */
const SPILL_MOST = 0.06

/** The model's surface area, in cm², off its surface cells: each shows about one cell face. */
const surfaceArea = ({ cells, n: [nx, ny, nz], voxel }: VoxelGrid): number => {
  let faces = 0
  for (let i = 0; i < cells.length; i++) {
    if (at(cells, i) === 0) continue
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny))
    if (x === 0 || at(cells, i - 1) === 0) faces++
    if (x === nx - 1 || at(cells, i + 1) === 0) faces++
    if (y === 0 || at(cells, i - nx) === 0) faces++
    if (y === ny - 1 || at(cells, i + nx) === 0) faces++
    if (z === 0 || at(cells, i - nx * ny) === 0) faces++
    if (z === nz - 1 || at(cells, i + nx * ny) === 0) faces++
  }
  return faces * voxel * voxel
}

/** How a candidate piece is judged against the model. */
interface Judge {
  /** The indices of the surface samples the piece explains, ascending. */
  readonly explainedBy: (piece: Placement) => Array<number>
  /** The share of the piece outside the model. */
  readonly spillOf: (piece: Placement) => number
  /** What the climb raises: the share of the samples explained, less the spill weighed by the piece's size. */
  readonly worth: (piece: Placement) => number
}

const judgeOf = (solid: PlateSolid, points: ReadonlyArray<Vec3>, { proud, tolerance }: BulkOptions): Judge => {
  const area = surfaceArea(solid.grid)
  const explainedBy = (piece: Placement): Array<number> => {
    const outer = frameOf(piece, proud), inner = frameOf(piece, -tolerance)
    const out: Array<number> = []
    points.forEach((p, k) => {
      if (holds(outer, p) && !holds(inner, p)) out.push(k)
    })
    return out
  }
  /** The share of `unit`'s points, placed as `piece`, further than `slack` outside the model. */
  const outsideShare = ({ center, half, rotation }: Placement, unit: ReadonlyArray<UnitPoint>, slack: number) => {
    let out = 0
    for (const [x, y, z] of unit) {
      const p = vecAdd(center, rotateVec(rotation, { x: x * half.x, y: y * half.y, z: z * half.z }))
      if (solid.outside(p) > slack) out++
    }
    return out / Math.max(1, unit.length)
  }
  // A piece's surface may sit a little over the model's; its inside may not bridge a gap, however narrow.
  const spillOf = (piece: Placement): number =>
    Math.max(
      outsideShare(piece, SURFACE_POINTS[piece.kind], tolerance),
      outsideShare(piece, INSIDE_POINTS[piece.kind], 0)
    )
  /** The piece's surface area, about, as a share of the model's. */
  const sizeOf = ({ half: h }: Placement) => Math.min(4, 5 * (h.x * h.y + h.y * h.z + h.x * h.z) / Math.max(1, area))
  const worth = (piece: Placement) =>
    explainedBy(piece).length / Math.max(1, points.length) - SPILL_WEIGHT * spillOf(piece) * sizeOf(piece)
  return { explainedBy, spillOf, worth }
}

// --- the climb ----------------------------------------------------------------------------------------------------

const CLIMB_STEPS = 260

/** A tiny deterministic generator (xorshift), so a fit is the same every run. */
const randomOf = (seed: number): () => number => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

const AXIS_KEYS = ["x", "y", "z"] as const
type AxisKey = typeof AXIS_KEYS[number]
/** The unit vector along each of a piece's own axes. */
const unitAxis = (axis: AxisKey): Vec3 => ({
  x: Number(axis === "x"),
  y: Number(axis === "y"),
  z: Number(axis === "z")
})

/** What a nudge draws from and is bound by. */
interface Climb {
  readonly random: () => number
  readonly voxel: number
  /** The least and most a half size may be, in cm. */
  readonly least: number
  readonly most: number
}

const randomAxis = ({ random }: Climb) => AXIS_KEYS[Math.floor(random() * 3)] ?? "x"

/** Up to two cells either way, less as the climb cools. */
const randomShift = ({ random, voxel }: Climb, heat: number) => (random() - 0.5) * 2 * heat * voxel * 2

const clamped = ({ least, most }: Climb, half: number) => Math.min(most, Math.max(least, half))

const slid = (piece: Placement, climb: Climb, heat: number): Placement => {
  const by = randomShift(climb, heat)
  const along = rotateVec(piece.rotation, unitAxis(randomAxis(climb)))
  return { ...piece, center: vecAdd(piece.center, vecScale(along, by)) }
}

/** One side moves and the other stays: the piece grows or shrinks along one of its own axes. */
const stretched = (piece: Placement, climb: Climb, heat: number): Placement => {
  const axis = randomAxis(climb)
  const by = randomShift(climb, heat)
  const half = clamped(climb, piece.half[axis] + by / 2)
  const moved = (half - piece.half[axis]) * (climb.random() < 0.5 ? 1 : -1)
  const along = rotateVec(piece.rotation, unitAxis(axis))
  return { ...piece, half: { ...piece.half, [axis]: half }, center: vecAdd(piece.center, vecScale(along, moved)) }
}

const scaled = (piece: Placement, climb: Climb, heat: number): Placement => {
  const by = 1 + (climb.random() - 0.5) * 0.3 * heat
  const { x, y, z } = piece.half
  return { ...piece, half: { x: clamped(climb, x * by), y: clamped(climb, y * by), z: clamped(climb, z * by) } }
}

const turned = (piece: Placement, climb: Climb, heat: number): Placement => {
  const axis = unitAxis(randomAxis(climb))
  const turn = quatFromAxisAngle(axis, (climb.random() - 0.5) * 0.5 * heat)
  return { ...piece, rotation: quatNormalize(quatMul(piece.rotation, turn)) }
}

/** `start` after `CLIMB_STEPS` random nudges, smaller as it goes, each kept when the piece is then worth more. */
const climbed = (start: Placement, worth: Judge["worth"], climb: Climb): Placement => {
  let best = start, score = worth(start)
  for (let step = 0; step < CLIMB_STEPS; step++) {
    const heat = 1 - 0.8 * step / CLIMB_STEPS
    const pick = climb.random()
    const nudge = pick < 0.3 ? slid : pick < 0.65 ? stretched : pick < 0.8 ? scaled : turned
    const next = nudge(best, climb, heat)
    const value = worth(next)
    if (value > score) {
      best = next
      score = value
    }
  }
  return best
}

// --- where candidates start ---------------------------------------------------------------------------------------

const MOST_SEEDS = 14
/** A seed's cells reach this many of its depths out, once near and once far. */
const SEED_REACHES = [1.6, 3]

/** The solid cells within `r` cells of the cell at (x, y, z). */
const cellsNear = ({ cells, n: [nx, ny, nz] }: VoxelGrid, x: number, y: number, z: number, r: number) => {
  const near: Array<number> = []
  for (let dz = -r; dz <= r; dz++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy, zz = z + dz
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue
        if (dx * dx + dy * dy + dz * dz > r * r) continue
        const j = xx + nx * (yy + ny * zz)
        if (at(cells, j) === 1) near.push(j)
      }
    }
  }
  return near
}

/**
 * The cells each candidate starts from, whose spread is its first guess: round the deepest cells, each keeping the
 * next ones out of its own ball, and then the thin parts.
 */
const seedCells = (grid: VoxelGrid, parts: ReadonlyArray<ThinPart>): Array<ReadonlyArray<number>> => {
  const [nx, ny] = grid.n
  const depth = depthInside(grid)
  const deepestFirst: Array<number> = []
  for (let i = 0; i < depth.length; i++) if (at(depth, i) >= 1.5) deepestFirst.push(i)
  deepestFirst.sort((a, b) => at(depth, b) - at(depth, a))
  const seeds: Array<ReadonlyArray<number>> = []
  const taken: Array<{ readonly x: number; readonly y: number; readonly z: number; readonly radius: number }> = []
  for (const i of deepestFirst) {
    if (taken.length >= MOST_SEEDS) break
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny)), radius = at(depth, i)
    if (taken.some((t) => Math.hypot(x - t.x, y - t.y, z - t.z) < 1.6 * t.radius + 0.6 * radius)) continue
    taken.push({ x, y, z, radius })
    for (const reach of SEED_REACHES) seeds.push(cellsNear(grid, x, y, z, Math.ceil(radius * reach)))
  }
  for (const part of parts) seeds.push(Array.from(part.cells))
  return seeds
}

/** The shapes tried on every seed. A cone and a half sphere are tried pointing either way along the cells' long axis. */
const KINDS: ReadonlyArray<{ readonly kind: ShapeKind; readonly reversed: boolean }> = [
  { kind: "sphere", reversed: false },
  { kind: "box", reversed: false },
  { kind: "cylinder", reversed: false },
  { kind: "cone", reversed: false },
  { kind: "cone", reversed: true },
  { kind: "capsule", reversed: false },
  { kind: "hemisphere", reversed: false },
  { kind: "hemisphere", reversed: true }
]

interface Candidate {
  readonly piece: Placement
  readonly explained: ReadonlyArray<number>
  readonly spill: number
}

/** Every shape climbed from every seed, those that spill too far left out. */
const candidatesOf = (grid: VoxelGrid, seeds: ReadonlyArray<ReadonlyArray<number>>, judge: Judge): Array<Candidate> => {
  const least = grid.voxel * 0.75, most = grid.voxel * Math.max(...grid.n)
  const pool: Array<Candidate> = []
  seeds.forEach((cells, s) => {
    if (cells.length < 4) return
    const moments = momentsOf(grid, cells)
    KINDS.forEach(({ kind, reversed }, k) => {
      const climb: Climb = { random: randomOf(1 + s * 16 + k), voxel: grid.voxel, least, most }
      const piece = climbed(primitiveOf(kind, moments, reversed), judge.worth, climb)
      const spill = judge.spillOf(piece)
      if (spill <= SPILL_MOST) pool.push({ piece, explained: judge.explainedBy(piece), spill })
    })
  })
  return pool
}

// --- the cover ----------------------------------------------------------------------------------------------------

/**
 * The candidates kept, most surface first: each time the first one that explains the most samples nothing kept
 * explains yet, until that is under `minShare` of the samples or `most` are kept.
 */
const cover = (pool: ReadonlyArray<Candidate>, points: ReadonlyArray<Vec3>, options: BulkOptions): Array<BulkPiece> => {
  const done = new Uint8Array(points.length)
  const out: Array<BulkPiece> = []
  while (out.length < options.most) {
    let best: Candidate | undefined, gain = 0
    for (const candidate of pool) {
      let fresh = 0
      for (const k of candidate.explained) if (at(done, k) === 0) fresh++
      if (fresh > gain) {
        best = candidate
        gain = fresh
      }
    }
    const share = gain / Math.max(1, points.length)
    if (best === undefined || share < options.minShare) break
    for (const k of best.explained) done[k] = 1
    const shown = new Float64Array(best.explained.length * 3)
    best.explained.forEach((k, n) => {
      const p = points[k]
      if (p !== undefined) shown.set([p.x, p.y, p.z], 3 * n)
    })
    out.push({ piece: best.piece, share, spill: best.spill, points: shown })
  }
  return out
}

/** The primitives worth taking for `solid`, most surface first; `samples` are spread evenly over the model's surface. */
export const bulkPrimitives = (
  solid: PlateSolid,
  samples: ReadonlyArray<Vec3>,
  parts: ReadonlyArray<ThinPart>,
  options: BulkOptions
): ReadonlyArray<BulkPiece> => {
  // Half the samples are enough to steer by.
  const points = samples.filter((_, k) => k % 2 === 0)
  const judge = judgeOf(solid, points, options)
  return cover(candidatesOf(solid.grid, seedCells(solid.grid, parts), judge), points, options)
}
