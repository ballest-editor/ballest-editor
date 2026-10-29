import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { MaterialLibrary } from "./MaterialLibrary"

describe("MaterialLibrary", () => {
  it.effect("falls back to an empty table when the file is missing", () =>
    Effect.gen(function*() {
      const library = MaterialLibrary.make(() =>
        Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") })
      )
      const { table, paint } = yield* library.load
      assert.strictEqual(table.materials.size, 0)
      assert.strictEqual(paint.length, 0)
    }))
})
