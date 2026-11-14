import { InvokeChannels, SiteAccount, SitePrefabPage, SiteSignInResult, SiteUploadResult } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, FileSystem, Schema } from "effect"
import { createHash } from "node:crypto"
import { keystore, opened, siteAnswers, siteRequests, withHandlers } from "./handlersHarness"

const prefab = {
  slug: "loop-de-loop",
  name: "Loop de loop",
  description: "A loop.",
  tags: ["Loop"],
  uploader: { steamId: "76561198000000001", name: "Robin" },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-02T00:00:00.000Z",
  pieces: 12,
  bytes: 3000,
  favorites: 4,
  size: null,
  thumb: "/api/prefabs/loop-de-loop/thumb?v=1",
  file: "/api/prefabs/loop-de-loop/file"
}
const prefabText = `{"format":"BallestPrefab","version":1,"items":[{"class":"/Game/A.A_C"},{"class":"/Game/B.B_C"}]}`
const answer = (path: string, ...answers: Array<{ readonly status: number; readonly body?: unknown }>) =>
  void siteAnswers.set(path, [...(siteAnswers.get(path) ?? []), ...answers])
const sent = (path: string) => siteRequests.filter((r) => new URL(r.url).pathname === path)
const token = { id: "76561198000000001", token: "76561198000000001.1762000000.app.sig", expiresIn: 30 * 86400 }

/** Signs in as a browser would: waits for the site's sign-in to open, then comes back to the loopback with `back`. */
const signIn = (
  fake: { readonly invoke: (channel: string) => Effect.Effect<unknown, unknown> },
  back: "code" | "deny"
) =>
  Effect.gen(function*() {
    const before = opened.length
    const fiber = yield* Effect.forkChild(
      fake.invoke(InvokeChannels.signInToSite).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SiteSignInResult)))
    )
    while (opened.length === before) yield* Effect.sleep("5 millis")
    const asked = new URL(opened.at(-1) ?? "")
    const redirect = new URL(asked.searchParams.get("redirect_uri") ?? "")
    const state = asked.searchParams.get("state") ?? ""
    // another page's request on the port is turned away, and doesn't end the sign-in
    assert.strictEqual((yield* Effect.promise(() => fetch(`${redirect.href}?state=other&code=x`))).status, 404)
    redirect.search = new URLSearchParams(
      back === "code" ? { code: "the-code", state } : { error: "access_denied", state }
    )
      .toString()
    const page = yield* Effect.promise(() => fetch(redirect).then((r) => r.text()))
    return { asked, page, result: yield* Fiber.join(fiber) }
  })

