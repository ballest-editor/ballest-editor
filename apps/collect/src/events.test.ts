import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { BATCHES_PER_HOUR, EVENTS_BODY_LIMIT, handleEvents } from "./events"
import { batch, fakeStore, post, testConfig } from "./test/fakes"

const setup = () => {
  const store = fakeStore()
  const run = (request: Request) => handleEvents(request).pipe(Effect.provide(Layer.merge(store.layer, testConfig())))
  return { store, run }
}

const session = batch([
  { _tag: "sessionStart", at: "2026-11-08T10:00:00.000Z", firstLaunch: true },
  { _tag: "error", at: "not a time", source: "renderer", message: "boom", stack: "at x" },
  { _tag: "sessionEnd", at: "2026-11-08T10:30:00.000Z", durationS: 1800 }
])

describe("POST /api/events", () => {
  it.effect("keeps one row per event and answers 204", () =>
    Effect.gen(function*() {
      const { run, store } = setup()
      const response = yield* run(post("/api/events", session))
      assert.strictEqual(response.status, 204)
      assert.lengthOf(store.events, 3)
      const [start, error, end] = [store.events[0]!, store.events[1]!, store.events[2]!]
      const shared = {
        installId: session.installId,
        appVersion: "0.4.0",
        platform: "linux",
        osVersion: "6.18.49",
        batchId: start.batchId,
        ipHash: start.ipHash
      }
      assert.deepInclude(start, {
        ...shared,
        tag: "sessionStart",
        at: new Date("2026-11-08T10:00:00.000Z"),
        firstLaunch: true,
        durationS: null,
        errorMessage: null
      })
      assert.deepInclude(error, {
        ...shared,
        tag: "error",
        at: null,
        errorSource: "renderer",
        errorMessage: "boom",
        errorStack: "at x",
        firstLaunch: null
      })
      assert.deepInclude(end, { ...shared, tag: "sessionEnd", durationS: 1800, firstLaunch: null })
    }))

  it.effect("gives each batch its own id", () =>
    Effect.gen(function*() {
      const { run, store } = setup()
      yield* run(post("/api/events", session))
      yield* run(post("/api/events", session))
      assert.strictEqual(new Set(store.events.map((row) => row.batchId)).size, 2)
    }))

  it.effect("refuses a batch the schema doesn't take with 400", () =>
    Effect.gen(function*() {
      const { run, store } = setup()
      for (
        const body of [
          batch([]),
          { ...session, installId: "C:\\Users\\me" },
          { ...session, mapName: "secret" },
          batch([{ _tag: "sessionEnd", at: "x", durationS: -1 }]),
          batch(Array.from({ length: 101 }, () => ({ _tag: "sessionStart", at: "x", firstLaunch: false }) as const))
        ]
      ) {
        assert.strictEqual((yield* run(post("/api/events", body))).status, 400)
      }
      assert.deepStrictEqual(store.events, [])
    }))

  it.effect("refuses a body over the limit with 413", () =>
    Effect.gen(function*() {
      const { run } = setup()
      assert.strictEqual((yield* run(post("/api/events", " ".repeat(EVENTS_BODY_LIMIT + 1)))).status, 413)
    }))

  it.effect("limits each client's batches an hour", () =>
    Effect.gen(function*() {
      const { run, store } = setup()
      for (let i = 0; i < BATCHES_PER_HOUR; i++) {
        assert.strictEqual((yield* run(post("/api/events", session))).status, 204)
      }
      assert.strictEqual((yield* run(post("/api/events", session))).status, 429)
      assert.lengthOf(store.events, BATCHES_PER_HOUR * 3)
    }))

  it.effect("only takes POST", () =>
    Effect.gen(function*() {
      const { run } = setup()
      const response = yield* run(new Request("https://ballest-collect.vercel.app/api/events", { method: "PUT" }))
      assert.strictEqual(response.status, 405)
    }))
})
