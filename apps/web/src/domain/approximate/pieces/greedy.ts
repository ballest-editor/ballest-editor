/**
 * The greedy fit of whole pieces: residual fitting, the loop the research settled on (Marching-Primitives, Light-SQ,
 * and Fogleman's `primitive` moved into 3D), then refinement sweeps over what it placed.
 *
 * Every cell has a worth (`cellWorth`): 1 for a cell of the model, nothing for an empty cell within `tolerance` cells
 * of the model's surface, and past that a cost that grows with the distance, `outsidePenalty` per cell. A piece scores
 * the worth of the cells it covers that no other piece does, since a map draws the union of its items. With `noSpill`
 * an empty cell costs so much that no piece keeps one, and a climbed piece that still covers one shrinks until it
 * doesn't: the error is then one-sided, as the voxel methods' is.
 *
 * `greedyOrder` places one piece a round:
 * 1. It samples cells of the model no piece covers yet, and keeps the ones deepest inside the model as seeds.
 * 2. At each seed it starts every enabled shape in a few orientations, sized to the model's depth there.
 * 3. It climbs the best few: move a face, move the whole shape, turn it, scale it, keeping a change only where it
 *    scores better. No side of a piece goes below `minSize` cells.
 * 4. It places the winner. When nothing at the seeds scores a cell it sets them aside; it stops after eight such
 *    rounds in a row, or when the budget is spent.
 *
 * The order doesn't depend on the budget, so a smaller budget's pieces are the first ones of a larger budget's.
 * `polish` then works on the first N: it drops the pieces worth less than a cell, and each sweep climbs every piece
 * again against the rest, deletes a piece where its neighbours, climbed again, make up for it, and swaps a piece's
 * shape where another shape scores better in its place.
 */
import type { Quat4 } from "../../coords"
import { quatFromAxisAngle, quatMul, quatNormalize } from "../../ueMath"
import { depthInside, depthOutside } from "../grid/distance"
import { boundingCells, forEachCellIn, type GridShape, reachOf } from "../grid/raster"
import { at, AXES, type Axis, cellCount, type VoxelGrid } from "../grid/voxelize"
import type { PieceSettings } from "../settings"
import { IDENTITY_QUAT, type ShapeKind } from "../shapes"

/** What the fit reads of the piece settings: all but what the polish and its start read. */
export type FitOptions = Omit<PieceSettings, "sweeps" | "fewer">

type OnProgress = (shapes: ReadonlyArray<GridShape>) => void

export interface GreedyOptions extends FitOptions {
  readonly budget: number
  /** Called now and then with the pieces so far, for a live preview. */
  readonly onProgress?: OnProgress
}

export interface PolishOptions extends FitOptions {
  /** Refinement sweeps after the prune: 0 for none. */
  readonly sweeps: number
  /** Called after each sweep with the pieces it left. */
  readonly onProgress?: OnProgress
}

export interface Scored {
  readonly shape: GridShape
  readonly value: number
}

