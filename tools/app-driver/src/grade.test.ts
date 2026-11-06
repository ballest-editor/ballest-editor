import { describe, expect, it } from "vitest"
import { checkFails, frameStats, keyOf, parseAxes, variationsOf } from "./grade.ts"
import { DEFAULT_AXES } from "./state.ts"

describe("variationsOf", () => {
  const state = { views: ["panel:outline"] }

  it("runs a plain state once", () => {
    expect(variationsOf(state)).toEqual([DEFAULT_AXES])
  })

  it("adds an anchor's light twin and each listed value alone, not their product", () => {
    const runs = variationsOf({ ...state, anchor: true, axes: { panes: ["single", "quad"], window: ["1280x800"] } })
    expect(runs).toEqual([
      DEFAULT_AXES,
      { ...DEFAULT_AXES, theme: "light" },
      { ...DEFAULT_AXES, window: "1280x800" },
      { ...DEFAULT_AXES, panes: "quad" }
    ])
  })

  it("keeps to the defaults in a smoke run", () => {
    expect(variationsOf({ ...state, anchor: true }, { smoke: true })).toEqual([DEFAULT_AXES])
  })

  it("crosses only what a run asks for", () => {
    const runs = variationsOf({ ...state, anchor: true }, { overrides: parseAxes("theme=*,panes=quad") })
    expect(runs).toEqual([
      { ...DEFAULT_AXES, panes: "quad" },
      { ...DEFAULT_AXES, theme: "light", panes: "quad" }
    ])
  })
})

describe("parseAxes", () => {
  it("refuses an axis or value that doesn't exist", () => {
    expect(() => parseAxes("colour=red")).toThrow("no axis")
    expect(() => parseAxes("theme=neon")).toThrow("no value")
  })
})

describe("keyOf", () => {
  it("names only the axes off their default", () => {
    expect(keyOf("menu/file", DEFAULT_AXES)).toBe("menu__file")
    expect(keyOf("menu/file", { ...DEFAULT_AXES, theme: "light", panes: "quad" })).toBe(
      "menu__file.theme-light.panes-quad"
    )
  })
})

describe("checkFails", () => {
  it("grades bounds, equality and a missing metric", () => {
    expect(checkFails({ metric: "a", max: 2 }, { a: 2 })).toBeNull()
    expect(checkFails({ metric: "a", max: 2 }, { a: 3 })).toBe("a=3 > 2")
    expect(checkFails({ metric: "a", min: 2 }, { a: 1 })).toBe("a=1 < 2")
    expect(checkFails({ metric: "a", equals: true }, { a: false })).toBe("a=false, want true")
    expect(checkFails({ metric: "b", min: 1 }, {})).toBe("b missing")
    expect(checkFails({ metric: "a", min: 1 }, { a: null })).toBe("a=null, want a number")
  })
})

describe("frameStats", () => {
  it("measures the gaps between frames", () => {
    expect(frameStats([0, 10, 20, 50])).toEqual({ frames: 3, p50Ms: 10, p95Ms: 30, maxMs: 30 })
  })
})
