import { Clock, Config, Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
import { createPrivateKey, sign } from "node:crypto"

/** Where feedback issues go. */
export const REPOSITORY = "ballest-editor/ballest-editor"

const API = "https://api.github.com"

export interface NewIssue {
  readonly title: string
  readonly body: string
  readonly labels: ReadonlyArray<string>
}

export interface CreatedIssue {
  readonly number: number
  readonly url: string
}

export class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

const base64url = (data: string | Buffer) => Buffer.from(data).toString("base64url")

/**
 * The JWT a GitHub App signs to ask for an installation token: RS256, issued a minute early for clock drift, valid for
 * nine minutes (GitHub takes at most ten).
 */
export const signAppJwt = (appId: string, privateKeyPem: string, nowSeconds: number): string => {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: appId }))
  // Vercel keeps a pasted PEM's newlines, but one set as a one-line string has them as `\n`.
  const key = createPrivateKey(privateKeyPem.replace(/\\n/g, "\n"))
  return `${header}.${claims}.${base64url(sign("sha256", Buffer.from(`${header}.${claims}`), key))}`
}

const decodeAccessToken = Schema.decodeUnknownEffect(Schema.Struct({ token: Schema.String, expires_at: Schema.String }))
const decodeIssue = Schema.decodeUnknownEffect(Schema.Struct({ number: Schema.Int, html_url: Schema.String }))

/** Creates feedback issues as the GitHub App, which may only read and write this repository's issues. */
export class GitHub extends Context.Service<GitHub, {
  readonly createIssue: (issue: NewIssue) => Effect.Effect<CreatedIssue, GitHubError>
}>()("ballest/collect/GitHub") {
  /** The service over `fetch`, which tests replace. */
  static readonly make = (fetch: typeof globalThis.fetch) =>
    Effect.gen(function*() {
      const appId = yield* Config.String("GITHUB_APP_ID")
      const installationId = yield* Config.String("GITHUB_APP_INSTALLATION_ID")
      const privateKey = yield* Config.Redacted("GITHUB_APP_PRIVATE_KEY")
      const cached = yield* Ref.make<{ readonly token: string; readonly expiresMs: number } | undefined>(undefined)

      const call = <A>(
        path: string,
        authorization: string,
        body: unknown,
        decode: (json: unknown) => Effect.Effect<A, Schema.SchemaError>
      ) =>
        Effect.gen(function*() {
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${API}${path}`, {
                method: "POST",
                headers: {
                  accept: "application/vnd.github+json",
                  authorization,
                  "content-type": "application/json",
                  "user-agent": "ballest-collect",
                  "x-github-api-version": "2022-11-28"
                },
                body: JSON.stringify(body)
              }),
            catch: (cause) => new GitHubError({ message: `POST ${path} failed`, cause })
          })
          const json = yield* Effect.tryPromise({
            try: () => response.json() as Promise<unknown>,
            catch: (cause) => new GitHubError({ message: `POST ${path}: unreadable answer`, cause })
          })
          if (!response.ok) return yield* new GitHubError({ message: `POST ${path}: ${response.status}`, cause: json })
          return yield* decode(json).pipe(
            Effect.mapError((cause) => new GitHubError({ message: `POST ${path}: unexpected answer`, cause }))
          )
        })

      /** An installation token, reused until five minutes before it expires (an hour after it was made). */
      const token = Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const held = yield* Ref.get(cached)
        if (held !== undefined && held.expiresMs - 5 * 60_000 > now) return held.token
        const jwt = yield* Effect.try({
          try: () => signAppJwt(appId, Redacted.value(privateKey), Math.floor(now / 1000)),
          catch: (cause) => new GitHubError({ message: "GITHUB_APP_PRIVATE_KEY isn't a private key", cause })
        })
        const fresh = yield* call(
          `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
          `Bearer ${jwt}`,
          {},
          decodeAccessToken
        )
        yield* Ref.set(cached, { token: fresh.token, expiresMs: Date.parse(fresh.expires_at) || now + 30 * 60_000 })
        return fresh.token
      })

      const createIssue = Effect.fn("GitHub.createIssue")(function*(issue: NewIssue) {
        const created = yield* call(`/repos/${REPOSITORY}/issues`, `token ${yield* token}`, issue, decodeIssue)
        return { number: created.number, url: created.html_url }
      })

      return GitHub.of({ createIssue })
    })

  static readonly layer = Layer.effect(GitHub, GitHub.make((input, init) => globalThis.fetch(input, init)))
}