/** A seeded random source (mulberry32), so a run repeats. */
const randomSource = (seed: number) => {
  let state = seed >>> 0
  /** Even over [0, 1). */
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** Normal about 0 with a deviation of 1 (Box-Muller). */
  const gauss = () => {
    const u = Math.max(next(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
  return { next, gauss }
}
type Random = ReturnType<typeof randomSource>

const randomAxis = (random: Random) => {
  const x = random.gauss(), y = random.gauss(), z = random.gauss()
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

/** What an empty cell costs with `noSpill`: more than any piece could make up for. */
const SPILL_COST = 1e6

/** What covering each cell is worth (see the module comment). */
const cellWorth = (target: VoxelGrid, options: FitOptions): Float32Array => {
  const outside = depthOutside(target)
  const emptyCost = (i: number) =>
    options.noSpill ? SPILL_COST : options.outsidePenalty * Math.max(0, at(outside, i) - options.tolerance)
  return Float32Array.from(target.cells, (cell, i) => cell === 1 ? 1 : -emptyCost(i))
}

const X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }

/** The turn that stands a shape on its head. */
const FLIP = quatFromAxisAngle(X, Math.PI)

/** Turns that lay a shape's own Z along the grid's Z, Y and X. */
const LAID_ALONG: ReadonlyArray<Quat4> = [
  IDENTITY_QUAT,
  quatFromAxisAngle(X, Math.PI / 2),
  quatFromAxisAngle(Y, Math.PI / 2)
]

/** Turns that point a shape's own Z each way along the grid's Z, Y and X. */
const POINTED_ALONG: ReadonlyArray<Quat4> = [
  IDENTITY_QUAT,
  FLIP,
  quatFromAxisAngle(X, Math.PI / 2),
  quatFromAxisAngle(X, -Math.PI / 2),
  quatFromAxisAngle(Y, Math.PI / 2),
  quatFromAxisAngle(Y, -Math.PI / 2)
]

/** Whether a shape's two ends differ, so that standing it on its head makes another shape. */
const isPointed = (kind: ShapeKind) => kind === "cone" || kind === "pyramid" || kind === "hemisphere"

/** The orientations a shape starts in: one where every axis is alike, three where its ends are, six if pointed. */
const startTurns = (kind: ShapeKind): ReadonlyArray<Quat4> =>
  kind === "box" || kind === "sphere" ? [IDENTITY_QUAT] : isPointed(kind) ? POINTED_ALONG : LAID_ALONG

type Triple = readonly [number, number, number]

/** The half extents a shape starts with at a seed `depth` cells inside the model. */
const startHalf = (kind: ShapeKind, depth: number, minHalf: number): Triple => {
  const r = Math.max(minHalf, depth)
  const scaled = (k: number) => Math.max(minHalf, r * k)
  switch (kind) {
    case "box":
      return [scaled(0.8), scaled(0.8), scaled(0.8)]
    case "sphere":
      return [r, r, r]
    case "cylinder":
      return [r, r, scaled(0.8)]
    case "cone":
    case "pyramid":
      return [scaled(1.4), scaled(1.4), scaled(1.2)]
    // A dome as tall as it is wide, its middle at the seed.
    case "hemisphere":
      return [r, r, scaled(0.5)]
    // As round as the seed is deep and three times as long, so it starts a rod.
    case "capsule":
      return [r, r, scaled(1.6)]
  }
}

/** The shape's own axis `j` in grid coordinates. */
const ownAxis = (q: Quat4, j: Axis): Triple => {
  const { w, x, y, z } = q
  if (j === 0) return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)]
  if (j === 1) return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]
}

/** How small and large a half extent may be, in cells. */
interface Limits {
  readonly minHalf: number
  readonly maxHalf: number
}

const clampHalf = (value: number, limits: Limits) => Math.min(limits.maxHalf, Math.max(limits.minHalf, value))

/** Every half extent of `shape` times `by`, within the limits. */
const scaledBy = (shape: GridShape, by: number, limits: Limits): GridShape => ({
  ...shape,
  h: [clampHalf(shape.h[0] * by, limits), clampHalf(shape.h[1] * by, limits), clampHalf(shape.h[2] * by, limits)]
})

/** `shape` with one face moved a random way: the far side stays put. */
const faceMoved = (shape: GridShape, random: Random, limits: Limits): GridShape => {
  const j = AXES[Math.floor(random.next() * 3)] ?? 0
  const side = random.next() < 0.5 ? -1 : 1
  const delta = random.gauss() * Math.max(0.5, shape.h[j] * 0.3)
  const h: [number, number, number] = [shape.h[0], shape.h[1], shape.h[2]]
  h[j] = clampHalf(shape.h[j] + delta / 2, limits)
  const moved = h[j] - shape.h[j]
  const axis = ownAxis(shape.q, j)
  return {
    ...shape,
    h,
    c: [shape.c[0] + axis[0] * moved * side, shape.c[1] + axis[1] * moved * side, shape.c[2] + axis[2] * moved * side]
  }
}

