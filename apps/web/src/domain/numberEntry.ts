/** What a number field does with a drag or with what's typed into it, apart from the field itself. */
import { snapValue } from "./snap"

/** A snapped scrub moves at least one snap step per this many pixels, however big the step. */
const PIXELS_PER_SNAP = 10

/** How far a pixel of a scrub counts while these keys are held: Shift ×10, Alt ×0.1. */
export const scrubSpeedOf = (keys: { readonly shiftKey: boolean; readonly altKey: boolean }): number =>
  (keys.shiftKey ? 10 : 1) * (keys.altKey ? 0.1 : 1)

/** Where a scrub of `pixels` from `start` lands, `step` per pixel; with `snap`, on a multiple of it. */
export const scrubbedValue = (start: number, pixels: number, step: number, snap: number | undefined): number =>
  snap === undefined
    ? start + pixels * step
    : snapValue(start + pixels * Math.max(step, snap / PIXELS_PER_SNAP), snap)

/** What's typed into a field: a value to set, or an operation on the value it holds. */
type NumberEntry =
  | { readonly kind: "set"; readonly value: number }
  | { readonly kind: "add"; readonly by: number }
  | { readonly kind: "multiply"; readonly by: number }

const numberIn = (text: string): number | null => {
  const n = text.trim() === "" ? Number.NaN : Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * Reads `+50`, `-20`, `*2` and `/2` as operations and anything else as a value, null when it's neither. A leading `-` is
 * an operation, so `=` sets a value outright: `=-20`.
 */
export const parseNumberEntry = (text: string): NumberEntry | null => {
  const typed = text.trim()
  const n = numberIn(typed.slice(1))
  switch (typed[0]) {
    case "=":
      return n === null ? null : { kind: "set", value: n }
    case "+":
      return n === null ? null : { kind: "add", by: n }
    case "-":
      return n === null ? null : { kind: "add", by: -n }
    case "*":
      return n === null ? null : { kind: "multiply", by: n }
    case "/":
      return n === null || n === 0 ? null : { kind: "multiply", by: 1 / n }
    default: {
      const value = numberIn(typed)
      return value === null ? null : { kind: "set", value }
    }
  }
}

/** The value `entry` leaves a field holding `current`. */
export const applyNumberEntry = (entry: NumberEntry, current: number): number => {
  switch (entry.kind) {
    case "set":
      return entry.value
    case "add":
      return current + entry.by
    case "multiply":
      return current * entry.by
  }
}
