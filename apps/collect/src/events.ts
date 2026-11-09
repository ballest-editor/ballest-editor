import { UsageBatch } from "@ballest/contracts"
import type { UsageEvent } from "@ballest/contracts"
import { Clock, Effect, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { clientHash, failureResponse, methodNotAllowed, readText, tooManyRequests } from "./http"
import { type EventRow, Store } from "./Store"

/** The largest usage body taken: 100 error events with full stacks fit with room to spare. */
export const EVENTS_BODY_LIMIT = 256 * 1024

/** How many batches one client may send an hour. */
export const BATCHES_PER_HOUR = 60

/** Exactly the schema: a body with anything more is refused too. */
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(UsageBatch), { onExcessProperty: "error" })

const timeOf = (at: string): Date | null => {
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : new Date(ms)
}

const fieldsOf = (event: UsageEvent) => {
  const none = {
    durationS: null,
    firstLaunch: null,
    errorSource: null,
    errorMessage: null,
    errorStack: null
  }
  switch (event._tag) {
    case "sessionStart":
      return { ...none, firstLaunch: event.firstLaunch }
    case "sessionEnd":
      return { ...none, durationS: event.durationS }
    case "error":
      return { ...none, errorSource: event.source, errorMessage: event.message, errorStack: event.stack }
  }
}

/** One row per event, each carrying the batch's facts, so the views never join. */
export const rowsFor = (
  batch: UsageBatch,
  context: { readonly batchId: string; readonly ipHash: string; readonly receivedAt: Date }
): Array<EventRow> =>
  batch.events.map((event) => ({
    ...context,
    installId: batch.installId,
    appVersion: batch.appVersion,
    platform: batch.platform,
    osVersion: batch.osVersion,
    tag: event._tag,
    at: timeOf(event.at),
    ...fieldsOf(event)
  }))

/** `POST /api/events`: a {@link UsageBatch}, kept one row per event. Answers 204. */
export const handleEvents = (request: Request): Effect.Effect<Response, never, Store> =>
  Effect.gen(function*() {
    if (request.method !== "POST") return methodNotAllowed("POST")
    const batch = yield* decode(yield* readText(request, EVENTS_BODY_LIMIT))
    const ipHash = yield* clientHash(request)
    const store = yield* Store
    const now = yield* Clock.currentTimeMillis
    if (!(yield* store.takeSlot("events", ipHash, new Date(now), BATCHES_PER_HOUR))) return tooManyRequests()
    yield* store.insertEvents(rowsFor(batch, { batchId: randomUUID(), ipHash, receivedAt: new Date(now) }))
    return new Response(null, { status: 204 })
  }).pipe(Effect.catch(failureResponse), Effect.withSpan("handleEvents"))