// the sign-ins wait on a real socket, so they run on the live clock
describe("ballestrecords.com over IPC", () => {
  it.effect("lists a page of the gallery, most favourited first, with the search and the cursor", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        answer("/api/prefab-list", { status: 200, body: { total: 51, next: 50, prefabs: [prefab] } })
        const page = yield* fake.invokeAs(SitePrefabPage, InvokeChannels.listSitePrefabs, {
          query: " loop ",
          cursor: 50
        })
        assert.deepStrictEqual(page.prefabs.map((p) => [p.slug, p.pieces, p.uploader.name]), [[
          "loop-de-loop",
          12,
          "Robin"
        ]])
        assert.strictEqual(page.next, 50)
        const url = new URL(sent("/api/prefab-list").at(-1)?.url ?? "")
        assert.deepStrictEqual(Object.fromEntries(url.searchParams), {
          sort: "popular",
          limit: "50",
          q: "loop",
          cursor: "50"
        })
      })
    ))

  it.effect("reads a prefab's file and thumbnail, and refuses a slug that isn't one", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        answer("/api/prefabs/loop-de-loop/file", { status: 200, body: prefabText })
        answer("/api/prefabs/loop-de-loop/thumb", { status: 200, body: new Uint8Array([1, 2, 3]).buffer })
        assert.deepStrictEqual(
          yield* fake.invoke(InvokeChannels.readSitePrefab, { slug: "loop-de-loop" }),
          { text: prefabText }
        )
        assert.strictEqual(
          yield* fake.invoke(InvokeChannels.readSitePrefabThumb, { slug: "loop-de-loop" }),
          "data:image/webp;base64,AQID"
        )
        assert.isNull(yield* fake.invoke(InvokeChannels.readSitePrefabThumb, { slug: "loop-de-loop" }))
        const asked = siteRequests.length
        const exit = yield* Effect.exit(fake.invoke(InvokeChannels.readSitePrefab, { slug: "../me" }))
        assert.isTrue(exit._tag === "Failure")
        assert.strictEqual(siteRequests.length, asked)
      })
    ))

  it.live("signs in through the browser with PKCE, keeps the token, and signs out", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), { _tag: "SignedOut" })
        answer("/api/auth/app/token", { status: 200, body: token })
        const { asked, page, result } = yield* signIn(fake, "code")
        assert.strictEqual(asked.origin + asked.pathname, "https://records.test/api/auth/app")
        assert.strictEqual(asked.searchParams.get("code_challenge_method"), "S256")
        assert.match(asked.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
        assert.include(page, "Signed in")
        assert.deepInclude(result, { _tag: "SignedIn", steamId: token.id, remembered: true })

        const body = sent("/api/auth/app/token").at(-1)?.body
        const trade = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
          code: Schema.String,
          code_verifier: Schema.String
        })))(typeof body === "string" ? body : "")
        assert.strictEqual(trade.code, "the-code")
        assert.strictEqual(
          createHash("sha256").update(trade.code_verifier).digest("base64url"),
          asked.searchParams.get("code_challenge")
        )
        assert.deepInclude(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), { _tag: "SignedIn" })

        yield* fake.invoke(InvokeChannels.signOutOfSite)
        assert.deepStrictEqual(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), { _tag: "SignedOut" })
      })
    ))

  it.live("says when the player turned the sign-in down", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        const { page, result } = yield* signIn(fake, "deny")
        assert.deepStrictEqual(result, { _tag: "Cancelled" })
        assert.include(page, "cancelled")
        assert.deepStrictEqual(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), { _tag: "SignedOut" })
      })
    ))

  it.live("keeps the token in memory only, never on disk, when the OS has no keystore", () =>
    withHandlers(({ dir, fake }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        keystore.available = false
        answer("/api/auth/app/token", { status: 200, body: token })
        const { result } = yield* signIn(fake, "code")
        assert.deepInclude(result, { _tag: "SignedIn", steamId: token.id, remembered: false })
        assert.deepInclude(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), {
          _tag: "SignedIn",
          remembered: false
        })
        assert.isFalse(yield* fs.exists(`${dir}/userData/site-account.json`))

        yield* fake.invoke(InvokeChannels.writePrefab, {
          tier: "project",
          name: "loop",
          text: prefabText,
          replace: false
        })
        answer("/api/prefabs", { status: 201, body: { slug: "my-loop" } })
        yield* fake.invoke(InvokeChannels.uploadPrefab, {
          prefab: { tier: "project", name: "loop" },
          fields: { name: "My loop", description: "", tags: [] },
          view: null
        })
        assert.strictEqual(sent("/api/prefabs").at(-1)?.headers["authorization"], `Bearer ${token.token}`)

        yield* fake.invoke(InvokeChannels.signOutOfSite)
        assert.deepStrictEqual(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), { _tag: "SignedOut" })
      }).pipe(Effect.ensuring(Effect.sync(() => {
        keystore.available = true
        siteRequests.length = 0
      })))
    ))

  it.live("uploads a tier's prefab under the token, and tells each refusal apart", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(InvokeChannels.writePrefab, {
          tier: "project",
          name: "loop",
          text: prefabText,
          replace: false
        })
        const upload = {
          prefab: { tier: "project", name: "loop" },
          fields: { name: "My loop", description: "", tags: ["Loop"] },
          view: {
            angle: { from: [0.6, 0.4, 0.7], zoom: 1.5, pan: [0, 0.1, 0] },
            picture: "data:image/png;base64,iVBORw0KGgo="
          }
        }
        const uploading = fake.invokeAs(SiteUploadResult, InvokeChannels.uploadPrefab, upload)
        assert.deepStrictEqual(yield* uploading, { _tag: "SignedOut" })
        assert.lengthOf(sent("/api/prefabs"), 0)

        answer("/api/auth/app/token", { status: 200, body: token })
        yield* signIn(fake, "code")
        answer(
          "/api/prefabs",
          { status: 201, body: { slug: "my-loop" } },
          { status: 429, body: { error: "that's your uploads", nextAt: "2026-11-12T01:00:00.000Z" } },
          { status: 400, body: { problems: ["Give it a name."] } },
          { status: 401, body: { error: "sign in" } }
        )
        assert.deepStrictEqual(yield* uploading, {
          _tag: "Uploaded",
          slug: "my-loop",
          url: "https://records.test/prefab/my-loop"
        })
        const request = sent("/api/prefabs").at(-1)
        assert.strictEqual(request?.headers["authorization"], `Bearer ${token.token}`)
        const form = request?.body
        assert.instanceOf(form, FormData)
        if (form instanceof FormData) {
          assert.strictEqual(form.get("name"), "My loop")
          assert.deepStrictEqual(form.getAll("tags"), ["Loop"])
          const angle = form.get("angle")
          assert.deepStrictEqual(typeof angle === "string" ? JSON.parse(angle) : null, upload.view.angle)
          const picture = form.get("picture")
          assert.deepStrictEqual(
            picture instanceof Blob ? [...new Uint8Array(yield* Effect.promise(() => picture.arrayBuffer()))] : null,
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
          )
          const file = form.get("file")
          assert.strictEqual(file instanceof Blob ? yield* Effect.promise(() => file.text()) : null, prefabText)
        }
        assert.deepStrictEqual(yield* uploading, { _tag: "Limited", nextAt: "2026-11-12T01:00:00.000Z" })
        assert.deepStrictEqual(yield* uploading, { _tag: "Refused", problems: ["Give it a name."] })
        // a token the site no longer takes is forgotten
        assert.deepStrictEqual(yield* uploading, { _tag: "SignedOut" })
        assert.deepStrictEqual(yield* fake.invokeAs(SiteAccount, InvokeChannels.siteAccount), { _tag: "SignedOut" })
      })
    ))
})
