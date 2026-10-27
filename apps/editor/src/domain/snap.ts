/**
 * Translation grid snapping, in game centimetres. The game's own grid sizes are compiled
 * into its exe (SKGMLESnappingConfiguration). Its tool bar shows 10 by default, which
 * matches how sample maps cluster on 10 cm multiples; the other steps are ours (a 1-2.5-5
 * ladder up to 10 m) and should be checked against the in-game snapping menu.
 */
export const GRID_SIZES = [1, 5, 10, 25, 50, 100, 250, 500, 1000] as const
export type GridSize = (typeof GRID_SIZES)[number]

export const DEFAULT_GRID_SIZE: GridSize = 10

/** `v` rounded to the nearest multiple of `step` (never -0). */
export const snapValue = (v: number, step: number): number => Math.round(v / step) * step + 0

/** A grid size for display: "25 cm", or "0.25 m" when the editor shows metres. */
export const formatGridSize = (size: number, units: "cm" | "m"): string =>
  units === "m" ? `${size / 100} m` : `${size} cm`
