import type { FeedbackSubmission, UsageBatch } from "@ballest/contracts"
import { ConfigProvider, Effect, Layer } from "effect"
import { type CreatedIssue, GitHub, GitHubError, type NewIssue, REPOSITORY } from "../GitHub"
import { HOUR_MS } from "../http"
import { type EventRow, type FeedbackRow, type RateRoute, Store } from "../Store"

/** An in-memory Store: what was written, and the rate limits' slots. */
export const fakeStore = () => {
  const feedback: Array<FeedbackRow> = []
  const events: Array<EventRow> = []
  const slots: Array<{ readonly route: RateRoute; readonly ipHash: string; readonly at: number }> = []
  const layer = Layer.succeed(
    Store,
    Store.of({
      takeSlot: (route, ipHash, now, limit) =>
        Effect.sync(() => {
          slots.push({ route, ipHash, at: now.getTime() })
          const since = now.getTime() - HOUR_MS
          return slots.filter((s) => s.route === route && s.ipHash === ipHash && s.at > since).length <= limit
        }),
      insertFeedback: (row) => Effect.sync(() => void feedback.push(row)),
      insertEvents: (rows) => Effect.sync(() => void events.push(...rows))
    })
  )
  return { feedback, events, layer }
}

/** A GitHub that files every issue it's given, numbered from 1, or refuses them all. */
export const fakeGitHub = (options: { readonly refuse?: boolean } = {}) => {
  const issues: Array<NewIssue> = []
  const layer = Layer.succeed(
    GitHub,
    GitHub.of({
      createIssue: (issue) =>
        options.refuse === true
          ? Effect.fail(new GitHubError({ message: "POST /repos/x/issues: 403" }))
          // GitHub takes a while: requests sent together all get this far before any issue exists.
          : Effect.yieldNow.pipe(Effect.andThen(Effect.sync((): CreatedIssue => {
            issues.push(issue)
            return { number: issues.length, url: `https://github.com/${REPOSITORY}/issues/${issues.length}` }
          })))
    })
  )
  return { issues, layer }
}

export const testConfig = (env: Record<string, string> = {}) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown({ IP_HASH_SALT: "test-salt", ...env }))

export const post = (path: string, body: unknown, ip = "203.0.113.7") =>
  new Request(`https://ballest-collect.vercel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body)
  })

export const submission = (overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission => ({
  kind: "bug",
  message: "The ramp floats above the floor\nSteps: place it, save, open in game.",
  discord: "racer#0042",
  creator: "SpeedyCreator",
  appVersion: "0.4.0",
  platform: "win32",
  osVersion: "10.0.22631",
  ...overrides
})

export const batch = (events: UsageBatch["events"]): UsageBatch => ({
  appVersion: "0.4.0",
  platform: "linux",
  osVersion: "6.18.49",
  installId: "8f14e45f-ceea-4e6a-9b5c-0123456789ab",
  events
})