/** `shape` moved a random way, by about a quarter of its size. */
const shifted = (shape: GridShape, random: Random): GridShape => {
  const step = Math.max(0.5, (shape.h[0] + shape.h[1] + shape.h[2]) / 3 * 0.25)
  const x = random.gauss() * step, y = random.gauss() * step, z = random.gauss() * step
  return { ...shape, c: [shape.c[0] + x, shape.c[1] + y, shape.c[2] + z] }
}

/** `shape` turned about a random axis by an angle of about `spread` radians. */
const turned = (q: Quat4, random: Random, spread: number): Quat4 => {
  const axis = randomAxis(random)
  return quatNormalize(quatMul(q, quatFromAxisAngle(axis, random.gauss() * spread)))
}

/** One random change to `shape`: a face moved, the whole moved, turned (where `rotation` allows) or scaled. */
const mutate = (shape: GridShape, random: Random, rotation: boolean, limits: Limits): GridShape => {
  const pick = random.next()
  if (pick < 0.45) return faceMoved(shape, random, limits)
  if (pick < 0.65) return shifted(shape, random)
  if (pick < 0.85 && rotation) return { ...shape, q: turned(shape.q, random, 0.25) }
  return scaledBy(shape, Math.exp(random.gauss() * 0.15), limits)
}

/**
 * Climbs from `start` with the fit's own moves (a face, the whole shape, a turn, a scale), keeping a change only
 * where `value` rises. For fitting one shape to a small target by any measure the caller likes.
 */
export const climbShape = (
  start: GridShape,
  value: (shape: GridShape) => number,
  options: Limits & { readonly steps: number; readonly seed: number }
): Scored => {
  const random = randomSource(options.seed)
  let shape = start, best = value(start)
  for (let step = 0; step < options.steps; step++) {
    const next = mutate(shape, random, true, options)
    const nextValue = value(next)
    if (nextValue > best) {
      shape = next
      best = nextValue
    }
  }
  return { shape, value: best }
}

/** Cells a quick score samples, about. */
const QUICK_SAMPLES = 6000

/** A climb's most steps, and the steps in a row with no gain it gives up after: for a new piece, and for one placed. */
const FIRST_CLIMB = { steps: 400, patience: 60 } as const
const AGAIN_CLIMB = { steps: 150, patience: 30 } as const

/** The shapes the fit may place: a cube when the settings name none. */
const kindsOf = (options: FitOptions): ReadonlyArray<ShapeKind> => options.kinds.length > 0 ? options.kinds : ["box"]

/** What a fit works on: the target, each cell's worth, and how many placed pieces cover each cell. */
class Fit {
  readonly target: VoxelGrid
  readonly options: FitOptions
  readonly worth: Float32Array
  readonly cover: Uint16Array
  readonly random: Random
  readonly limits: Limits

  constructor(target: VoxelGrid, options: FitOptions) {
    this.target = target
    this.options = options
    this.worth = cellWorth(target, options)
    this.cover = new Uint16Array(cellCount(target))
    this.random = randomSource(options.seed)
    this.limits = { minHalf: Math.max(0.5, options.minSize / 2), maxHalf: Math.max(...target.n) }
  }

  /**
   * What `shape`, not placed, adds over the placed pieces. `quick` estimates it from every few cells along each axis.
   */
  score(shape: GridShape, quick: boolean): number {
    const stride = quick ? Math.max(1, Math.round(Math.cbrt(boundingCells(shape) / QUICK_SAMPLES))) : 1
    const { cover, worth } = this
    let total = 0
    forEachCellIn(this.target, shape, (i) => {
      if (at(cover, i) === 0) total += at(worth, i)
    }, stride)
    return total * stride ** 3
  }

  /** What `shape`, placed, covers that no other piece does. */
  own(shape: GridShape): number {
    const { cover, worth } = this
    let total = 0
    forEachCellIn(this.target, shape, (i) => {
      if (at(cover, i) === 1) total += at(worth, i)
    })
    return total
  }

  add(shape: GridShape): void {
    const { cover } = this
    forEachCellIn(this.target, shape, (i) => {
      cover[i] = at(cover, i) + 1
    })
  }

