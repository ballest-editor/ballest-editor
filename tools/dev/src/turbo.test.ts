import { describe, expect, it } from "vitest"
import { gitCommonDir } from "./git.ts"
import { sharedTurboCache } from "./turbo.ts"

describe("sharedTurboCache", () => {
  it("points every worktree at one cache under git's common dir", () => {
    expect(sharedTurboCache({})).toEqual({ TURBO_CACHE_DIR: `${gitCommonDir()}/turbo-cache` })
  })

  it.each([{ CI: "1" }, { TURBO_CACHE_DIR: "/elsewhere" }])("leaves turbo's own setting with %o", (env) => {
    expect(sharedTurboCache(env)).toEqual({})
  })
})
