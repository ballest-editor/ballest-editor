import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeTestDisk } from "../../test/desktopBridge"
import { layerFor, noticesWhile, s } from "../../test/editorActions"
import { useEditor } from "../store"
import { loadUsageStatsEffect, sendFeedbackEffect, USAGE_NOTICE } from "./feedback"

const form = { kind: "bug", message: "The ramp floats.", discord: "robin", creator: "Robin" } as const

describe("feedback actions", () => {
  it.effect("show the usage statistics notice once, on the first launch that sends them", () => {
    const disk = makeTestDisk()
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        yield* loadUsageStatsEffect
        assert.deepStrictEqual(notices, [USAGE_NOTICE.title])
        assert.deepStrictEqual(s().usageStats, { enabled: true, noticeShown: true, collecting: true })
        yield* loadUsageStatsEffect
        assert.strictEqual(notices.length, 1)
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("show it once when two loads run at once", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      useEditor.setState({ notifications: [] })
      yield* Effect.all([loadUsageStatsEffect, loadUsageStatsEffect], { concurrency: "unbounded" })
      assert.strictEqual(s().notifications.filter((n) => n.kind === "usageStats").length, 1)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("say nothing about usage statistics in a build that doesn't send them, or with them off", () =>
    Effect.gen(function*() {
      for (const usage of [{ enabled: true, collecting: false }, { enabled: false, collecting: true }]) {
        const disk = makeTestDisk()
        disk.feedback.usage = { ...usage, noticeShown: false }
        yield* noticesWhile((notices) =>
          loadUsageStatsEffect.pipe(Effect.tap(() => Effect.sync(() => assert.deepStrictEqual(notices, []))))
        ).pipe(Effect.provide(layerFor(disk)))
        assert.deepStrictEqual(s().usageStats, { ...usage, noticeShown: false })
      }
    }))

  it.effect("send the form and link the toast to the issue", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      assert.isTrue(yield* sendFeedbackEffect(form))
      assert.deepStrictEqual(disk.feedback.sent, [form])
      const toast = s().toasts[0]
      assert.strictEqual(toast?.title, "Thanks! Your feedback is issue #1.")
      assert.deepStrictEqual(toast?.actions[0]?.command, {
        _tag: "OpenExternal",
        url: "https://github.com/x/issues/1"
      })
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("keep the form when sending fails, saying why", () => {
    const disk = makeTestDisk()
    disk.feedback.answers.push({ _tag: "RateLimited" }, {
      _tag: "Failed",
      message: "The feedback service answered 502."
    })
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        assert.isFalse(yield* sendFeedbackEffect(form))
        assert.isFalse(yield* sendFeedbackEffect(form))
        assert.deepStrictEqual(notices, [
          "That's a lot of feedback from this network. Try again in an hour.",
          "Couldn't send your feedback. It's still in the form."
        ])
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })
})
