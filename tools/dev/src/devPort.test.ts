import { describe, expect, it } from "vitest"
import { BASE_PORT, devPort } from "./devPort.ts"

describe("devPort", () => {
  it("keeps the main checkout on the base port", () => {
    expect(devPort(undefined)).toBe(BASE_PORT)
  })

  it("gives a worktree the same port every time, above the base", () => {
    const port = devPort("/home/me/.t3/worktrees/ballest-editor/t3-b3ff2b9b")
    expect(port).toBe(devPort("/home/me/.t3/worktrees/ballest-editor/t3-b3ff2b9b"))
    expect(port).toBeGreaterThan(BASE_PORT)
    expect(port).toBeLessThanOrEqual(BASE_PORT + 2000)
  })

  it("spreads worktrees across ports and skips the ones browsers block", () => {
    const ports = Array.from({ length: 200 }, (_, i) => devPort(`/worktrees/${i}`))
    expect(new Set(ports).size).toBeGreaterThan(180)
    for (const blocked of [3659, 4045, 4190]) expect(ports).not.toContain(blocked)
  })
})
