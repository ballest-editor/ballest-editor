import { FeedbackSubmission } from "@ballest/contracts"
import type { FeedbackReceipt } from "@ballest/contracts"
import { Clock, Effect, Schema } from "effect"
import { GitHub } from "./GitHub"
import { clientHash, failureResponse, methodNotAllowed, readText, tooManyRequests } from "./http"
import { issueFor } from "./issue"
import { Store } from "./Store"

/** The largest feedback body taken: a 4,000-character message is well under it even as escaped JSON. */
export const FEEDBACK_BODY_LIMIT = 16 * 1024

/** How many submissions one client may send an hour. */
export const FEEDBACK_PER_HOUR = 10

/** Exactly the schema: a body with anything more is refused too. */
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(FeedbackSubmission), { onExcessProperty: "error" })

/**
 * `POST /api/feedback`: a {@link FeedbackSubmission} becomes a public issue, answered with its
 * {@link FeedbackReceipt}. The Discord and creator names go into the database only.
 */
export const handleFeedback = (request: Request): Effect.Effect<Response, never, Store | GitHub> =>
  Effect.gen(function*() {
    if (request.method !== "POST") return methodNotAllowed("POST")
    const submission = yield* decode(yield* readText(request, FEEDBACK_BODY_LIMIT))
    const ipHash = yield* clientHash(request)
    const store = yield* Store
    const now = yield* Clock.currentTimeMillis
    if (!(yield* store.takeSlot("feedback", ipHash, new Date(now), FEEDBACK_PER_HOUR))) return tooManyRequests()

    const issue = yield* (yield* GitHub).createIssue(issueFor(submission))
    // The issue exists either way: a row that can't be written is logged, not a failure the app would retry.
    yield* store.insertFeedback({
      issueNumber: issue.number,
      issueUrl: issue.url,
      kind: submission.kind,
      discord: submission.discord,
      creator: submission.creator,
      appVersion: submission.appVersion,
      platform: submission.platform,
      osVersion: submission.osVersion,
      ipHash,
      receivedAt: new Date(now)
    }).pipe(Effect.catch((error) => Effect.logError("couldn't keep feedback row", issue.number, error)))

    const receipt: FeedbackReceipt = { issueNumber: issue.number, issueUrl: issue.url }
    return Response.json(receipt)
  }).pipe(Effect.catch(failureResponse), Effect.withSpan("handleFeedback"))
