import {
  type ListSitePrefabsPayload,
  SITE_URL,
  type SitePrefabPage,
  SitePrefabPage as SitePrefabPageSchema,
  type SiteUploadFields,
  type SiteUploadView
} from "@ballest/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

/** How main makes a request: `Electron.net.fetch` (main.ts), or a fake in tests. */
export type SiteFetch = (url: string, init: {
  readonly method: "GET" | "POST"
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string | FormData
  readonly signal: AbortSignal
}) => Promise<Response>

/** A request to the site that failed: no answer (`status` null), or one that wasn't a success, with its JSON. */
export class SiteError extends Schema.TaggedError<SiteError>()("SiteError", {
  path: Schema.String,
  status: Schema.NullOr(Schema.Int),
  body: Schema.Unknown,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return this.status === null ? `Couldn't reach ballestrecords.com.` : `ballestrecords.com answered ${this.status}.`
  }
}

/** `POST /api/auth/app/token`'s answer: the player's Steam ID and an app token, good for `expiresIn` seconds. */
export const SiteToken = Schema.Struct({ id: Schema.String, token: Schema.String, expiresIn: Schema.Finite })
export type SiteToken = typeof SiteToken.Type

const Uploaded = Schema.Struct({ slug: Schema.String })

const TIMEOUT = "20 seconds"
/** The most of the list one page holds (the site's own cap is 100). */
const PAGE = 50

const jsonOf = (response: Response): Promise<unknown> => response.json().catch(() => null)

/** A PNG data URL's bytes; null for anything else. */
const pngOf = (dataUrl: string): Uint8Array<ArrayBuffer> | null => {
  const prefix = "data:image/png;base64,"
  return dataUrl.startsWith(prefix) ? new Uint8Array(Buffer.from(dataUrl.slice(prefix.length), "base64")) : null
}

/**
 * ballestrecords.com's Prefab API (the site's ADR 0016 and 0017), reached from main so the page's `connect-src` stays
 * as it is. Reads need nothing; an upload carries the app token `SiteAccount` keeps, which never reaches the page.
 */
export class SiteClient extends Context.Service<SiteClient, {
  /** Where requests go: `SITE_URL`, or `BALLEST_RECORDS_URL`. */
  readonly base: string
  /** One page of the gallery, most favourited first. */
  readonly list: (payload: ListSitePrefabsPayload) => Effect.Effect<SitePrefabPage, SiteError>
  /** A prefab's thumbnail as a data URL; none when the site has none. */
  readonly thumb: (slug: string) => Effect.Effect<Option.Option<string>, SiteError>
  /** A prefab's file, as text. */
  readonly file: (slug: string) => Effect.Effect<string, SiteError>
  /** Trades a sign-in's code and the secret behind its challenge for an app token. */
  readonly trade: (code: string, verifier: string) => Effect.Effect<SiteToken, SiteError>
  /** Uploads a prefab's text under `token`, with the view picked for its picture; its slug. */
  readonly upload: (
    token: string,
    fields: SiteUploadFields,
    text: string,
    view: SiteUploadView
  ) => Effect.Effect<string, SiteError>
}>()("ballest/desktop/site/SiteClient") {
  static readonly make = (base: string, fetch: SiteFetch) => {
    const request = <A>(
      path: string,
      init: {
        readonly method: "GET" | "POST"
        readonly headers?: Record<string, string>
        readonly body?: string | FormData
      },
      read: (response: Response) => Promise<A>
    ) =>
      Effect.gen(function*() {
        const response = yield* Effect.tryPromise({
          try: (signal) => fetch(new URL(path, base).href, { headers: {}, ...init, signal }),
          catch: (cause) => new SiteError({ path, status: null, body: null, cause })
        })
        if (!response.ok) {
          const body = yield* Effect.promise(() => jsonOf(response))
          return yield* new SiteError({ path, status: response.status, body, cause: response.statusText })
        }
        return yield* Effect.tryPromise({
          try: () => read(response),
          catch: (cause) => new SiteError({ path, status: response.status, body: null, cause })
        })
      }).pipe(
        Effect.timeoutOrElse({
          duration: TIMEOUT,
          orElse: () => Effect.fail(new SiteError({ path, status: null, body: null, cause: "timed out" }))
        })
      )
    const decoded =
      <S extends Schema.Top & { readonly DecodingServices: never }>(path: string, schema: S) => (value: unknown) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError((cause) => new SiteError({ path, status: 200, body: null, cause }))
        )
    const prefabPath = (slug: string, rest: string) => `/api/prefabs/${encodeURIComponent(slug)}/${rest}`
    return SiteClient.of({
      base,
      list: ({ cursor, query }) => {
        const params = new URLSearchParams({ sort: "popular", limit: String(PAGE) })
        if (query.trim() !== "") params.set("q", query.trim())
        if (cursor !== null) params.set("cursor", String(cursor))
        const path = `/api/prefab-list?${params}`
        return request(path, { method: "GET" }, jsonOf).pipe(Effect.flatMap(decoded(path, SitePrefabPageSchema)))
      },
      thumb: (slug) =>
        request(prefabPath(slug, "thumb"), { method: "GET" }, async (response) => {
          const type = response.headers.get("content-type") ?? "image/png"
          const bytes = Buffer.from(await response.arrayBuffer())
          return Option.some(`data:${type};base64,${bytes.toString("base64")}`)
        }).pipe(Effect.catchIf((e) => e.status === 404, () => Effect.succeed(Option.none<string>()))),
      file: (slug) => request(prefabPath(slug, "file"), { method: "GET" }, (response) => response.text()),
      trade: (code, verifier) =>
        request("/api/auth/app/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier })
        }, jsonOf).pipe(Effect.flatMap(decoded("/api/auth/app/token", SiteToken))),
      upload: (token, { description, name, tags }, text, view) => {
        const form = new FormData()
        form.set("name", name)
        form.set("description", description)
        for (const tag of tags) form.append("tags", tag)
        form.set("file", new Blob([text], { type: "application/json" }), "prefab.json")
        if (view !== null) {
          form.set("angle", JSON.stringify(view.angle))
          const png = view.picture === null ? null : pngOf(view.picture)
          if (png !== null) form.set("picture", new Blob([png], { type: "image/png" }), "picture.png")
        }
        return request(
          "/api/prefabs",
          { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form },
          jsonOf
        )
          .pipe(Effect.flatMap(decoded("/api/prefabs", Uploaded)), Effect.map(({ slug }) => slug))
      }
    })
  }

  static readonly layer = (fetch: SiteFetch) =>
    Layer.effect(
      SiteClient,
      Effect.gen(function*() {
        const override = yield* Config.String("BALLEST_RECORDS_URL").pipe(
          Config.option,
          Effect.orElseSucceed(Option.none)
        )
        return SiteClient.make(Option.getOrElse(override, () => SITE_URL), fetch)
      })
    )
}
