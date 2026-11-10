import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { WindowStage } from "./WindowStage"

describe("WindowStage", () => {
  it.effect("showing the editor waits until the window has grown into it, and it grows once", () =>
    Effect.gen(function*() {
      const stage = yield* WindowStage.make
      const steps: Array<string> = []
      const growing = yield* Effect.forkChild(stage.whenEditorShown(Effect.sync(() => void steps.push("grown"))))
      const shown = yield* Effect.forkChild(
        stage.showEditor.pipe(Effect.tap(() => Effect.sync(() => steps.push("shown"))))
      )
      yield* Fiber.join(shown)
      yield* Fiber.join(growing)
      // asked again, as a second pick would: nothing grows twice, and nothing waits
      yield* stage.showEditor
      assert.deepStrictEqual(steps, ["grown", "shown"])
    }))
})
