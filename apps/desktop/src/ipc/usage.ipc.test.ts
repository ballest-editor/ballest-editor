import { InvokeChannels } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, FileSystem } from "effect"
import { collectAnswers, collected, readSettings, withHandlers } from "./handlersHarness"

const form = { kind: "bug", message: "The ramp floats.", discord: "robin#1", creator: "Robin" } as const

describe("feedback and usage statistics over IPC", () => {
  it.effect("sends the form with the app's facts and answers with the issue", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        collected.length = 0
        collectAnswers.push({ status: 200, body: { issueNumber: 42, issueUrl: "https://github.com/x/42" } })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.sendFeedback, form), {
          _tag: "Sent",
          issueNumber: 42,
          issueUrl: "https://github.com/x/42"
        })
        assert.deepStrictEqual(collected, [{
          url: "https://collect.test/api/feedback",
          body: { appVersion: "0.3.0", platform: "linux", osVersion: "6.18", ...form }
        }])
      })
    ))

  it.effect("tells a refusal from a failure", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        collectAnswers.push({ status: 429, body: { error: "slow down" } }, { status: 502 }, {
          status: 200,
          body: { unexpected: true }
        })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.sendFeedback, form), { _tag: "RateLimited" })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.sendFeedback, form), {
          _tag: "Failed",
          message: "The feedback service answered 502."
        })
        assert.deepInclude(yield* fake.invoke(InvokeChannels.sendFeedback, form), { _tag: "Failed" })
      })
    ))

  it.effect("refuses a form the endpoint would", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        const sent = collected.length
        for (
          const bad of [{ ...form, message: "" }, { ...form, message: "x".repeat(4001) }, { ...form, kind: "rant" }]
        ) {
          assert.isTrue(Exit.isFailure(yield* Effect.exit(fake.invoke(InvokeChannels.sendFeedback, bad))))
        }
        assert.strictEqual(collected.length, sent)
      })
    ))

  it.effect("turns usage statistics off and on, and remembers the notice", () =>
    withHandlers(({ fake, dir }) =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.usageStats), {
          enabled: true,
          noticeShown: false,
          collecting: true
        })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.setUsageStats, { noticeShown: true }), {
          enabled: true,
          noticeShown: true,
          collecting: true
        })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.setUsageStats, { enabled: false }), {
          enabled: false,
          noticeShown: true,
          collecting: true
        })
        assert.deepStrictEqual((yield* readSettings(yield* FileSystem.FileSystem, dir)).usage, {
          enabled: false,
          noticeShown: true
        })
      })
    ))
})
