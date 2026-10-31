import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseRelease } from "./version.ts"

describe("parseRelease", () => {
  it.effect("reads tags and bare versions", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* parseRelease("v0.2.0"), { version: "0.2.0", prerelease: false })
      assert.deepStrictEqual(yield* parseRelease("v0.2.0-rc.1"), { version: "0.2.0-rc.1", prerelease: true })
      assert.deepStrictEqual(yield* parseRelease("10.0.1-beta"), { version: "10.0.1-beta", prerelease: true })
    }))

  it.effect("rejects anything electron-builder wouldn't package as a release", () =>
    Effect.gen(function*() {
      for (
        const input of ["", "v", "0.2", "v0.2.0.1", "01.2.3", "v1.2.3+build", "v1.2.3-", "assets-8c6ffe51b6a794c2"]
      ) {
        const error = yield* Effect.flip(parseRelease(input))
        assert.strictEqual(error._tag, "InvalidVersion", input)
      }
    }))
})
