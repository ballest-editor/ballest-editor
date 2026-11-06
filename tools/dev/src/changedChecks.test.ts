import { describe, expect, it } from "vitest"
import { formattedFiles, lintedFiles } from "./changedChecks.ts"

describe("formattedFiles", () => {
  it("keeps what dprint formats and leaves out fixtures and vendored code", () => {
    expect(formattedFiles(["AGENTS.md", "apps/web/src/a.tsx", "repos/effect/a.ts", "samples/a.json", "a.png"]))
      .toEqual(["AGENTS.md", "apps/web/src/a.tsx"])
  })
})

describe("lintedFiles", () => {
  it("keeps the code under apps, packages and tools", () => {
    expect(lintedFiles(["apps/web/src/a.ts", "tools/dev/src/b.ts", "docs/a.md", "vite.config.ts"]))
      .toEqual(["apps/web/src/a.ts", "tools/dev/src/b.ts"])
  })
})
