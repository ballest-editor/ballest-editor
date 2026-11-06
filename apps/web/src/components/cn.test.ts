import { describe, expect, it } from "@effect/vitest"
import { cn } from "@workspace/ui/lib/utils"

describe("cn", () => {
  it("keeps a text role beside a colour", () => {
    for (const role of ["text-caption", "text-label", "text-body", "text-body-strong", "text-title"]) {
      expect(cn(role, "text-fg-tertiary")).toBe(`${role} text-fg-tertiary`)
    }
  })

  it("keeps a status colour beside a text role, and over a badge's own fill", () => {
    expect(cn("text-caption", "text-status-ok-foreground")).toBe("text-caption text-status-ok-foreground")
    expect(cn("bg-muted", "bg-dirty")).toBe("bg-dirty")
    expect(cn("bg-secondary text-secondary-foreground", "bg-status-warn text-status-warn-foreground"))
      .toBe("bg-status-warn text-status-warn-foreground")
  })

  it("lets a later text role, radius or padding replace an earlier one", () => {
    expect(cn("text-body", "text-body")).toBe("text-body")
    expect(cn("text-caption", "text-title")).toBe("text-title")
    expect(cn("rounded-control", "rounded-control")).toBe("rounded-control")
    expect(cn("rounded-surface", "rounded-none")).toBe("rounded-none")
    expect(cn("rounded-sheet", "rounded-surface")).toBe("rounded-surface")
    expect(cn("p-dialog", "p-0")).toBe("p-0")
  })
})
