import { type AppFacts, COLLECT_URL } from "@ballest/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import * as Electron from "electron"
import * as Os from "node:os"
import { DesktopEnvironment } from "../app/DesktopEnvironment"

/** The collect endpoint's routes (apps/collect). */
export type CollectPath = "/api/feedback" | "/api/events"

/** How main makes a request: `Electron.net.fetch`, or a fake in tests. Only ever a JSON POST. */
export type CollectFetch = (url: string, init: {
  readonly method: "POST"
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly signal: AbortSignal
}) => Promise<Response>

/** A request to the collect endpoint that failed: no answer (`status` null), or one that wasn't a success. */
export class CollectError extends Schema.TaggedError<CollectError>()("CollectError", {
  path: Schema.String,
  status: Schema.NullOr(Schema.Int),
  cause: Schema.Defect()
}) {
  override get message(): string {
    return this.status === null
      ? `Couldn't reach the feedback service.`
      : `The feedback service answered ${this.status}.`
  }
}

const TIMEOUT = "15 seconds"

/**
 * The collect endpoint (docs/DESKTOP.md § Feedback and usage statistics), reached from main so the page's
 * `connect-src` stays as it is. It holds no credential: the endpoint has the only secrets.
 */
export class CollectClient extends Context.Service<CollectClient, {
  /** Where this build sends: `COLLECT_URL` when installed, else only `BALLEST_COLLECT_URL`; none: it sends nothing. */
  readonly endpoint: Option.Option<string>
  /** The app's version and platform, which every request carries. */
  readonly facts: AppFacts
  /** POSTs `facts` and `body` as one JSON object; the answer's JSON, or undefined when it has none (204). */
  readonly post: (path: CollectPath, body: object) => Effect.Effect<unknown, CollectError>
}>()("ballest/desktop/usage/CollectClient") {
  static readonly make = (endpoint: Option.Option<string>, facts: AppFacts, fetch: CollectFetch) =>
    CollectClient.of({
      endpoint,
      facts,
      post: (path, body) =>
        Option.match(endpoint, {
          onNone: () => Effect.fail(new CollectError({ path, status: null, cause: "no endpoint in this build" })),
          onSome: (base) =>
            Effect.gen(function*() {
              const response = yield* Effect.tryPromise({
                try: (signal) =>
                  fetch(new URL(path, base).href, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ ...facts, ...body }),
                    signal
                  }),
                catch: (cause) => new CollectError({ path, status: null, cause })
              })
              if (!response.ok) {
                return yield* new CollectError({ path, status: response.status, cause: response.statusText })
              }
              if (response.status === 204) return undefined
              return yield* Effect.tryPromise({
                try: (): Promise<unknown> => response.json(),
                catch: (cause) => new CollectError({ path, status: response.status, cause })
              })
            }).pipe(
              Effect.timeoutOrElse({
                duration: TIMEOUT,
                orElse: () => Effect.fail(new CollectError({ path, status: null, cause: "timed out" }))
              })
            )
        })
    })

  static readonly layer = Layer.effect(
    CollectClient,
    Effect.gen(function*() {
      const { isPackaged, platform, appVersion } = yield* DesktopEnvironment
      const override = yield* Config.String("BALLEST_COLLECT_URL").pipe(
        Config.option,
        Effect.orElseSucceed(Option.none)
      )
      const endpoint = Option.orElse(override, () => isPackaged ? Option.some(COLLECT_URL) : Option.none())
      const facts: AppFacts = {
        appVersion,
        platform: platform === "win32" || platform === "darwin" ? platform : "linux",
        osVersion: Os.release().slice(0, 64)
      }
      return CollectClient.make(endpoint, facts, (url, init) => Electron.net.fetch(url, init))
    })
  )
}
