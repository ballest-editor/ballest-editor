/** Thin parts of the model (ears, a handle, a spout) as primitives inside a plates fit, each kept where it looks better. */
import { at, type VoxelGrid } from "../grid/voxelize"
import { drawnOver, type Look, lookOf, type ModelViews, type Picture, piecePictures, regionsOf } from "../look/views"
import { simplified, trianglesOfMesh, welded } from "../mesh/mesh"
import { PlateSource } from "../mesh/remesh"
import {
  eligible,
  FLAT_PART,
  partFlatness,
  type PartOption,
  partPrimitives,
  type ThinPart,
  thinParts,
  trimmedSurface
} from "../parts/thinParts"
import type { Placement } from "../shapes"
import { candidatesOf } from "./plateCandidates"
import { type FitOptions, type FittedPlates, type PartChoice, withPrimitives } from "./plateTypes"

/** How a set of pieces looks over every view. */
export type Judged = Look

/** A candidate and how it looks. */
export interface Scored {
  readonly result: FittedPlates
  readonly judged: Judged
}

/** What the stages of one model's fit share. */
export interface ModelFit {
  readonly triangles: Float32Array
  readonly source: PlateSource
  readonly budget: number
  readonly views: ModelViews
  /** How `placements` look, worked out once for each list. */
  readonly judge: (placements: ReadonlyArray<Placement>) => Judged
  /** Adds the time since the last stamp to `stage`'s seconds. */
  readonly stamp: (stage: string) => void
}

/** How much better a part's region must look with primitives than with the mesh for them to stay. */
const REGION_MARGIN = 0.02

/** How much better the whole model must score with the kept primitives. */
const WHOLE_MARGIN = 0.002

/** Most faces of the original the trimmed fit follows. */
const TRIMMED_FACES = 20000

/** The eligible candidates a part's region is drawn with. */
const PART_OPTIONS = 3

/** The smaller of two flat parts' cell counts over the larger, at least, for them to be a pair. */
const TWIN_SIZE = 0.75

/** How far round a part's cells its region of the views reaches, in cells. */
const REGION_CELLS = 2.5

/** `triangles`, simplified where they are more than `faces` faces. */
export const atMostFaces = (triangles: Float32Array, faces: number): Float32Array =>
  triangles.length / 9 <= faces ? triangles : trianglesOfMesh(simplified(welded(triangles), faces))

/** One thin part on trial: every candidate for it, those it is drawn with, and what is reported of it. */
interface Trial {
  readonly part: ThinPart
  /** `partFlatness`: under `FLAT_PART` the part is tried with flat pieces only. */
  readonly flatness: number
  /** The eligible candidates, best fit first, at most `PART_OPTIONS`. */
  readonly tried: ReadonlyArray<PartOption>
  choice: PartChoice
}

/** What is reported of `part` standing as `option`; `seen` is how its region and the whole model came to look. */
const choiceOf = (
  part: ThinPart,
  flatness: number,
  option: PartOption | undefined,
  seen: Partial<PartChoice> = {}
): PartChoice => ({
  cells: part.cells.length,
  flatness,
  label: option?.label ?? "none",
  pieces: option?.pieces.length ?? 0,
  coverage: option?.coverage ?? 0,
  spill: option?.spill ?? 0,
  eligible: option !== undefined && eligible(option),
  kept: false,
  ...seen
})

/** `part` with its candidates fitted. Until it is decided, it is reported with its best candidate, eligible or not. */
const trialOf = (filled: VoxelGrid, part: ThinPart, triangles: Float32Array): Trial => {
  const flatness = partFlatness(filled, part, triangles)
  const all = partPrimitives(filled, part, flatness < FLAT_PART)
  const tried = all.filter(eligible).slice(0, PART_OPTIONS)
  return { part, flatness, tried, choice: choiceOf(part, flatness, all[0]) }
}

/** The pieces a part's region is drawn with while the others are judged: its best candidate's. */
const firstPieces = ({ tried }: Trial): ReadonlyArray<Placement> => tried[0]?.pieces ?? []

/** The most pieces any of a part's candidates takes. */
const mostPieces = ({ tried }: Trial): number => Math.max(...tried.map((option) => option.pieces.length))

/** The model fitted with parts taken out of it: the mesh alone, the grid it was fitted on, and it with their pieces. */
interface Trimmed extends Scored {
  readonly mesh: FittedPlates
  readonly grid: VoxelGrid
}

/**
 * Fits the mesh to the model less some parts, closing over the cuts: `removed` are the parts, `pieces` what stands in
 * for them, and `room` the pieces of the budget kept for them. Gives the best-looking mesh with `pieces`, or undefined
 * when under five pieces are left for the mesh.
 */
