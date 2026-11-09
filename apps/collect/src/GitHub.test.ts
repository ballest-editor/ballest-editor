import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { generateKeyPairSync, verify } from "node:crypto"
import { GitHub, signAppJwt } from "./GitHub"
import { testConfig } from "./test/fakes"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString()

const decodePart = (part: string | undefined): unknown => JSON.parse(Buffer.from(part ?? "", "base64url").toString())

describe("signAppJwt", () => {
  it("signs RS256 claims for the app that the public key verifies", () => {
    const jwt = signAppJwt("123456", pem, 1_800_000_000)
    const [header, claims, signature] = jwt.split(".")
    assert.deepStrictEqual(decodePart(header), { alg: "RS256", typ: "JWT" })
    assert.deepStrictEqual(decodePart(claims), { iss: "123456", iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540 })
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature ?? "", "base64url")))
      .toBe(true)
  })

  it("takes a key whose newlines were pasted as \\n", () => {
    const jwt = signAppJwt("1", pem.replace(/\n/g, "\\n"), 0)
    const [header, claims, signature] = jwt.split(".")
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature ?? "", "base64url")))
      .toBe(true)
  })
})

describe("GitHub", () => {
  it.effect("exchanges the app's JWT for an installation token once, then files issues with it", () =>
    Effect.gen(function*() {
      const calls: Array<{ url: string; authorization: string | null; body: unknown }> = []
      const fetch: typeof globalThis.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString()
        calls.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
          body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined
        })
        return Promise.resolve(Response.json(
          url.endsWith("/access_tokens")
            ? { token: "ghs_installation", expires_at: "2099-01-01T00:00:00Z" }
            : {
              number: calls.length,
              html_url: `https://github.com/ballest-editor/ballest-editor/issues/${calls.length}`
            },
          { status: 201 }
        ))
      }
      const github = yield* GitHub.make(fetch).pipe(
        Effect.provide(testConfig({
          GITHUB_APP_ID: "123456",
          GITHUB_APP_INSTALLATION_ID: "987",
          GITHUB_APP_PRIVATE_KEY: pem
        }))
      )
      const issue = { title: "[Feedback] x", body: "y", labels: ["feedback"] }
      assert.deepStrictEqual(yield* github.createIssue(issue), {
        number: 2,
        url: "https://github.com/ballest-editor/ballest-editor/issues/2"
      })
      yield* github.createIssue(issue)

      assert.deepStrictEqual(calls.map((call) => call.url), [
        "https://api.github.com/app/installations/987/access_tokens",
        "https://api.github.com/repos/ballest-editor/ballest-editor/issues",
        "https://api.github.com/repos/ballest-editor/ballest-editor/issues"
      ])
      assert.match(calls[0]?.authorization ?? "", /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
      assert.strictEqual(calls[1]?.authorization, "token ghs_installation")
      assert.deepStrictEqual(calls[1]?.body, issue)
    }))

  it.effect("fails with GitHubError when GitHub refuses", () =>
    Effect.gen(function*() {
      const fetch: typeof globalThis.fetch = () =>
        Promise.resolve(Response.json({ message: "Bad credentials" }, { status: 401 }))
      const github = yield* GitHub.make(fetch).pipe(
        Effect.provide(testConfig({ GITHUB_APP_ID: "1", GITHUB_APP_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: pem }))
      )
      const error = yield* Effect.flip(github.createIssue({ title: "t", body: "b", labels: [] }))
      assert.strictEqual(error._tag, "GitHubError")
      assert.include(error.message, "401")
    }))
})
