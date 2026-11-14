/**
 * Approximating a model with catalog pieces: one entry point over the methods (settings.ts), so they can be compared
 * on the same input and judged by the same metrics (evaluate.ts). Every method works on a voxel grid of the model at
 * the chosen resolution; the metrics use a reference grid whose resolution doesn't move with it.
 *
 * Merged boxes rank their pieces, largest first; Pieces only keeps its greedy order and refines the first pieces
 * again. Both keep their orders between runs (`KeptOrder`), so moving the budget needn't start over. The plates
 * methods search complete meshes for each budget, and need `meshReady` (mesh.ts) awaited first.
 */
import { mergeBoxes, surfaceCubes } from "./grid/boxMerge"
import { type GridShape, toPlacement } from "./grid/raster"
import { type GridFrame, gridOver, trianglesBox, type VoxelGrid, voxelize } from "./grid/voxelize"
import { evaluate, type Metrics, type Reference } from "./look/evaluate"
import { greedyOrder, polish } from "./pieces/greedy"
import { finished, wholeParts } from "./pieces/pieces"
import { plates } from "./plates/plates"
import type { PlateOptions, Plates } from "./plates/plateTypes"
import { type ApproximateSettings, METHODS } from "./settings"
import type { Placement } from "./shapes"

type Placements = ReadonlyArray<Placement>

/**
 * A greedy order kept between runs: its pieces in the units of the grid they were fitted on (a round trip through cm
 * would nudge the refinement's choices), that grid, and whether the loop stopped before its budget ran out.
 */
interface GreedyRun {
  readonly shapes: ReadonlyArray<GridShape>
  readonly frame: GridFrame
  readonly complete: boolean
}

/** Whether `run` holds the greedy order for `budget` pieces: it reached them, or stopped short of any budget. */
const runCovers = (run: GreedyRun, budget: number): boolean => run.complete || run.shapes.length >= budget

/** A method's order, kept for the next budget: Pieces only's greedy run, or Merged boxes' whole result. */
export type KeptOrder =
  | { readonly kind: "greedy"; readonly run: GreedyRun }
  | { readonly kind: "ranked"; readonly placements: Placements }

/** Whether `kept` holds what `budget` pieces need without fitting again. */
export const keptCovers = (kept: KeptOrder, budget: number): boolean =>
  kept.kind === "ranked" || runCovers(kept.run, budget)

/** The first `budget` pieces of `kept`, in cm, before any refinement. */
export const keptPrefix = (kept: KeptOrder, budget: number): Placements =>
  kept.kind === "ranked"
    ? kept.placements.slice(0, budget)
    : kept.run.shapes.slice(0, budget).map((shape) => toPlacement(kept.run.frame, shape))

/** How many pieces the whole of `kept` holds. */
export const keptTotal = (kept: KeptOrder): number =>
  kept.kind === "ranked" ? kept.placements.length : kept.run.shapes.length

export type Phase = "fitting" | "refining"

type OnProgress = (placements: Placements, phase: Phase) => void

/** What a method made, before it is judged. */
export interface Made {
  readonly placements: Placements
  /** The method's own grid, for showing what it saw. */
  readonly grid: VoxelGrid
  readonly plates?: Omit<Plates, "placements">
  /** What to keep for the next budget. */
  readonly order?: KeptOrder
}

export interface Approximation extends Made {
  readonly metrics: Metrics
}

/**
 * What turns plates' other pieces off: no primitive for a part, a stretch of surface, a separate part or a
 * profile, and no cylinder in an extrusion.
 */
const PLATES_ALONE = { primitives: 0, parts: false, split: false, profiles: false, round: false } as const

/** What the plates fit is asked for by `settings`: everything for Pieces and plates, plates alone for Plates only. */
const plateOptionsOf = (settings: ApproximateSettings): PlateOptions => ({
  ...settings.plates,
  budget: settings.budget,
  searchSeconds: settings.searchSeconds,
  symmetry: settings.symmetry,
  split: !settings.without?.includes("split"),
  profiles: !settings.without?.includes("profiles"),
  ...(settings.method === "platesOnly" && PLATES_ALONE)
})

/**
 * Runs `settings.method` on the model, the first `budget` pieces of it where the method ranks or orders them.
 * `cached` is the order from an earlier run with the same `orderKeyOf` and model: when it covers the budget, it is
 * cut (and, for Pieces only, refined again) instead of starting over.
 */
