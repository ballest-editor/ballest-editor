import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { MaterialLibrary } from "./MaterialLibrary"

describe("MaterialLibrary", () => {
  it.effect("falls back to an empty table when the file is missing", () =>
    Effect.gen(function*() {
      const library = MaterialLibrary.make(() =>
        Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") })
      )
      assert.strictEqual((yield* library.load).materials.size, 0)
    }))
})
