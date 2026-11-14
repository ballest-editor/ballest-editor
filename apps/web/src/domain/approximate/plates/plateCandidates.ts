/** The complete meshes one source gives within a piece budget. */
import type { VoxelGrid } from "../grid/voxelize"
import { faceCount } from "../mesh/mesh"
import type { PlateSource } from "../mesh/remesh"
import type { Placement } from "../shapes"
import { fitPlates } from "./plateFit"
import type { FitOptions, FittedPlates } from "./plateTypes"

/** Shows a candidate in the preview. */
export type Show = (placements: ReadonlyArray<Placement>) => void

export interface CandidateSearch {
  /** Called with every fit that is within the budget. */
  readonly show?: Show | undefined
  /** The face count tried first: half the budget when absent. */
  readonly start?: number
  /**
   * Whether `start` is a count known to be about right. It then lands within 1% of the budget in one or two
   * corrections, so three are made and no neighbouring counts tried; the full search took up to 15 s more on the
   * slotted disk's symmetric mesh at 300 pieces.
   */
  readonly near?: boolean
}

/** Face counts tried on the way to the budget, and with `near`. */
const CORRECTIONS = 9
const CORRECTIONS_NEAR = 3

/** Face counts tried beside the finest that fits: a few faces more or less can look better within the same budget. */
const NEIGHBOURS = [-2, 2, 4]

/** The candidates returned, finest first. */
const KEPT = 3

/** The fits of one source at the face counts tried, each count fitted once. */
class Fits {
  private readonly tried = new Map<number, FittedPlates>()
  /** The most faces worth trying. Faces under a cover take no pieces, so a covered model can take a much finer mesh. */
  readonly ceiling: number

  private readonly grid: VoxelGrid
  private readonly options: FitOptions
  private readonly source: PlateSource
  private readonly budget: number
  private readonly show: Show | undefined

  constructor(grid: VoxelGrid, options: FitOptions, source: PlateSource, budget: number, show: Show | undefined) {
    this.grid = grid
    this.options = options
    this.source = source
    this.budget = budget
    this.show = show
    this.ceiling = Math.min(20000, Math.max(32, budget * (options.covers === undefined ? 3 : 12)))
  }

  /** The face count `faces` is tried as. */
  target(faces: number): number {
    return Math.max(4, Math.min(this.ceiling, Math.round(faces)))
  }

  has(target: number): boolean {
    return this.tried.has(target)
  }

  at(faces: number): FittedPlates {
    const target = this.target(faces)
    const kept = this.tried.get(target)
    if (kept !== undefined) return kept
    const result = fitPlates(this.grid, { ...this.options, faces: target }, this.source)
    this.tried.set(target, result)
    if (result.placements.length <= this.budget) this.show?.(result.placements)
    return result
  }

  /** The fits within the budget: most faces first, then most pieces. */
  within(): Array<FittedPlates> {
    return [...this.tried.values()].filter((result) => result.placements.length <= this.budget)
      .sort((a, b) => b.faces - a.faces || b.placements.length - a.placements.length)
  }
}

/**
 * Fits at face counts that close in on the budget from `start`. A fit's piece count is about proportional to its face
 * count, so each count is the last scaled by how far it missed, kept between the finest that fitted and the coarsest
 * that didn't: that avoids scanning dozens of coarse fits. It stops within 1% of the budget, or at the source's own
 * mesh.
 */
const approach = (fits: Fits, source: PlateSource, budget: number, start: number, steps: number): void => {
  let low = 4, high = fits.ceiling, target = fits.target(start)
  for (let step = 0; step < steps && high - low > 1; step++) {
    const result = fits.at(target), count = result.placements.length
    if (count <= budget) low = Math.max(low, target)
    else high = Math.min(high, target)
    if (count <= budget && (count >= budget * 0.99 || result.faces === faceCount(source.mesh))) break
    const correction = Math.max(low + 1, Math.min(high - 1, Math.round(target * budget / Math.max(1, count))))
    target = fits.has(correction) ? Math.round((low + high) / 2) : correction
  }
}

/**
 * The finest meshes of `source` that take at most `budget` pieces, at most three, finest first. None when even four
 * faces take more.
 */
export const candidatesOf = (
  grid: VoxelGrid,
  options: FitOptions,
  source: PlateSource,
  budget: number,
  { near = false, show, start = budget / 2 }: CandidateSearch = {}
): ReadonlyArray<FittedPlates> => {
  const fits = new Fits(grid, options, source, budget, show)
  approach(fits, source, budget, start, near ? CORRECTIONS_NEAR : CORRECTIONS)
  const best = fits.within()[0]
  if (best === undefined) fits.at(4)
  else if (!near) { for (const offset of NEIGHBOURS) fits.at(best.faces + offset) }
  return fits.within().slice(0, KEPT)
}
