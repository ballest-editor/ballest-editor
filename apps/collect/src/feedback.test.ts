import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FEEDBACK_BODY_LIMIT, FEEDBACK_PER_HOUR, handleFeedback } from "./feedback"
import { fakeGitHub, fakeStore, post, submission, testConfig } from "./test/fakes"

const setup = (options: { readonly refuse?: boolean } = {}) => {
  const store = fakeStore()
  const github = fakeGitHub(options)
  const run = (request: Request) =>
    handleFeedback(request).pipe(Effect.provide(Layer.mergeAll(store.layer, github.layer, testConfig())))
  return { store, github, run }
}

const json = (response: Response) => Effect.promise((): Promise<unknown> => response.json())

describe("POST /api/feedback", () => {
  it.effect("files the issue, keeps the names in the database only, and answers the receipt", () =>
    Effect.gen(function*() {
      const { github, run, store } = setup()
      const response = yield* run(post("/api/feedback", submission()))
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* json(response), {
        issueNumber: 1,
        issueUrl: "https://github.com/ballest-editor/ballest-editor/issues/1"
      })

      const [issue] = github.issues
      assert.deepStrictEqual(issue?.labels, ["feedback", "bug"])
      for (const text of [issue?.title, issue?.body, JSON.stringify(issue)]) {
        assert.notInclude(text, "racer#0042")
        assert.notInclude(text, "SpeedyCreator")
      }

      assert.lengthOf(store.feedback, 1)
      assert.deepInclude(store.feedback[0], {
        issueNumber: 1,
        kind: "bug",
        discord: "racer#0042",
        creator: "SpeedyCreator",
        appVersion: "0.4.0",
        platform: "win32",
        osVersion: "10.0.22631"
      })
      assert.match(store.feedback[0]!.ipHash, /^[0-9a-f]{32}$/)
      assert.notInclude(store.feedback[0]!.ipHash, "203.0.113.7")
    }))

  it.effect("refuses a body the schema doesn't take with 400, filing nothing", () =>
    Effect.gen(function*() {
      const { github, run } = setup()
      for (
        const body of [
          "not json",
          { ...submission(), kind: "rant" },
          { ...submission(), message: "" },
          { ...submission(), message: "x".repeat(4001) },
          { ...submission(), discord: "d".repeat(65) },
          { ...submission(), token: "extra" },
          { kind: "bug", message: "no facts" }
        ]
      ) {
        const response = yield* run(post("/api/feedback", body))
        assert.strictEqual(response.status, 400)
      }
      assert.deepStrictEqual(github.issues, [])
    }))

  it.effect("refuses a body over the limit with 413", () =>
    Effect.gen(function*() {
      const { github, run } = setup()
      const response = yield* run(post("/api/feedback", "x".repeat(FEEDBACK_BODY_LIMIT + 1)))
      assert.strictEqual(response.status, 413)
      assert.deepStrictEqual(github.issues, [])
    }))

  it.effect("limits each client to a few submissions an hour", () =>
    Effect.gen(function*() {
      const { github, run } = setup()
      for (let i = 0; i < FEEDBACK_PER_HOUR; i++) {
        assert.strictEqual((yield* run(post("/api/feedback", submission()))).status, 200)
      }
      const limited = yield* run(post("/api/feedback", submission()))
      assert.strictEqual(limited.status, 429)
      assert.strictEqual(limited.headers.get("retry-after"), "3600")
      assert.lengthOf(github.issues, FEEDBACK_PER_HOUR)
      // Another address isn't limited by the first one's submissions.
      assert.strictEqual((yield* run(post("/api/feedback", submission(), "198.51.100.9"))).status, 200)
    }))

  it.effect("holds the limit against submissions sent at once", () =>
    Effect.gen(function*() {
      const { github, run } = setup()
      const statuses = yield* Effect.all(
        Array.from({ length: FEEDBACK_PER_HOUR * 2 }, () => run(post("/api/feedback", submission()))),
        { concurrency: "unbounded" }
      ).pipe(Effect.map((responses) => responses.map((r) => r.status)))
      assert.strictEqual(statuses.filter((status) => status === 200).length, FEEDBACK_PER_HOUR)
      assert.lengthOf(github.issues, FEEDBACK_PER_HOUR)
    }))

  it.effect("answers 502 when GitHub refuses the issue, keeping no row", () =>
    Effect.gen(function*() {
      const { run, store } = setup({ refuse: true })
      assert.strictEqual((yield* run(post("/api/feedback", submission()))).status, 502)
      assert.deepStrictEqual(store.feedback, [])
    }))

  it.effect("only takes POST", () =>
    Effect.gen(function*() {
      const { run } = setup()
      const response = yield* run(new Request("https://ballest-collect.vercel.app/api/feedback"))
      assert.strictEqual(response.status, 405)
      assert.strictEqual(response.headers.get("allow"), "POST")
    }))
})
