/**
 * How close an approximation is, the same way for every method: its pieces are drawn into the model's reference grid,
 * a finer one than most fits use and the same whatever the method's own resolution, and the cells compared.
 *
 * Both are compared as seen from outside: a hollow no ray from outside can reach counts as solid, so a shell of
 * pieces scores the same as the solid it looks like, and a model's sealed hollows count against nobody.
 *
 * Volume alone rewards filling the inside, so the surfaces are compared too: from each cell of the model's surface,
 * how far the pieces' surface is (where the pieces miss a detail), and from each cell of the pieces' surface, how far
 * the model's is (where they bulge), each as a mean and a 95th percentile, in cm.
 *
 * Neither says whether the result looks like the model, so the pictures are compared too (views.ts).
 */
import { distanceTo, surfaceCells } from "../grid/distance"
import { forEachCellIn, toGridShape } from "../grid/raster"
import { fillSealed } from "../grid/solid"
import { at, cellCount, gridOver, trianglesBox, type VoxelGrid, voxelize } from "../grid/voxelize"
import type { Placement, ShapeKind } from "../shapes"
import { compareViews, type ModelViews, modelViews } from "./views"

/** The reference grid's resolution: fine enough to tell methods apart, coarse enough to draw thousands of items into. */
const REFERENCE_RESOLUTION = 96

/** What every approximation of one model is judged against: its reference grid and its pictures. */
export interface Reference {
  readonly grid: VoxelGrid
  readonly views: ModelViews
}

/** The reference for `triangles`, with the cells their surface passes through solid when `surface` is on. */
export const referenceOf = (triangles: Float32Array, surface: boolean): Reference => ({
  grid: voxelize(triangles, gridOver(trianglesBox(triangles), REFERENCE_RESOLUTION), { surface }),
  views: modelViews(triangles)
})

/** Distances from one surface to another, in cm; Infinity with nothing to measure from or to. */
export interface SurfaceGap {
  readonly mean: number
  readonly p95: number
}

export interface Metrics {
  readonly items: number
  readonly byKind: Readonly<Record<ShapeKind, number>>
  /** Shared cells over all cells either holds: 1 is a perfect match. */
  readonly iou: number
  /** The share of the model's cells the items cover. */
  readonly coverage: number
  /** The share of the items' cells that are outside the model. */
  readonly spill: number
  /** From the model's surface to the pieces': how far the pieces miss it. */
  readonly missed: SurfaceGap
  /** From the pieces' surface to the model's: how far they bulge past it or sink into it. */
  readonly bulged: SurfaceGap
  /** Silhouette IoU over the fixed views, averaged. */
  readonly silhouette: number
  /** The mean angle between the model's faces and the pieces' where both show, in degrees. */
  readonly normalAngle: number
  /** The pieces' edge pixels over the model's in those views: 1 is as clean as the model. */
  readonly clutter: number
}

const NO_GAP: SurfaceGap = { mean: Infinity, p95: Infinity }

/** How far the cells `from` marks are from the nearest cell `to` marks. */
const gapBetween = (reference: VoxelGrid, from: Uint8Array, to: Uint8Array): SurfaceGap => {
  if (!to.includes(1)) return NO_GAP
  const distance = distanceTo(reference, to)
  const gaps: Array<number> = []
  for (let i = 0; i < from.length; i++) if (at(from, i) === 1) gaps.push(at(distance, i) * reference.voxel)
  if (gaps.length === 0) return NO_GAP
  gaps.sort((a, b) => a - b)
  return {
    mean: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
    p95: gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))] ?? 0
  }
}

/** The cells of `reference` the pieces hold, with what they seal off. */
const cellsOfPieces = (reference: VoxelGrid, placements: ReadonlyArray<Placement>): Uint8Array => {
  const cells = new Uint8Array(cellCount(reference))
  for (const placement of placements) {
    forEachCellIn(reference, toGridShape(reference, placement), (i) => {
      cells[i] = 1
    })
  }
  return fillSealed(reference, cells)
}

/** How two sets of cells overlap. */
const volumesOf = (model: Uint8Array, pieces: Uint8Array): Pick<Metrics, "iou" | "coverage" | "spill"> => {
  let inModel = 0, inPieces = 0, inBoth = 0
  for (let i = 0; i < model.length; i++) {
    inModel += at(model, i)
    inPieces += at(pieces, i)
    inBoth += at(model, i) & at(pieces, i)
  }
  const union = inModel + inPieces - inBoth
  return {
    iou: union === 0 ? 1 : inBoth / union,
    coverage: inModel === 0 ? 1 : inBoth / inModel,
    spill: inPieces === 0 ? 0 : (inPieces - inBoth) / inPieces
  }
}

const countByKind = (placements: ReadonlyArray<Placement>): Record<ShapeKind, number> => {
  const byKind = { box: 0, sphere: 0, cylinder: 0, cone: 0, pyramid: 0, hemisphere: 0, capsule: 0 }
  for (const placement of placements) byKind[placement.kind] += 1
  return byKind
}

export const evaluate = ({ grid: reference, views }: Reference, placements: ReadonlyArray<Placement>): Metrics => {
  const pieces = cellsOfPieces(reference, placements)
  const model = fillSealed(reference, reference.cells.slice())
  const modelSurface = surfaceCells(reference, model), piecesSurface = surfaceCells(reference, pieces)
  return {
    ...compareViews(views, placements),
    missed: gapBetween(reference, modelSurface, piecesSurface),
    bulged: gapBetween(reference, piecesSurface, modelSurface),
    items: placements.length,
    byKind: countByKind(placements),
    ...volumesOf(model, pieces)
  }
}
