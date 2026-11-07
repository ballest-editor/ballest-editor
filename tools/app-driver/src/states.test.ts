import { describe, expect, it } from "vitest"
import { readFixture } from "./fixtures.ts"
import { type LoadedState, loadStates, pickStates } from "./states.ts"

const state = (id: string, views: ReadonlyArray<string>): LoadedState => ({ id, views, file: "" })

describe("loadStates", () => {
  it("finds the states beside the views, with unique ids", async () => {
    const states = await loadStates()
    expect(states.length).toBeGreaterThan(10)
    expect(new Set(states.map(({ id }) => id)).size).toBe(states.length)
  })
})

describe("pickStates", () => {
  const states = [state("a", ["panel:x"]), state("b", ["panel:y"])]

  it("takes everything by default, or by id and view", () => {
    expect(pickStates(states, [], [])).toBe(states)
    expect(pickStates(states, ["a"], ["panel:y"]).map(({ id }) => id)).toEqual(["a", "b"])
  })

  it("refuses an id that doesn't exist", () => {
    expect(() => pickStates(states, ["c"], [])).toThrow("no state c")
  })
})

describe("readFixture", () => {
  it("opens nothing for none, and names samples by part of their name", () => {
    expect(readFixture("none")).toBeNull()
    expect(readFixture("map:simple")?.name).toContain("circuit s1 t1")
  })

  it("refuses a fixture it can't find", () => {
    expect(() => readFixture("sample:no such map")).toThrow("no fixture")
  })
})
