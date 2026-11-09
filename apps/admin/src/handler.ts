import { Clock, Effect } from "effect"
import { renderError, renderPage } from "./page"
import { Stats } from "./Stats"

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  // Nothing but the page's own inline styles: no scripts, frames or requests anywhere.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
}

/** `GET /`: the dashboard, rendered from the database on every request. */
export const handleDashboard = (request: Request): Effect.Effect<Response, never, Stats> =>
  Effect.gen(function*() {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
    }
    const dashboard = yield* (yield* Stats).load
    const now = new Date(yield* Clock.currentTimeMillis)
    return new Response(renderPage(dashboard, now), { headers: HEADERS })
  }).pipe(
    Effect.catchTag("StatsError", (error) =>
      Effect.as(
        Effect.logError("couldn't read the stats", error),
        new Response(renderError(), { status: 500, headers: HEADERS })
      )),
    Effect.withSpan("handleDashboard")
  )
