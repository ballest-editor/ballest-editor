/**
 * What the pieces-only method adds round its greedy fit. Before it, each separate part of the model that one primitive
 * looks like takes that primitive (meshParts.ts `wholePiece`) and leaves the rest to the fit. After it, the pieces are
 * polished against the model's pictures (piecePolish.ts), tied in mirror and turn images where the model is symmetric
 * and that looks no worse.
 */
import { lookOfPlacements, modelViews } from "../look/views"
import { componentsOf, primitiveParts, wholePiece } from "../parts/meshParts"
import { chosenSymmetries, symmetriesOf } from "../parts/symmetry"
import type { Placement } from "../shapes"
import { polishPieces, symmetricOrFree, symmetricStart } from "./piecePolish"

type Pieces = ReadonlyArray<Placement>

export interface WholeParts {
  /** One primitive for each part that is one. */
  readonly pieces: Pieces
  /** The triangles of every other part. */
  readonly rest: Float32Array
}

/** The model's separate parts that are each one primitive, and what is left; undefined for a model of one part. */
export const wholeParts = (triangles: Float32Array): WholeParts | undefined => {
  const parts = componentsOf(triangles)
  return parts.length < 2 ? undefined : primitiveParts(parts, wholePiece)
}

/** The shares of a fit's pieces the polish may start from, fewest first. */
const RUN_SHARES = [8, 4, 2, 1]

/** The first of `runs`, which come shortest first, whose look by `lookOf` is within `within` of the best. */
const fewest = (runs: ReadonlyArray<Pieces>, lookOf: (run: Pieces) => number, within: number): Pieces => {
  const looks = runs.map(lookOf)
  const best = Math.max(...looks)
  return runs.find((_, i) => (looks[i] ?? 0) >= best - within) ?? []
}

export interface Finished {
  readonly placements: Pieces
  /** Whether the pieces were tied to the model's symmetries. */
  readonly symmetric: boolean
}

/**
 * A fit's first pieces, polished against the model's pictures for about `seconds`. `refined(count)` is the first
 * `count` of the fit's `most`, refined.
 *
 * The polish starts from the fewest pieces that look about as good as any (`within`, in image score), of `most` and
 * its halves down to an eighth: later pieces of a greedy fit fill the inside or pile onto what is already covered, so
 * the whole run often looks no better than its first quarter, and what is left out is so many pieces the polish
 * needn't find and drop.
 *
 * With `symmetry`, and where the model has one, half the time polishes the pieces free and half tied in matching
 * images, each from the run that looks best for it (the tied one as its symmetric start), and the tied result is kept
 * unless it looks worse.
 */
export const finished = (
  triangles: Float32Array,
  most: number,
  refined: (count: number) => Pieces,
  seconds: number,
  symmetry: boolean,
  within: number
): Finished => {
  if (seconds <= 0) return { placements: refined(most), symmetric: false }
  const views = modelViews(triangles)
  const counts = [...new Set(RUN_SHARES.map((share) => Math.ceil(most / share)))]
  const runs = counts.map(refined)
  const start = fewest(runs, (run) => lookOfPlacements(views, run).score, within)
  if (start.length === 0) return { placements: start, symmetric: false }
  const symmetries = symmetry ? chosenSymmetries(symmetriesOf(triangles)) : []
  if (symmetries.length === 0) return { placements: polishPieces(views, start, seconds).placements, symmetric: false }
  const tiedLook = (run: Pieces) => lookOfPlacements(views, symmetricStart(views, run, symmetries).placements).score
  const tiedStart = fewest(runs, tiedLook, within)
  const free = polishPieces(views, start, seconds / 2)
  const tied = polishPieces(views, tiedStart, seconds / 2, symmetries)
  return symmetricOrFree(views, free.placements, tied.placements)
}
