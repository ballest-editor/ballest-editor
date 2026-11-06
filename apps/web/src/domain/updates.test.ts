import type { UpdateState } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { updateCheckBlockedBy, updateCheckLine, updateStatusOf } from "./updates"

const state = (status: UpdateState["status"], changes: Partial<UpdateState> = {}): UpdateState => ({
  status,
  currentVersion: "0.2.0",
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  releaseUrl: null,
  downloadPercent: null,
  checkedAt: null,
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

  it("keeps the status bar quiet unless a check is running or the user asked for one", () => {
    assert.isNull(updateStatusOf(state("idle"), false))
    assert.isNull(updateStatusOf(state("error"), false))
    assert.strictEqual(updateStatusOf(state("idle"), true), "Up to date")
    assert.strictEqual(updateStatusOf(state("error"), true), "Couldn't check for updates")
    assert.strictEqual(updateStatusOf(state("checking"), false), "Checking for updates…")
    assert.isNull(updateStatusOf(state("available"), true))
  })

  it("says in About where the updater stands and how long ago it heard from the feed", () => {
    const checkedAt = "2026-11-06T12:00:00.000Z"
    const now = Date.parse(checkedAt) + 2 * 60_000
    assert.strictEqual(updateCheckLine(state("idle", { checkedAt }), now), "Up to date · checked 2 min ago")
    assert.strictEqual(updateCheckLine(state("idle"), now), "Not checked yet")
    assert.strictEqual(updateCheckLine(state("checking"), now), "Checking for updates…")
    assert.strictEqual(updateCheckLine(state("error", { message: "offline" }), now), "Couldn't check for updates")
    assert.strictEqual(updateCheckLine(state("disabled", { message: "Off." }), now), "Off.")
    assert.match(updateCheckLine(state("available", { availableVersion: "0.2.1" }), now), /0\.2\.1 is available/)
  })
})
