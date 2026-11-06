import { describe, expect, it } from "@effect/vitest"
import { cn } from "@workspace/ui/lib/utils"

describe("cn", () => {
  it("keeps a text role beside a colour", () => {
    for (const role of ["text-caption", "text-body", "text-body-strong", "text-title"]) {
      expect(cn(role, "text-fg-tertiary")).toBe(`${role} text-fg-tertiary`)
    }
  })

  it("lets a later text role, radius or padding replace an earlier one", () => {
    expect(cn("text-body", "text-body")).toBe("text-body")
    expect(cn("text-caption", "text-title")).toBe("text-title")
    expect(cn("rounded-control", "rounded-control")).toBe("rounded-control")
    expect(cn("rounded-surface", "rounded-none")).toBe("rounded-none")
    expect(cn("p-dialog", "p-0")).toBe("p-0")
  })
})
