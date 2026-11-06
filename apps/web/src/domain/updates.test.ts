import type { UpdateState } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { canCheckForUpdates, updateCheckBlockedBy, updateStatusOf, updateSummaryOf } from "./updates"

const state = (status: UpdateState["status"], changes: Partial<UpdateState> = {}): UpdateState => ({
  status,
  currentVersion: "0.2.0",
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  releaseUrl: null,
  downloadPercent: null,
  message: null,
  ...changes
})

describe("updates", () => {
  it("says why a check can't start", () => {
    assert.isNull(updateCheckBlockedBy(state("idle")))
    assert.isNull(updateCheckBlockedBy(state("error", { message: "net::ERR_FAILED" })))
    const dev = state("disabled", { message: "Updates only run in an installed build." })
    assert.strictEqual(updateCheckBlockedBy(dev), "Updates only run in an installed build.")
    assert.match(updateCheckBlockedBy(state("checking")) ?? "", /Already checking/)
    assert.match(updateCheckBlockedBy(state("ready", { availableVersion: "0.2.1" })) ?? "", /0\.2\.1 is available/)
  })

  it("only says the app is up to date after a check the user asked for", () => {
    assert.strictEqual(updateSummaryOf(state("idle"), false), "Ballest Editor 0.2.0.")
    assert.strictEqual(updateSummaryOf(state("idle"), true), "Ballest Editor 0.2.0. This is the latest version.")
  })

  it("doesn't call the app up to date while a check runs, after one fails, or with a release on offer", () => {
    assert.match(updateSummaryOf(state("checking"), true), /Checking for updates/)
    assert.match(updateSummaryOf(state("error", { message: "net::ERR_FAILED" }), true), /Couldn't check/)
    for (const status of ["available", "downloading", "ready"] as const) {
      assert.match(updateSummaryOf(state(status, { availableVersion: "0.2.1" }), true), /0\.2\.1 is available/)
    }
  })

  it("keeps the status bar quiet unless a check is running or the user asked for one", () => {
    assert.isNull(updateStatusOf(state("idle"), false))
    assert.isNull(updateStatusOf(state("error"), false))
    assert.strictEqual(updateStatusOf(state("idle"), true), "Up to date")
    assert.strictEqual(updateStatusOf(state("error"), true), "Couldn't check for updates")
    assert.strictEqual(updateStatusOf(state("checking"), false), "Checking for updates…")
    assert.isNull(updateStatusOf(state("available"), true))
  })

  it("says why updates are off", () => {
    const off = state("disabled", { message: "Updates only run in an installed build." })
    assert.strictEqual(updateSummaryOf(off, false), "Ballest Editor 0.2.0. Updates only run in an installed build.")
  })

  it("offers a check when main would run one", () => {
    const can = (["idle", "error", "disabled", "checking", "available", "downloading", "ready"] as const)
      .filter((status) => canCheckForUpdates(state(status)))
    assert.deepStrictEqual(can, ["idle", "error"])
  })
})
