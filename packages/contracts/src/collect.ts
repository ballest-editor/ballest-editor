import { Schema } from "effect"

// What the desktop app sends to the collect endpoint (`apps/collect`), shared by both ends so neither can drift: main
// encodes with these, the endpoint decodes with them and refuses anything else. No credential is ever part of either:
// the endpoint holds the only secrets (docs/DESKTOP.md § Feedback and usage statistics).

/** Where the collect endpoint is deployed (its own Vercel project, public, with no deployment protection). */
export const COLLECT_URL = "https://ballest-collect.vercel.app"

/** The kinds of feedback the form offers; each becomes a label on the issue, with `feedback`. */
export const FeedbackKind = Schema.Literals(["bug", "idea", "mismatch", "other"])
export type FeedbackKind = typeof FeedbackKind.Type

/** The longest message the form takes, in characters. */
export const FEEDBACK_MESSAGE_LIMIT = 4000

/** The longest Discord or creator name the form takes. */
export const FEEDBACK_NAME_LIMIT = 64

const Message = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(FEEDBACK_MESSAGE_LIMIT))
const OptionalName = Schema.NullOr(Schema.String.check(Schema.isMaxLength(FEEDBACK_NAME_LIMIT)))

/** The app's version and where it runs: sent with feedback and with every usage batch. */
export const AppFacts = Schema.Struct({
  appVersion: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  platform: Schema.Literals(["win32", "linux", "darwin"]),
  osVersion: Schema.String.check(Schema.isMaxLength(64))
})
export type AppFacts = typeof AppFacts.Type

/**
 * What the player typed into Help › Send feedback. `message` becomes a public GitHub issue. `discord` and `creator` are
 * kept by the endpoint for the maintainer to reply, and never written into the issue.
 */
export const FeedbackForm = Schema.Struct({
  kind: FeedbackKind,
  message: Message,
  discord: OptionalName,
  creator: OptionalName
})
export type FeedbackForm = typeof FeedbackForm.Type

/** `POST /api/feedback`'s body: the form and the app's facts. */
export const FeedbackSubmission = Schema.Struct({ ...FeedbackForm.fields, ...AppFacts.fields })
export type FeedbackSubmission = typeof FeedbackSubmission.Type

/** `POST /api/feedback`'s answer: the issue it made. */
export const FeedbackReceipt = Schema.Struct({
  issueNumber: Schema.Int,
  issueUrl: Schema.String.check(Schema.isMaxLength(512))
})
export type FeedbackReceipt = typeof FeedbackReceipt.Type

/** The longest error message or stack a usage event carries, in characters, after scrubbing (main truncates). */
export const ERROR_TEXT_LIMIT = 2048

const IsoTime = Schema.String.check(Schema.isMaxLength(64))

/**
 * One usage event. Nothing else is ever sent: no map contents, file paths, names or Steam identity.
 * - `sessionStart`: the app launched; `firstLaunch` on the launch that made the install id.
 * - `sessionEnd`: the app quit, or the next launch found the last session unfinished (a crash): how long it ran.
 * - `error`: an unhandled error in main or the page, its text with paths and map names taken out.
 */
export const UsageEvent = Schema.TaggedUnion({
  sessionStart: { at: IsoTime, firstLaunch: Schema.Boolean },
  sessionEnd: { at: IsoTime, durationS: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) },
  error: {
    at: IsoTime,
    source: Schema.Literals(["main", "renderer"]),
    message: Schema.String.check(Schema.isMaxLength(ERROR_TEXT_LIMIT)),
    stack: Schema.String.check(Schema.isMaxLength(ERROR_TEXT_LIMIT))
  }
})
export type UsageEvent = typeof UsageEvent.Type

/** The most events one batch carries; main sends a longer queue in several. */
export const USAGE_BATCH_LIMIT = 100

/** A random id made on the first launch with usage statistics on, and dropped when they are turned off. */
export const InstallId = Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/))

/** `POST /api/events`'s body. */
export const UsageBatch = Schema.Struct({
  ...AppFacts.fields,
  installId: InstallId,
  events: Schema.Array(UsageEvent).check(Schema.isMinLength(1), Schema.isMaxLength(USAGE_BATCH_LIMIT))
})
export type UsageBatch = typeof UsageBatch.Type
