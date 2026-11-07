import { describe, expect, it } from "vitest"
import { lineDifference, metricChanges, windowsPercent } from "./compare.ts"
import type { ResultRow } from "./report.ts"
import { DEFAULT_AXES } from "./state.ts"

const row = (metrics: ResultRow["metrics"]): ResultRow => ({
  key: "a",
  id: "a",
  views: [],
  axes: DEFAULT_AXES,
  kind: "guard",
  pass: true,
  failures: [],
  metrics,
  shot: "a.png",
  windows: []
})

describe("lineDifference", () => {
  it("counts what one text has and the other doesn't, however it moved", () => {
    expect(lineDifference("a\nb", "b\na")).toBe(0)
    expect(lineDifference("a\nb", "a\nc")).toBe(2)
    expect(lineDifference("a", "a\na")).toBe(1)
  })
})

describe("metricChanges", () => {
  it("lists changed metrics and never timings", () => {
    expect(metricChanges(row({ items: 1, settleMs: 5 }), row({ items: 2, settleMs: 9 }))).toEqual(["items 1 to 2"])
  })
})

describe("windowsPercent", () => {
  it("counts a popped-out window that came or went as all of it", () => {
    const opened = { ...row({}), windows: ["shots/a.window-1.png"] }
    expect(windowsPercent("", row({}), "", opened)).toBe(100)
    expect(windowsPercent("", opened, "", row({}))).toBe(100)
    expect(windowsPercent("", row({}), "", row({}))).toBe(0)
  })
})