const trimmer = (
  { budget, judge, source, triangles }: ModelFit,
  options: FitOptions,
  full: Scored
): (removed: ReadonlyArray<Trial>, pieces: ReadonlyArray<Placement>, room?: number) => Trimmed | undefined => {
  const filled = source.solid.grid
  // What the trimmed fit follows: the original, simplified where it is much finer than any fit needs.
  let followed: Float32Array | undefined
  return (removed, pieces, room = pieces.length) => {
    if (room >= budget - 4) return undefined
    const cut = new Uint8Array(filled.cells.length)
    for (const { part } of removed) for (const i of part.cells) cut[i] = 1
    const grid: VoxelGrid = { ...filled, cells: filled.cells.map((cell, i) => at(cut, i) === 1 ? 0 : cell) }
    followed ??= atMostFaces(triangles, TRIMMED_FACES)
    const trimmedSource = new PlateSource(triangles, grid, true, false, trimmedSurface(followed, grid, cut))
    // The mesh has about the full fit's faces a piece.
    const start = full.result.faces * (budget - room) / budget
    let best: Trimmed | undefined
    for (const mesh of candidatesOf(grid, options, trimmedSource, budget - room, { start })) {
      const result = withPrimitives(mesh, pieces, grid)
      const judged = judge(result.placements)
      if (best === undefined || judged.score > best.judged.score) best = { mesh, grid, result, judged }
    }
    return best
  }
}

/** The centres of `part`'s cells, x, y, z each. */
const cellCentres = (grid: VoxelGrid, part: ThinPart): Float64Array => {
  const points = new Float64Array(part.cells.length * 3)
  const [nx, ny] = grid.n
  part.cells.forEach((i, k) => {
    points[3 * k] = grid.origin.x + (i % nx + 0.5) * grid.voxel
    points[3 * k + 1] = grid.origin.y + (Math.floor(i / nx) % ny + 0.5) * grid.voxel
    points[3 * k + 2] = grid.origin.z + (Math.floor(i / (nx * ny)) + 0.5) * grid.voxel
  })
  return points
}

/** A candidate and how the part's region looks with it. */
interface Rated extends Look {
  readonly option: PartOption
}

/** A part judged on its own region of the views. */
interface Verdict {
  readonly trial: Trial
  /** The region with the full mesh. */
  readonly without: Look
  /** The region with each candidate over the trimmed mesh, best first. */
  readonly rated: ReadonlyArray<Rated>
  winner: Rated | undefined
}

/**
 * Each part's candidates on the part's own region of the views: drawn over the trimmed mesh and the other parts' best
 * candidates, against the full mesh there.
 */
const verdictsOf = (
  { source, views }: ModelFit,
  trials: ReadonlyArray<Trial>,
  trimmedMesh: ReadonlyArray<Placement>,
  fullMesh: ReadonlyArray<Placement>
): Array<Verdict> => {
  const filled = source.solid.grid
  const meshPictures = piecePictures(views.frame, trimmedMesh)
  const fullPictures = piecePictures(views.frame, fullMesh)
  return trials.map((trial) => {
    const regions = regionsOf(views.frame, cellCentres(filled, trial.part), REGION_CELLS * filled.voxel)
    const others: ReadonlyArray<Picture> = drawnOver(
      views.frame,
      meshPictures,
      trials.filter((other) => other !== trial).flatMap(firstPieces)
    )
    const without = lookOf(views, fullPictures, regions)
    const rated = trial.tried
      .map((option): Rated => ({ option, ...lookOf(views, drawnOver(views.frame, others, option.pieces), regions) }))
      .sort((a, b) => b.score - a.score)
    return { trial, without, rated, winner: rated[0] }
  })
}

/** The kinds of piece a candidate is made of, as one key. */
const kindOf = (option: PartOption): string => [...new Set(option.pieces.map(({ kind }) => kind))].sort().join()

/** The best candidate of `kind` for a part. */
const bestOfKind = ({ rated }: Verdict, kind: string): Rated | undefined =>
  rated.find(({ option }) => kindOf(option) === kind)

/** How much worse a part's region looks with its best candidate of `kind` than with its winner. */
const loss = (verdict: Verdict, kind: string): number =>
  (verdict.winner?.score ?? 0) - (bestOfKind(verdict, kind)?.score ?? -Infinity)

