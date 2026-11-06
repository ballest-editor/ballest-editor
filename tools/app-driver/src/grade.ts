/** Pure grading: which variations a state runs under, frame math, and the checks on its metrics. */
import { type Axes, AXIS_VALUES, type Check, DEFAULT_AXES, type State } from "./state.ts"

export type Metrics = Readonly<Record<string, number | boolean | string | null>>

export type AxisOverrides = { readonly [K in keyof Axes]?: ReadonlyArray<Axes[K]> }

const axisNames: ReadonlyArray<keyof Axes> = ["theme", "window", "panes", "dock"]

const axisNamed = (name: string): keyof Axes => {
  const axis = axisNames.find((candidate) => candidate === name)
  if (axis === undefined) throw new Error(`no axis called ${name}: ${axisNames.join(", ")}`)
  return axis
}

/** `theme=light,window=*`: a value, or every value of the axis. */
export const parseAxes = (text: string): AxisOverrides =>
  Object.fromEntries(
    text.split(",").filter((part) => part !== "").map((part) => {
      const [name = "", value = ""] = part.split("=")
      const values: ReadonlyArray<string> = AXIS_VALUES[axisNamed(name)]
      if (value !== "*" && !values.includes(value)) {
        throw new Error(`${name} has no value ${value}: ${values.join(", ")}`)
      }
      return [name, value === "*" ? values : [value]]
    })
  )

const cross = (overrides: AxisOverrides): ReadonlyArray<Axes> =>
  axisNames.reduce<ReadonlyArray<Axes>>(
    (all, name) =>
      all.flatMap((axes) => (overrides[name] ?? [axes[name]]).map((value) => ({ ...axes, [name]: value }))),
    [DEFAULT_AXES]
  )

/**
 * What a state runs under. Once at the defaults; an anchor's light twin and each listed value once more, alone, so the
 * count grows with the states and not with their product. A cross product only comes from asking for one.
 */
export const variationsOf = (
  state: State,
  options: { readonly smoke?: boolean; readonly overrides?: AxisOverrides } = {}
): ReadonlyArray<Axes> => {
  if (options.overrides !== undefined && Object.keys(options.overrides).length > 0) return cross(options.overrides)
  if (options.smoke === true) return [DEFAULT_AXES]
  const listed: AxisOverrides = { ...state.axes, ...(state.anchor === true ? { theme: ["dark", "light"] } : {}) }
  const others = axisNames.flatMap((name) =>
    (listed[name] ?? []).filter((value) => value !== DEFAULT_AXES[name]).map((value) => ({
      ...DEFAULT_AXES,
      [name]: value
    }))
  )
  return [DEFAULT_AXES, ...others]
}

/** A variation's name in file names and tables: `<state>`, then whichever axes aren't at their default. */
export const keyOf = (id: string, axes: Axes): string =>
  [
    id.replaceAll("/", "__"),
    ...axisNames.filter((name) => axes[name] !== DEFAULT_AXES[name]).map((name) => `${name}-${axes[name]}`)
  ].join(".")

export const checkFails = (check: Check, metrics: Metrics): string | null => {
  const value = metrics[check.metric]
  if (value === undefined) return `${check.metric} missing`
  if (check.equals !== undefined) {
    return value === check.equals ? null : `${check.metric}=${value}, want ${check.equals}`
  }
  if (typeof value !== "number") return `${check.metric}=${value}, want a number`
  if (check.max !== undefined && value > check.max) return `${check.metric}=${value} > ${check.max}`
  if (check.min !== undefined && value < check.min) return `${check.metric}=${value} < ${check.min}`
  return null
}

const percentile = (sorted: ReadonlyArray<number>, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0

/** Frame times from rAF timestamps. Meaningful on a real GPU only (`--gpu`). */
export const frameStats = (timestamps: ReadonlyArray<number>): Metrics => {
  const gaps = timestamps.slice(1).map((time, index) => time - (timestamps[index] ?? time))
  const sorted = [...gaps].sort((a, b) => a - b)
  const round = (value: number) => Number(value.toFixed(1))
  return {
    frames: gaps.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1) ?? 0)
  }
}
