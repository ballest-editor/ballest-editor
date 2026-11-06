import { describe, expect, it } from "vitest"
import { inPool } from "./pool.ts"

describe("inPool", () => {
  it("keeps the items' order and never runs more than it was given", async () => {
    let running = 0
    let most = 0
    const results = await inPool([30, 10, 20, 5], 2, async (ms) => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running--
      return ms * 2
    })
    expect(results).toEqual([60, 20, 40, 10])
    expect(most).toBe(2)
  })
})
