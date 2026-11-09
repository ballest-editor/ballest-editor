import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { scanForSecrets, secretsIn } from "./secretScan.ts"

// Built at runtime, so this file never holds a credential's shape itself.
const token = ["ghp", "_", "a".repeat(36)].join("")
const key = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ")
const url = ["postgres", "://collect_writer:hunter2@ep-x.neon.tech/db"].join("")

describe("secretsIn", () => {
  it("finds each kind of secret", () => {
    assert.deepStrictEqual(secretsIn(`const t = "${token}"`), ["a GitHub token"])
    assert.deepStrictEqual(secretsIn(`${key}\nMIIE...`), ["a private key"])
    assert.deepStrictEqual(secretsIn(`fetch("${url}")`), ["a database URL with a password"])
    assert.deepStrictEqual(secretsIn("process.env.GITHUB_APP_PRIVATE_KEY"), ["a collect endpoint secret's name"])
  })

  it("leaves ordinary code alone", () => {
    for (const text of ["const ghp_short = 1", "-----BEGIN CERTIFICATE-----", "postgres://localhost/db", "IP_HASH"]) {
      assert.deepStrictEqual(secretsIn(text), [], text)
    }
  })
})

describe("scanForSecrets", () => {
  it.effect("names the text files that hold one and skips binary ones", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped()
      yield* fs.makeDirectory(path.join(dir, "web", "assets"), { recursive: true })
      yield* fs.writeFileString(path.join(dir, "main.cjs"), `const t = "${token}"`)
      yield* fs.writeFileString(path.join(dir, "web", "index.html"), "<html></html>")
      yield* fs.writeFileString(path.join(dir, "web", "assets", "mesh.glb"), token)
      assert.deepStrictEqual(yield* scanForSecrets(dir), ["main.cjs holds a GitHub token"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