  remove(shape: GridShape): void {
    const { cover } = this
    forEachCellIn(this.target, shape, (i) => {
      cover[i] = at(cover, i) - 1
    })
  }

  /** `start`, not placed, climbed by quick scores, and what the result scores in full. */
  climb(start: GridShape, { patience, steps }: { readonly steps: number; readonly patience: number }): Scored {
    let shape = start, value = this.score(shape, true)
    for (let step = 0, failures = 0; step < steps && failures < patience; step++) {
      const next = mutate(shape, this.random, this.options.rotation, this.limits)
      const nextValue = this.score(next, true)
      if (nextValue > value) {
        shape = next
        value = nextValue
        failures = 0
      } else {
        failures++
      }
    }
    if (this.options.noSpill) shape = this.shrunkInside(shape)
    return { shape, value: this.score(shape, false) }
  }

  /** `shape`, shrunk about its centre until it covers no empty cell, or forty times over. */
  private shrunkInside(shape: GridShape): GridShape {
    for (let tries = 0; tries < 40 && this.spills(shape); tries++) shape = scaledBy(shape, 0.92, this.limits)
    return shape
  }

  private spills(shape: GridShape): boolean {
    const { cells } = this.target
    let spills = false
    forEachCellIn(this.target, shape, (i) => {
      if (at(cells, i) === 0) spills = true
    })
    return spills
  }

  /**
   * `shape`, placed, climbed again against everything else and placed where that ends, or back where it was when
   * that scores no better; and how much it scores over what it did.
   */
  reclimb(shape: GridShape): { readonly shape: GridShape; readonly gained: number } {
    this.remove(shape)
    const before = this.score(shape, false)
    const climbed = this.climb(shape, AGAIN_CLIMB)
    const kept = climbed.value > before ? climbed : { shape, value: before }
    this.add(kept.shape)
    return { shape: kept.shape, gained: kept.value - before }
  }
}

/**
 * Keeps the entries of `list` that pass `test`, in order, in place. Not `push(...kept)`: spreading a list of a fine
 * grid's cells into one call overflows the stack.
 */
const keepWhere = <A>(list: Array<A>, test: (entry: A) => boolean): void => {
  let kept = 0
  for (const entry of list) if (test(entry)) list[kept++] = entry
  list.length = kept
}

/** Seed cells are picked from at most this many samples of the uncovered cells. */
const SEED_SAMPLES = 48

/** New pieces start at this many of the deepest samples, and at one more whatever its depth. */
const DEEPEST_SEEDS = 3

/** Starts climbed each round: the best by quick score. */
const CLIMBED_STARTS = 4

/** Rounds in a row that place nothing before the loop stops. */
const FAILED_ROUNDS = 8

/** Milliseconds between progress reports. */
const REPORT_EVERY = 200

/** The cells of the model no piece covers yet, kept as a list that sheds covered cells as samples land on them. */
class Residual {
  private readonly cells: Array<number> = []
  private readonly fit: Fit
  private readonly depth: Float32Array

  constructor(fit: Fit) {
    this.fit = fit
    this.depth = depthInside(fit.target)
    const { cells } = fit.target
    for (let i = 0; i < cells.length; i++) if (at(cells, i) === 1) this.cells.push(i)
  }

  depthAt(cell: number): number {
    return at(this.depth, cell)
  }

  /** Uncovered cells picked at random, with repeats: fewer than `SEED_SAMPLES` when few are left to find. */
  private samples(): Array<number> {
    const { cells } = this, { cover, random } = this.fit
    const picked: Array<number> = []
    for (let tries = 0; picked.length < SEED_SAMPLES && cells.length > 0; tries++) {
      // Mostly covered: drop every stale entry at once rather than one a try.
      if (tries === 200) keepWhere(cells, (cell) => at(cover, cell) === 0)
      if (tries > 400) break
      const slot = Math.floor(random.next() * cells.length)
      const cell = cells[slot] ?? 0
      if (at(cover, cell) > 0) {
        cells[slot] = cells[cells.length - 1] ?? 0
        cells.pop()
        continue
      }
      picked.push(cell)
    }
    return picked
  }

