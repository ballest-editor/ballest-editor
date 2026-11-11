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

/** What an expression is worked out with, for one selected thing (`workOutEntry`). */
interface Scope {
  /** The value just worked out for the thing before. */
  readonly prev: number
  /** The thing's place in the selection, from 0. */
  readonly i: number
  /** How many things there are. */
  readonly n: number
}

type Expression = (scope: Scope) => number

/**
 * What's typed into a field: an expression, and how its value meets the value a thing holds. `set` replaces it; the
 * others add to it, take from it, multiply it or divide it, each thing from its own value.
 */
export interface NumberEntry {
  readonly op: "set" | "add" | "subtract" | "multiply" | "divide"
  readonly expression: Expression
  /** Whether it names `$prev`, which the first thing has none of. */
  readonly usesPrev: boolean
  /** Its value, when it names no variable. */
  readonly constant: number | undefined
}

/** An entry that sets every thing to `value`. */
export const setEntry = (value: number): NumberEntry => ({
  op: "set",
  expression: () => value,
  usesPrev: false,
  constant: value
})

/** An entry that changes every thing by `by` from its own value (a scrub). */
export const offsetEntry = (by: number): NumberEntry => ({ ...setEntry(by), op: "add" })

/** Whether an entry needs the value a field holds: anything but a value to set. */
export const isRelativeEntry = (entry: NumberEntry): boolean => entry.op !== "set" || entry.usesPrev

/**
 * Arithmetic only, with precedence, parentheses and powers (`^`, from the right, tighter than a sign), and three names:
 * `$prev`, `$i` and `L(a, b)`, which spreads a to b evenly across the things. Never executes JavaScript. An expression
 * that names nothing is worked out here, and refused unless it is a finite number.
 */
const compile = (text: string): Omit<NumberEntry, "op"> | null => {
  if (text.length > 1024) return null
  let at = 0
  // what the expression names, set as it is read
  const names = { any: false, prev: false }
  const space = () => {
    while (at < text.length && /\s/.test(text[at] ?? "")) at++
  }
  const eat = (token: string): boolean => {
    space()
    if (!text.startsWith(token, at)) return false
    at += token.length
    return true
  }
  const finite = (value: number) => (Number.isFinite(value) ? value : Number.NaN)
  const primary = (): Expression | null => {
    space()
    if (eat("(")) {
      const inner = sum()
      return inner !== null && eat(")") ? inner : null
    }
    const name = /^(?:\$prev|\$i|L)\b/i.exec(text.slice(at))?.[0].toLowerCase()
    if (name !== undefined) {
      at += name.length
      names.any = true
      if (name === "$prev") {
        names.prev = true
        return (scope) => scope.prev
      }
      if (name === "$i") return (scope) => scope.i
      const from = eat("(") ? sum() : null
      const to = from !== null && eat(",") ? sum() : null
      if (from === null || to === null || !eat(")")) return null
      return (scope) => {
        const a = from(scope)
        return scope.n <= 1 ? a : a + (to(scope) - a) * scope.i / (scope.n - 1)
      }
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(at))
    if (match === null) return null
    at += match[0].length
    const value = Number(match[0])
    return Number.isFinite(value) ? () => value : null
  }
  const power = (): Expression | null => {
    const base = primary()
    if (base === null || !eat("^")) return base
    const exponent = unary()
    return exponent === null ? null : (scope) => finite(base(scope) ** exponent(scope))
  }
  const unary = (): Expression | null => {
    if (eat("-")) {
      const inner = unary()
      return inner === null ? null : (scope) => -inner(scope)
    }
    return eat("+") ? unary() : power()
  }
  const product = (): Expression | null => {
    let value = unary()
    for (;;) {
      if (value === null) return null
      const left: Expression = value
      if (eat("*")) {
        const right = unary()
        value = right === null ? null : (scope) => finite(left(scope) * right(scope))
      } else if (eat("/")) {
        const right = unary()
        value = right === null ? null : (scope) => {
          const by = right(scope)
          return by === 0 ? Number.NaN : finite(left(scope) / by)
        }
      } else return value
    }
  }
  const sum = (): Expression | null => {
    let value = product()
    for (;;) {
      if (value === null) return null
      const left: Expression = value
      if (eat("+")) {
        const right = product()
        value = right === null ? null : (scope) => finite(left(scope) + right(scope))
      } else if (eat("-")) {
        const right = product()
        value = right === null ? null : (scope) => finite(left(scope) - right(scope))
      } else return value
    }
  }
  const expression = sum()
  space()
  if (expression === null || at !== text.length) return null
  if (names.any) return { expression, usesPrev: names.prev, constant: undefined }
  const constant = expression({ prev: 0, i: 0, n: 1 })
  return Number.isFinite(constant) ? { expression: () => constant, usesPrev: false, constant } : null
}

const OPS: Readonly<Record<string, NumberEntry["op"]>> = {
  "+=": "add",
  "+": "add",
  "-=": "subtract",
  "*=": "multiply",
  "*": "multiply",
  "/=": "divide",
  "/": "divide"
}

/**
 * What's typed into a field, or null when it isn't an entry. `+=`, `-=`, `*=` and `/=`, or the shorthands `+`, `*` and
 * `/`, change a value; anything else sets one, so a bare `-20` sets -20, and so does `=-20`.
 */
export const parseNumberEntry = (text: string): NumberEntry | null => {
  const typed = text.trim()
  const relative = /^(?:\+=|-=|\*=|\/=|\+|\*|\/)/.exec(typed)?.[0]
  const body = relative === undefined
    ? typed.startsWith("=") ? typed.slice(1) : typed
    : typed.slice(relative.length)
  const compiled = compile(body)
  if (compiled === null) return null
  const op = relative === undefined ? "set" : OPS[relative] ?? "set"
  return op === "divide" && compiled.constant === 0 ? null : { op, ...compiled }
}

const combine = (op: NumberEntry["op"], current: number, value: number): number => {
  switch (op) {
    case "set":
      return value
    case "add":
      return current + value
    case "subtract":
      return current - value
    case "multiply":
      return current * value
    case "divide":
      return value === 0 ? Number.NaN : current / value
  }
}

/**
 * `entry` worked out for each of several things, in order, from the value each holds: undefined for a thing without
 * one, which keeps it. `$i` is the thing's place from 0, and `$prev` the value just worked out for the one before; the
 * first thing has none, so an entry naming it leaves the first as it is. A value that works out to nothing finite
 * leaves its thing as it is too.
 */
export const workOutEntry = (
  entry: NumberEntry,
  values: ReadonlyArray<number | undefined>
): ReadonlyArray<number | undefined> => {
  let prev: number | undefined
  return values.map((current, i) => {
    if (current === undefined) return undefined
    const value = entry.usesPrev && prev === undefined
      ? current
      : combine(entry.op, current, entry.expression({ prev: prev ?? current, i, n: values.length }))
    const result = Number.isFinite(value) ? value : current
    prev = result
    return result
  })
}

/** The value `entry` leaves a field holding `current`, as one thing. */
export const applyNumberEntry = (entry: NumberEntry, current: number): number =>
  workOutEntry(entry, [current])[0] ?? current
