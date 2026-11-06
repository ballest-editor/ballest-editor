/**
 * Lines closer together than the screen can show alias into moiré, near the horizon above all. So each set of lines goes
 * as its spacing shrinks, from `FINE_START` cells per pixel to `FINE_END`, whatever the camera's height: the 1 m cells
 * first, then the 10 m sections further out. Each axis goes by itself, because a line running away from the camera stays
 * apart for longer than one running across the view.
 */
const FINE_START = 0.16
const FINE_END = 0.4

/** drei's grid fragment shader, with that fade in `getGrid`. Its test fails if a drei update moves what this replaces. */
export const fadeFineLines = (fragmentShader: string): string =>
  fragmentShader
    .replace(
      "float line = min(grid.x, grid.y) + 1.0 - thickness;",
      `vec2 lines = 1.0 - min(grid + 1.0 - thickness, 1.0);
      lines *= 1.0 - smoothstep(${FINE_START}, ${FINE_END}, fwidth(r));`
    )
    .replace("return 1.0 - min(line, 1.0);", "return max(lines.x, lines.y);")

/** How many times the camera's height above the floor the grid reaches, so it still runs out of the view from high up. */
const REACH_PER_HEIGHT = 3

/** How far from under the camera the grid fades out: `near`, or further when the camera is high above the floor. */
export const gridReach = (heightAboveFloor: number, near: number): number =>
  Math.max(near, Math.abs(heightAboveFloor) * REACH_PER_HEIGHT)