  /** The cells a round starts pieces at: the deepest samples, and the last one so small leftovers get a turn too. */
  seeds(): ReadonlyArray<number> {
    const picked = this.samples()
    const deepest = [...picked].sort((a, b) => this.depthAt(b) - this.depthAt(a)).slice(0, DEEPEST_SEEDS)
    const last = picked[picked.length - 1]
    return picked.length > DEEPEST_SEEDS && last !== undefined ? [...deepest, last] : deepest
  }

  /** Sets `seeds` aside: nothing fits there. */
  giveUp(seeds: ReadonlyArray<number>): void {
    const hard = new Set(seeds)
    keepWhere(this.cells, (cell) => !hard.has(cell))
  }
}

/** The middle of `cell`, in cells. */
const cellCentre = (target: VoxelGrid, cell: number): Triple => {
  const [nx, ny] = target.n
  return [(cell % nx) + 0.5, (Math.floor(cell / nx) % ny) + 0.5, Math.floor(cell / (nx * ny)) + 0.5]
}

/** Every shape the fit may place, at `cell` and `depth` deep, in each of its start orientations, with a quick score. */
const startsAt = (fit: Fit, cell: number, depth: number): Array<Scored> => {
  const { limits, options, random } = fit
  const c = cellCentre(fit.target, cell)
  const starts: Array<Scored> = []
  for (const kind of kindsOf(options)) {
    const h = startHalf(kind, depth, limits.minHalf)
    for (const q of startTurns(kind)) {
      // With rotation, each orientation also starts turned a random way.
      const turns = options.rotation ? [quatNormalize(q), turned(q, random, 0.5)] : [quatNormalize(q)]
      for (const turn of turns) {
        const shape: GridShape = { kind, c, h, q: turn }
        starts.push({ shape, value: fit.score(shape, true) })
      }
    }
  }
  return starts
}

/** The best piece to place next from `seeds`; undefined when none there scores a cell. */
const bestAt = (fit: Fit, residual: Residual, seeds: ReadonlyArray<number>): GridShape | undefined => {
  const starts = seeds.flatMap((seed) => startsAt(fit, seed, residual.depthAt(seed)))
  starts.sort((a, b) => b.value - a.value)
  let best: Scored | undefined
  for (const start of starts.slice(0, CLIMBED_STARTS)) {
    const climbed = fit.climb(start.shape, FIRST_CLIMB)
    if (best === undefined || climbed.value > best.value) best = climbed
  }
  return best === undefined || best.value < 1 ? undefined : best.shape
}

/** The pieces in the order the greedy loop places them, before any prune, up to `options.budget`. */
export const greedyOrder = (target: VoxelGrid, options: GreedyOptions): ReadonlyArray<GridShape> => {
  const fit = new Fit(target, options)
  const residual = new Residual(fit)
  const placed: Array<GridShape> = []
  let lastReport = Date.now()
  let failedRounds = 0
  while (placed.length < options.budget && failedRounds < FAILED_ROUNDS) {
    const seeds = residual.seeds()
    if (seeds.length === 0) break
    const best = bestAt(fit, residual, seeds)
    if (best === undefined) {
      failedRounds++
      residual.giveUp(seeds)
      continue
    }
    failedRounds = 0
    fit.add(best)
    placed.push(best)
    if (options.onProgress !== undefined && Date.now() - lastReport > REPORT_EVERY) {
      lastReport = Date.now()
      options.onProgress(placed)
    }
  }
  return placed
}

/** Whether the grid boxes round `a` and `b` touch. */
const near = (a: GridShape, b: GridShape): boolean => {
  const ra = reachOf(a), rb = reachOf(b)
  return AXES.every((axis) => Math.abs(a.c[axis] - b.c[axis]) <= ra[axis] + rb[axis] + 1)
}

const centreDistance = (a: GridShape, b: GridShape) => Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2])

/** A piece is deleted when its neighbours, climbed again, make up for all but this many of its own cells. */
const PIECE_WORTH = 2