/** Whether two parts are flat and of about the same size: a pair of ears or fins. */
const twins = ({ trial: a }: Verdict, { trial: b }: Verdict): boolean =>
  a.flatness < FLAT_PART && b.flatness < FLAT_PART &&
  Math.min(a.part.cells.length, b.part.cells.length) >= TWIN_SIZE * Math.max(a.part.cells.length, b.part.cells.length)

/**
 * Gives twin parts the same kind of piece, one or a chain: a part takes its twin's kind unless that costs it more than
 * the margin, or more than its own kind would cost the twin.
 */
const matchTwins = (verdicts: ReadonlyArray<Verdict>): void => {
  for (const a of verdicts) {
    for (const b of verdicts) {
      if (a.winner === undefined || b.winner === undefined || !twins(a, b)) continue
      const kind = kindOf(b.winner.option), own = kindOf(a.winner.option)
      if (own === kind) continue
      if (loss(a, kind) <= Math.min(REGION_MARGIN, loss(b, own))) a.winner = bestOfKind(a, kind)
    }
  }
}

/** Records each part's verdict in its trial and gives the parts whose winner clearly looks better than the mesh. */
const keptOf = (verdicts: ReadonlyArray<Verdict>): Array<{ readonly trial: Trial; readonly option: PartOption }> => {
  const kept: Array<{ readonly trial: Trial; readonly option: PartOption }> = []
  for (const { trial, winner, without } of verdicts) {
    if (winner === undefined) continue
    const keep = winner.score >= without.score + REGION_MARGIN
    trial.choice = choiceOf(trial.part, trial.flatness, winner.option, {
      region: { silhouette: winner.silhouette, depth: winner.depth, normal: winner.normal, score: winner.score },
      regionWithout: without,
      kept: keep
    })
    if (keep) kept.push({ trial, option: winner.option })
  }
  return kept
}

/** The trimmed mesh with `pieces` standing in for the parts taken out. */
const scoredWith = (trimmed: Trimmed, pieces: ReadonlyArray<Placement>, judge: ModelFit["judge"]): Scored => {
  const result = withPrimitives(trimmed.mesh, pieces, trimmed.grid)
  return { result, judged: judge(result.placements) }
}

/** What became of the thin parts: each one's choice, and the fit with the kept ones as primitives where that wins. */
export interface PartsFit {
  readonly choices: ReadonlyArray<PartChoice>
  readonly combined?: Scored
}

/**
 * Thin parts as catalog primitives over `full`, the best mesh of the whole model; undefined when the model has none.
 * A part is tried only with candidates that cover it and don't spill out (`eligible`). The mesh is fitted once more
 * with every such part taken out of the model, at the budget less the most pieces the parts' candidates take, so
 * whichever wins fits. Each part is then decided on its own region of the views, and the kept parts' mesh (the trimmed
 * one, or one more fit when only some were kept) must beat `full` on the whole model by a clear margin too.
 */
export const partsOf = (fit: ModelFit, options: FitOptions, full: Scored): PartsFit | undefined => {
  const { judge, source, stamp, triangles } = fit
  const filled = source.solid.grid
  const { parts } = thinParts(filled)
  if (parts.length === 0) return undefined
  const trials = parts.map((part) => trialOf(filled, part, triangles))
  const choices = () => trials.map(({ choice }) => choice)
  stamp("partFits")
  const tried = trials.filter((trial) => trial.tried.length > 0)
  const reserved = tried.reduce((sum, trial) => sum + mostPieces(trial), 0)
  const trimmedFit = trimmer(fit, options, full)
  const trimmed = tried.length === 0 ? undefined : trimmedFit(tried, tried.flatMap(firstPieces), reserved)
  stamp("partsTrimmed")
  if (trimmed === undefined) return { choices: choices() }
  const verdicts = verdictsOf(fit, tried, trimmed.mesh.placements, full.result.placements)
  matchTwins(verdicts)
  const kept = keptOf(verdicts)
  stamp("partsDecided")
  if (kept.length === 0) return { choices: choices() }
  const pieces = kept.flatMap(({ option }) => option.pieces)
  const combined = kept.length === tried.length && pieces.length <= reserved ?
    scoredWith(trimmed, pieces, judge) :
    trimmedFit(kept.map(({ trial }) => trial), pieces)
  const wins = combined !== undefined && combined.judged.score >= full.judged.score + WHOLE_MARGIN
  for (const { trial } of kept) {
    trial.choice = {
      ...trial.choice,
      kept: wins,
      ...(combined === undefined ? {} : { whole: combined.judged, wholeWithout: full.judged })
    }
  }
  return wins ? { choices: choices(), combined: { result: combined.result, judged: combined.judged } } : {
    choices: choices()
  }
}
