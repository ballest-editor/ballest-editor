/**
 * The clock the time-limited searches read (the plate mesh search, the piece polish, the profile cover). A check that
 * needs the same pieces from the same input every time freezes it with `setClock`: a search then runs until its own
 * work runs out, not until its seconds do.
 */
let read = (): number => performance.now()

/** Milliseconds, as `performance.now()` unless `setClock` replaced it. */
export const now = (): number => read()

/** Replaces what `now` reads. */
export const setClock = (clock: () => number): void => {
  read = clock
}