export const make = (
  triangles: Float32Array,
  settings: ApproximateSettings,
  onProgress?: OnProgress,
  cached?: KeptOrder
): Made => {
  const { method } = settings
  // Pieces only gives the parts that are each one primitive that primitive, and fits a grid of the rest.
  const parted = method === "piecesOnly" && !settings.without?.includes("split") ? wholeParts(triangles) : undefined
  const grid = voxelize(parted?.rest ?? triangles, gridOver(trianglesBox(triangles), settings.resolution), {
    surface: settings.fillThin
  })
  if (method === "voxels") return { placements: surfaceCubes(grid), grid }
  if (METHODS[method].plates) {
    const fitting: (candidate: Placements) => void = (candidate) => onProgress?.(candidate, "fitting")
    const { placements, ...details } = plates(triangles, grid, plateOptionsOf(settings), fitting)
    return { placements, grid, plates: details }
  }
  if (method === "boxes") {
    const ranked = cached?.kind === "ranked" ? cached.placements : mergeBoxes(grid)
    return { placements: ranked.slice(0, settings.budget), grid, order: { kind: "ranked", placements: ranked } }
  }
  const whole = parted?.pieces ?? []
  const fit: PiecesFit = { triangles, grid, settings, whole, nothingLeft: parted?.rest.length === 0, onProgress }
  const run = greedyRun(fit, cached)
  return { placements: refinedPieces(fit, run), grid, order: { kind: "greedy", run } }
}

/** What Pieces only works on. */
interface PiecesFit {
  readonly triangles: Float32Array
  /** The grid of what the greedy fit has to cover: the model less its whole parts. */
  readonly grid: VoxelGrid
  readonly settings: ApproximateSettings
  /** The primitives of the parts that are each one primitive (pieces.ts `wholeParts`). */
  readonly whole: Placements
  /** Whether those parts were all of the model. */
  readonly nothingLeft: boolean
  readonly onProgress: OnProgress | undefined
}

/** Reports `whole` and the fit's pieces so far, in cm. */
const reportOf = ({ grid, onProgress, whole }: PiecesFit, phase: Phase) => (shapes: ReadonlyArray<GridShape>) =>
  onProgress?.([...whole, ...shapes.map((shape) => toPlacement(grid, shape))], phase)

/** The primitives of whole parts come out of the budget; the fit has the rest. */
const fitBudget = ({ settings, whole }: PiecesFit): number => Math.max(0, settings.budget - whole.length)

const frameOf = ({ n, origin, voxel }: VoxelGrid): GridFrame => ({ n, origin, voxel })

/** The greedy order for the fit's budget: `cached`'s when that covers it, or a new one. */
const greedyRun = (fit: PiecesFit, cached: KeptOrder | undefined): GreedyRun => {
  const budget = fitBudget(fit)
  if (cached?.kind === "greedy" && runCovers(cached.run, budget)) return cached.run
  const shapes = budget === 0 || fit.nothingLeft
    ? []
    : greedyOrder(fit.grid, { ...fit.settings.pieces, budget, onProgress: reportOf(fit, "fitting") })
  return { shapes, frame: frameOf(fit.grid), complete: shapes.length < budget }
}

/** `whole`, then the first pieces of `run` the budget has room for, refined and polished (pieces.ts). */
const refinedPieces = (fit: PiecesFit, run: GreedyRun): Placements => {
  const { grid, settings, triangles, whole } = fit
  const order = run.shapes.slice(0, fitBudget(fit))
  const refining = reportOf(fit, "refining")
  refining(order)
  const refined = (count: number): Placements => [
    ...whole.slice(0, settings.budget),
    ...polish(grid, order.slice(0, count), { ...settings.pieces, onProgress: refining })
      .map((shape) => toPlacement(grid, shape))
  ]
  const { fewer } = settings.pieces
  return finished(triangles, order.length, refined, settings.searchSeconds, settings.symmetry, fewer).placements
}

/** `make`, judged against `reference`. */
export const approximate = (
  triangles: Float32Array,
  settings: ApproximateSettings,
  reference: Reference,
  onProgress?: OnProgress,
  cached?: KeptOrder
): Approximation => {
  const made = make(triangles, settings, onProgress, cached)
  return { ...made, metrics: evaluate(reference, made.placements) }
}