/** The neighbours climbed again to make up for a deleted piece: the nearest. */
const NEIGHBOURS = 6

/** Climbs every piece again against the others, in place. */
const climbAll = (fit: Fit, pieces: Array<GridShape>): void => {
  pieces.forEach((piece, i) => {
    pieces[i] = fit.reclimb(piece).shape
  })
}

/**
 * Takes piece `i` away if its nearest neighbours, climbed again without it, make up for it; otherwise puts it and
 * them back as they were. `gone` holds the pieces taken away before, which stay out of it.
 */
const deleted = (fit: Fit, pieces: Array<GridShape>, i: number, gone: ReadonlySet<number>): boolean => {
  const piece = pieces[i]
  if (piece === undefined) return false
  const own = fit.own(piece)
  fit.remove(piece)
  const neighbours = pieces
    .map((shape, j) => ({ shape, j }))
    .filter(({ j, shape }) => j !== i && !gone.has(j) && near(piece, shape))
    .sort((a, b) => centreDistance(piece, a.shape) - centreDistance(piece, b.shape))
    .slice(0, NEIGHBOURS)
  let regained = 0
  for (const { j, shape } of neighbours) {
    const climbed = fit.reclimb(shape)
    regained += climbed.gained
    pieces[j] = climbed.shape
  }
  if (regained - own > -PIECE_WORTH) return true
  for (const { j, shape } of neighbours) {
    const climbed = pieces[j]
    if (climbed !== undefined) fit.remove(climbed)
    fit.add(shape)
    pieces[j] = shape
  }
  fit.add(piece)
  return false
}

/** Deletes the pieces the others can make up for, in place: the less useful half are tried, the least useful first. */
const deleteRedundant = (fit: Fit, pieces: Array<GridShape>): void => {
  const leastFirst = pieces.map((shape, i) => ({ i, own: fit.own(shape) })).sort((a, b) => a.own - b.own)
  const gone = new Set<number>()
  for (const { i } of leastFirst.slice(0, Math.ceil(pieces.length / 2))) {
    if (deleted(fit, pieces, i, gone)) gone.add(i)
  }
  pieces.splice(0, pieces.length, ...pieces.filter((_, i) => !gone.has(i)))
}

/** `piece`, placed, as the shape that scores best in its place, climbed from where it is; and that one placed. */
const bestKind = (fit: Fit, piece: GridShape, kinds: ReadonlyArray<ShapeKind>): GridShape => {
  fit.remove(piece)
  let best: Scored = { shape: piece, value: fit.score(piece, false) }
  for (const kind of kinds) {
    if (kind === piece.kind) continue
    // A pointed shape may fit either way up.
    const turns = isPointed(kind) ? [piece.q, quatNormalize(quatMul(piece.q, FLIP))] : [piece.q]
    for (const q of turns) {
      const tried = fit.climb({ ...piece, kind, q }, AGAIN_CLIMB)
      if (tried.value > best.value) best = tried
    }
  }
  fit.add(best.shape)
  return best.shape
}

/** One refinement sweep over `pieces`, in place (see the module comment). */
const sweep = (fit: Fit, pieces: Array<GridShape>): void => {
  climbAll(fit, pieces)
  deleteRedundant(fit, pieces)
  const kinds = kindsOf(fit.options)
  pieces.forEach((piece, i) => {
    pieces[i] = bestKind(fit, piece, kinds)
  })
}

/** The first pieces of a greedy order, pruned and refined. */
export const polish = (
  target: VoxelGrid,
  order: ReadonlyArray<GridShape>,
  options: PolishOptions
): Array<GridShape> => {
  const fit = new Fit(target, options)
  for (const shape of order) fit.add(shape)
  // Prune: a piece whose own cells, the ones nothing else covers, are worth less than a cell goes.
  const pieces = order.filter((shape) => {
    if (fit.own(shape) >= 1) return true
    fit.remove(shape)
    return false
  })
  for (let n = 0; n < options.sweeps; n++) {
    sweep(fit, pieces)
    options.onProgress?.(pieces)
  }
  return pieces
}
