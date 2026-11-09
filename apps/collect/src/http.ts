import { Config, Effect, Redacted, Schema } from "effect"
import { createHmac } from "node:crypto"
import type { GitHubError } from "./GitHub"
import type { StoreError } from "./Store"

export class BodyTooLarge extends Schema.TaggedError<BodyTooLarge>()("BodyTooLarge", { limit: Schema.Int }) {}

export class BodyUnreadable extends Schema.TaggedError<BodyUnreadable>()("BodyUnreadable", {
  cause: Schema.Defect()
}) {}

export const HOUR_MS = 60 * 60 * 1000

/** `request`'s body as text, refused once it passes `limit` bytes (before reading it all, when it says its length). */
export const readText = (request: Request, limit: number): Effect.Effect<string, BodyTooLarge | BodyUnreadable> =>
  Effect.gen(function*() {
    const declared = Number(request.headers.get("content-length") ?? 0)
    if (declared > limit) return yield* new BodyTooLarge({ limit })
    const bytes = yield* Effect.tryPromise({
      try: () => request.arrayBuffer(),
      catch: (cause) => new BodyUnreadable({ cause })
    })
    if (bytes.byteLength > limit) return yield* new BodyTooLarge({ limit })
    return new TextDecoder().decode(bytes)
  })

/** The client's address as Vercel's edge reports it (it overwrites both headers, so neither can be forged). */
const clientIp = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() ||
  "unknown"

/**
 * Who sent `request`, for rate limits: an HMAC of the client's address keyed with `IP_HASH_SALT`, so the address is
 * never stored and the hash can't be reversed by trying every address without the salt.
 */
export const clientHash = (request: Request) =>
  Effect.map(
    Config.Redacted("IP_HASH_SALT"),
    (salt) => createHmac("sha256", Redacted.value(salt)).update(clientIp(request)).digest("hex").slice(0, 32)
  )

export const errorResponse = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, ...(headers === undefined ? {} : { headers }) })

export const methodNotAllowed = (allow: string) => errorResponse(405, "method not allowed", { allow })

export const tooManyRequests = () => errorResponse(429, "too many requests", { "retry-after": "3600" })

type Failure =
  | BodyTooLarge
  | BodyUnreadable
  | Schema.SchemaError
  | Config.ConfigError
  | StoreError
  | GitHubError

/** The answer to a request that failed: the client's fault is a 4xx it can read, ours is logged and a 5xx. */
export const failureResponse = (error: Failure): Effect.Effect<Response> => {
  switch (error._tag) {
    case "BodyTooLarge":
      return Effect.succeed(errorResponse(413, `body over ${error.limit} bytes`))
    case "BodyUnreadable":
      return Effect.succeed(errorResponse(400, "unreadable body"))
    case "SchemaError":
      return Effect.succeed(errorResponse(400, error.message))
    case "GitHubError":
      return Effect.as(
        Effect.logError("GitHub refused the issue", error),
        errorResponse(502, "couldn't file the issue")
      )
    case "ConfigError":
    case "StoreError":
      return Effect.as(Effect.logError(error), errorResponse(500, "internal error"))
  }
}
