/**
 * What a drag or the target picker shows right now, for the overlay to draw. Mutable and outside React, as it changes on
 * every pointer move and only the scene reads it.
 */
import type { Vec3 } from "../../domain/coords"
import type { SnapMark } from "../../domain/snapFrame"

interface Marks {
  readonly marks: ReadonlyArray<SnapMark>
  /** Where the base stands now, drawn as a filled dot. */
  readonly base: Vec3 | undefined
  /** Bumped when any of it changes. */
  readonly revision: number
}

let current: Marks = { marks: [], base: undefined, revision: 0 }

export const snapMarks = {
  get: (): Marks => current,
  set: (marks: ReadonlyArray<SnapMark>, base: Vec3 | undefined): void => {
    current = { marks, base, revision: current.revision + 1 }
  },
  clear: (): void => {
    if (current.marks.length > 0 || current.base !== undefined) {
      current = { marks: [], base: undefined, revision: current.revision + 1 }
    }
  }
}
