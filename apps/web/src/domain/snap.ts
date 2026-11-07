/**
 * Gizmo snapping. Translation grid snapping, in game centimetres. The game's own grid sizes are compiled
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

/**
 * Rotation steps in degrees, from the game's snapping menu: 2.8125 (360/128, shown there
 * as 2.812), then 5 to 90. It defaults to 15.
 */
export const ROTATION_STEPS = [2.8125, 5, 10, 15, 30, 45, 90] as const
export type RotationStep = (typeof ROTATION_STEPS)[number]

export const DEFAULT_ROTATION_STEP: RotationStep = 15

/** A rotation step for display: "15°", and "2.812°" as the game's menu cuts it short. */
export const formatRotationStep = (step: number): string => `${Math.trunc(step * 1000) / 1000}°`

/** Scale steps in percent, along an item's own axes as the game scales. */
export const SCALE_STEPS = [10, 25, 50, 100] as const

export const DEFAULT_SCALE_STEP = 10

/** A scale step for display: "25%". */
export const formatScaleStep = (step: number): string => `${step}%`
