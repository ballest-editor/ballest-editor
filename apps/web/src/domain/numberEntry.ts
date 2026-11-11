/** What a number field does with a drag or with what's typed into it, apart from the field itself. */
import { snapValue } from "./snap"

/** A snapped scrub moves at least one snap step per this many pixels, however big the step. */
const PIXELS_PER_SNAP = 10

/** How far a pixel of a scrub counts while these keys are held: Shift ×10, Alt ×0.1. */
export const scrubSpeedOf = (keys: { readonly shiftKey: boolean; readonly altKey: boolean }): number =>
  (keys.shiftKey ? 10 : 1) * (keys.altKey ? 0.1 : 1)

/**
 * Where a scrub of `pixels` from `start` lands, `step` per pixel; with `snap`, on a multiple of it counted from
 * `snapFrom`.
 */
export const scrubbedValue = (
  start: number,
  pixels: number,
  step: number,
  snap: number | undefined,
  snapFrom = 0
): number =>
  snap === undefined
    ? start + pixels * step
    : snapValue(start + pixels * Math.max(step, snap / PIXELS_PER_SNAP) - snapFrom, snap) + snapFrom

/** What's typed into a field: a value to set, or an operation on the value it holds. */
type NumberEntry =
  | { readonly kind: "set"; readonly value: number }
  | { readonly kind: "add"; readonly by: number }
  | { readonly kind: "multiply"; readonly by: number }

/** Arithmetic only, with precedence and parentheses; never executes JavaScript. */
const numberIn = (text: string): number | null => {
  if (text.length > 1024) return null
  let at = 0
  const space = () => {
    while (/\s/.test(text[at] ?? "") && at < text.length) at++
  }
  const atom = (): number => {
    space()
    const sign = text[at]
    if (sign === "+" || sign === "-") {
      at++
      return (sign === "-" ? -1 : 1) * atom()
    }
    if (text[at] === "(") {
      at++
      const value = sum()
      space()
      if (text[at++] !== ")") return Number.NaN
      return value
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(at))
    if (match === null) return Number.NaN
    at += match[0].length
    const value = Number(match[0])
    return Number.isFinite(value) ? value : Number.NaN
  }
  const product = (): number => {
    let value = atom()
    space()
    while (text[at] === "*" || text[at] === "/") {
      const op = text[at++]
      const right = atom()
      value = op === "*" ? value * right : right === 0 ? Number.NaN : value / right
      if (!Number.isFinite(value)) return Number.NaN
      space()
    }
    return value
  }
  const sum = (): number => {
    let value = product()
    space()
    while (text[at] === "+" || text[at] === "-") {
      const op = text[at++]
      const right = product()
      value = op === "+" ? value + right : value - right
      if (!Number.isFinite(value)) return Number.NaN
      space()
    }
    return value
  }
  const value = sum()
  return at === text.length && Number.isFinite(value) ? value : null
}

/** Negative numbers set a value. Use -= for subtraction; +, * and / retain relative entry. */
export const parseNumberEntry = (text: string): NumberEntry | null => {
  const typed = text.trim()
  const relative = /^(\+=|-=|\*=|\/=|\+|\*|\/)/.exec(typed)?.[0]
  const expression = relative === undefined
    ? typed.startsWith("=") ? typed.slice(1) : typed
    : typed.slice(relative.length)
  const value = numberIn(expression)
  if (value === null) return null
  switch (relative?.[0]) {
    case "+":
      return { kind: "add", by: value }
    case "-":
      return { kind: "add", by: -value }
    case "*":
      return { kind: "multiply", by: value }
    case "/":
      return value === 0 ? null : { kind: "multiply", by: 1 / value }
    default:
      return { kind: "set", value }
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
