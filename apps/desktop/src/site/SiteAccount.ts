import type { SiteAccount as SiteAccountState, SiteSignInResult } from "@ballest/contracts"
import { Context, Deferred, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { createHash, randomBytes } from "node:crypto"
import * as Http from "node:http"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { ElectronShell } from "../electron/ElectronShell"
import { SiteClient } from "./SiteClient"

/** How the token is sealed at rest: Electron's `safeStorage` (main.ts), or plain in tests. */
export class SiteSeal extends Context.Service<SiteSeal, {
  readonly seal: (text: string) => Effect.Effect<string>
  readonly open: (sealed: string) => Effect.Effect<Option.Option<string>>
}>()("ballest/desktop/site/SiteSeal") {
  static readonly plain = Layer.succeed(
    SiteSeal,
    SiteSeal.of({ seal: Effect.succeed, open: Effect.succeedSome })
  )
}

/** What `<userData>/site-account.json` holds: whose token, until when, and the token sealed. */
const AccountFile = Schema.Struct({ steamId: Schema.String, expiresAt: Schema.String, sealed: Schema.String })
type AccountFile = typeof AccountFile.Type
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AccountFile))

/** How long the browser has to come back with a sign-in. */
const SIGN_IN_WINDOW = "5 minutes"

const base64url = (bytes: Buffer) => bytes.toString("base64url")

/** What the browser shows once it has come back to the app: the tab has done its job. */
const page = (line: string) =>
  `<!doctype html><meta charset="utf-8"><title>Ballest Editor</title>` +
  `<body style="font:16px system-ui;padding:3rem;text-align:center"><p>${line}</p><p>You can close this tab.</p>`

type Answer = { readonly _tag: "Code"; readonly code: string } | { readonly _tag: "Denied" }

/**
 * The player's sign-in to ballestrecords.com (the site's ADR 0017; docs/DESKTOP.md § Prefabs). Signing in opens the
 * site's `/api/auth/app` in the browser with a loopback callback, a state and a PKCE challenge; the browser comes back
 * to a one-request server on 127.0.0.1 with a code, which main trades with the secret behind the challenge. The token
 * lives 30 days, sealed, and only main reads it.
 */
export class SiteAccount extends Context.Service<SiteAccount, {
  readonly state: Effect.Effect<SiteAccountState>
  readonly signIn: Effect.Effect<SiteSignInResult>
  readonly signOut: Effect.Effect<void>
  /** The token while it is good; none signed out or once it has run out. */
  readonly token: Effect.Effect<Option.Option<string>>
}>()("ballest/desktop/site/SiteAccount") {
  static readonly make = Effect.fn("SiteAccount.make")(function*(file: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sealer = yield* SiteSeal
    const site = yield* SiteClient
    const shell = yield* ElectronShell

    const read = fs.readFileString(file).pipe(
      Effect.flatMap(decodeFile),
      Effect.option,
      Effect.map(Option.filter((account: AccountFile) => Date.parse(account.expiresAt) > Date.now()))
    )
    const signOut = fs.remove(file, { force: true }).pipe(Effect.ignore)
    const state = Effect.map(
      read,
      Option.match({
        onNone: (): SiteAccountState => ({ _tag: "SignedOut" }),
        onSome: ({ expiresAt, steamId }): SiteAccountState => ({ _tag: "SignedIn", steamId, expiresAt })
      })
    )

    /** A server on the loopback address that answers the first request carrying `state`, for the scope's life. */
    const callback = (expected: string) =>
      Effect.gen(function*() {
        const answer = yield* Deferred.make<Answer>()
        const server = yield* Effect.acquireRelease(
          Effect.callback<Http.Server, Error>((resume) => {
            const listener = Http.createServer((req, res) => {
              const url = new URL(req.url ?? "/", "http://127.0.0.1")
              if (url.searchParams.get("state") !== expected) {
                res.writeHead(404).end()
                return
              }
              const code = url.searchParams.get("code")
              res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
                page(code === null ? "Sign-in cancelled." : "Signed in to ballestrecords.com.")
              )
              Deferred.doneUnsafe(
                answer,
                Effect.succeed<Answer>(code === null ? { _tag: "Denied" } : { _tag: "Code", code })
              )
            })
            listener.once("error", (error) => resume(Effect.fail(error)))
            listener.listen(0, "127.0.0.1", () => resume(Effect.succeed(listener)))
          }),
          (listener) => Effect.sync(() => listener.close())
        )
        const address = server.address()
        const port = typeof address === "object" && address !== null ? address.port : 0
        return { redirect: `http://127.0.0.1:${port}/callback`, answer: Deferred.await(answer) }
      })

    const signIn = Effect.scoped(Effect.gen(function*() {
      const verifier = base64url(randomBytes(32))
      const challenge = base64url(createHash("sha256").update(verifier).digest())
      const expected = base64url(randomBytes(16))
      const { answer, redirect } = yield* callback(expected)
      const url = new URL("/api/auth/app", site.base)
      url.search = new URLSearchParams({
        redirect_uri: redirect,
        state: expected,
        code_challenge: challenge,
        code_challenge_method: "S256"
      }).toString()
      if (!(yield* shell.openExternal(url.href))) {
        return { _tag: "Failed", message: "Couldn't open the browser." } satisfies SiteSignInResult
      }
      const came = yield* answer.pipe(Effect.timeoutOption(SIGN_IN_WINDOW))
      if (Option.isNone(came)) {
        return { _tag: "Failed", message: "The browser didn't come back in time." } satisfies SiteSignInResult
      }
      if (came.value._tag === "Denied") return { _tag: "Cancelled" } satisfies SiteSignInResult
      const token = yield* site.trade(came.value.code, verifier)
      const expiresAt = new Date(Date.now() + token.expiresIn * 1000).toISOString()
      const account: AccountFile = { steamId: token.id, expiresAt, sealed: yield* sealer.seal(token.token) }
      yield* fs.makeDirectory(path.dirname(file), { recursive: true })
      yield* fs.writeFileString(file, JSON.stringify(account))
      return { _tag: "SignedIn", steamId: token.id, expiresAt } satisfies SiteSignInResult
    })).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Couldn't sign in to ballestrecords.com", error).pipe(
          Effect.as<SiteSignInResult>({ _tag: "Failed", message: error.message })
        )
      )
    )

    const token = Effect.flatMap(
      read,
      Option.match({
        onNone: () => Effect.succeed(Option.none<string>()),
        onSome: ({ sealed }) => sealer.open(sealed)
      })
    )

    return SiteAccount.of({ state, signIn, signOut, token })
  })

  static readonly layer = Layer.effect(
    SiteAccount,
    Effect.gen(function*() {
      const { userData } = yield* DesktopEnvironment
      const path = yield* Path.Path
      return yield* SiteAccount.make(path.join(userData, "site-account.json"))
    })
  )
}
