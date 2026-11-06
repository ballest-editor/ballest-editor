import { assert, describe, it } from "@effect/vitest"
import { buildInfoText } from "./buildInfo"

const facts = { commit: "bdcba6ae6", builtAt: "2026-11-06T14:22:31.000Z" }

describe("buildInfoText", () => {
  it("lines the five facts up, the build's time in UTC", () => {
    assert.strictEqual(
      buildInfoText({ ...facts, version: "0.2.0", electron: "45.1.0", chromium: "156.0.8078.49" }),
      [
        "Version   0.2.0",
        "Commit    bdcba6ae6",
        "Built     2026-11-06 14:22 UTC",
        "Electron  45.1.0",
        "Chromium  156.0.8078.49"
      ].join("\n")
    )
  })

  it("leaves out what a browser doesn't have", () => {
    assert.strictEqual(
      buildInfoText({ ...facts, version: null, electron: null, chromium: null }),
      "Commit  bdcba6ae6\nBuilt   2026-11-06 14:22 UTC"
    )
  })
})
