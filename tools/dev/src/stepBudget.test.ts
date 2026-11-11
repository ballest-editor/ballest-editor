import { describe, expect, it } from "vitest"
import { defaultBudget, runProcess, runSteps, type Step } from "./stepBudget.ts"

const GiB = 1024 ** 3
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("defaultBudget", () => {
  it.each([
    { cores: 24, free: 30 * GiB, budget: 10 },
    { cores: 24, free: 12 * GiB, budget: 4 },
    { cores: 8, free: 64 * GiB, budget: 4 },
    { cores: 2, free: 1 * GiB, budget: 1 }
  ])("gives $cores cores and $free bytes free $budget slots", ({ budget, cores, free }) => {
    expect(defaultBudget(cores, free)).toBe(budget)
  })
})

describe("runSteps", () => {
  it("never runs more than the budget, admits in order, and caps a step at the whole budget", async () => {
    let inUse = 0
    let peak = 0
    const started: Array<string> = []
    const step = (name: string, weight: number, ms: number): Step => ({
      name,
      weight,
      run: async (slots) => {
        started.push(name)
        inUse += slots
        peak = Math.max(peak, inUse)
        await sleep(ms)
        inUse -= slots
        return { outcome: "pass", output: "" }
      }
    })
    const results = await runSteps(
      [step("format", 1, 40), step("lint", 2, 40), step("typecheck", 4, 40), step("knip", 1, 10), step("huge", 9, 10)],
      4
    )
    expect(peak).toBe(4)
    // knip would fit beside lint, but waits behind typecheck, which needs the whole budget.
    expect(started).toEqual(["format", "lint", "typecheck", "knip", "huge"])
    expect(results.map(({ slots }) => slots)).toEqual([1, 2, 4, 1, 4])
  })
})

describe("runProcess", () => {
  it("kills the step's whole process group at its timeout", async () => {
    // A child of the step that outlives it unless its group is killed, as turbo's tasks would.
    const result = await runProcess("sh", ["-c", "sleep 30 & echo $!; wait"], { timeoutMs: 300 })
    expect(result.outcome).toBe("TIMEOUT")
    const grandchild = Number(result.output.trim())
    await sleep(100)
    expect(() => process.kill(grandchild, 0)).toThrow(/ESRCH/)
  })

  it("passes and fails on the exit code", async () => {
    expect((await runProcess("sh", ["-c", "echo ok"], { timeoutMs: 5000 })).outcome).toBe("pass")
    expect(await runProcess("sh", ["-c", "echo broke; exit 3"], { timeoutMs: 5000 })).toEqual({
      outcome: "FAIL",
      output: "broke\n"
    })
  })
})
