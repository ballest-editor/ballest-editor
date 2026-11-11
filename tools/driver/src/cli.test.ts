import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { describeTools, parseParams, runTool } from "./cli.ts"
import { DriverError, fail } from "./slots.ts"
import { DriverToolkit } from "./tools.ts"

const Echo = Tool.make("echo", {
  description: "Says it back.",
  parameters: Schema.Struct({ slot: Schema.optional(Schema.Finite), word: Schema.String }),
  success: Schema.Struct({ said: Schema.String }),
  failure: DriverError
})
const Boom = Tool.make("boom", {
  description: "Always fails.",
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failure: DriverError
})
const Test = Toolkit.make(Echo, Boom)
const handlers = Test.toLayer({
  echo: ({ slot, word }) => Effect.succeed({ said: `${slot ?? 1}:${word}` }),
  boom: () => Effect.fail(fail("Steam isn't running"))
})

const message = <A, R>(effect: Effect.Effect<A, DriverError, R>) =>
  effect.pipe(Effect.flip, Effect.map((e) => e.message))

describe("parseParams", () => {
  it.effect("reads a JSON object, and nothing as {}", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* parseParams("{\"slot\":2}"), { slot: 2 })
      assert.deepStrictEqual(yield* parseParams(undefined), {})
      assert.deepStrictEqual(yield* parseParams("  "), {})
    }))

  it.effect("refuses what isn't a JSON object", () =>
    Effect.gen(function*() {
      assert.match(yield* message(parseParams("{\"slot\":")), /^the parameters aren't valid JSON/)
      assert.match(yield* message(parseParams("[1]")), /^the parameters must be a JSON object/)
      assert.match(yield* message(parseParams("null")), /^the parameters must be a JSON object/)
    }))
})

describe("runTool", () => {
  it.effect("runs the tool's handler and returns its encoded result", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* runTool(Test, "echo", { slot: 3, word: "hi" }), { said: "3:hi" })
    }).pipe(Effect.provide(handlers)))

  it.effect("decodes the parameters with the tool's schema", () =>
    Effect.gen(function*() {
      assert.match(yield* message(runTool(Test, "echo", { word: 1 })), /Invalid parameters for tool 'echo'/)
    }).pipe(Effect.provide(handlers)))

  it.effect("names a tool that doesn't exist, and passes a handler's failure on", () =>
    Effect.gen(function*() {
      assert.strictEqual(yield* message(runTool(Test, "nope", {})), "no tool nope; `pnpm driver tools` lists them")
      assert.strictEqual(yield* message(runTool(Test, "boom", {})), "Steam isn't running")
    }).pipe(Effect.provide(handlers)))
})

describe("describeTools", () => {
  it("lists each tool with its parameters, optional ones marked", () => {
    assert.strictEqual(
      describeTools(Test.tools),
      "echo {slot?: number, word: string}\n  Says it back.\n\nboom {}\n  Always fails."
    )
    const driver = describeTools(DriverToolkit.tools)
    assert.include(driver, "slot_start {slot?: number, mode?: \"headless\" | \"window\"}")
    assert.include(driver, "probe_map {slot?: number, pieces: object[]}")
  })
})
