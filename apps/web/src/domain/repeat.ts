import type { Vec3 } from "./coords"

/** Counts include the original. Spacing is the world-axis offset between copies, in centimetres. */
export interface RepeatOptions {
  readonly count: Vec3
  readonly spacing: Vec3
}

export const defaultRepeat: RepeatOptions = {
  count: { x: 2, y: 1, z: 1 },
  spacing: { x: 100, y: 100, z: 100 }
}

/** Reject the whole request before generating offsets or allocating copies. */
export const repeatProblem = ({ count, spacing }: RepeatOptions): string | undefined => {
  for (const axis of ["x", "y", "z"] as const) {
    if (!Number.isSafeInteger(count[axis]) || count[axis] < 1) return "Counts must be whole numbers of at least 1."
    if (!Number.isFinite(spacing[axis] * (count[axis] - 1)) || !Number.isFinite(spacing[axis])) {
      return "Spacing must be a finite number."
    }
    if (count[axis] > 1 && spacing[axis] === 0) return "Choose non-zero spacing for each repeated axis."
  }
  return undefined
}

export const repeatCopies = ({ count }: RepeatOptions): number => count.x * count.y * count.z - 1

/** Iterate only after checking the requested item count against the map's budget. */
export function* repeatOffsets({ count, spacing }: RepeatOptions): Generator<Vec3> {
  for (let x = 0; x < count.x; x++) {
    for (let y = 0; y < count.y; y++) {
      for (let z = 0; z < count.z; z++) {
        if (x !== 0 || y !== 0 || z !== 0) yield { x: x * spacing.x, y: y * spacing.y, z: z * spacing.z }
      }
    }
  }
}
