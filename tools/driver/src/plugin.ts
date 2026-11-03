import { Context, Effect, FileSystem, Layer, Semaphore } from "effect"
import { replyTo } from "./hostLog.ts"
import { logFrom, logSize } from "./logFile.ts"
import { type DriverError, fail, Slots } from "./slots.ts"

const TIMEOUT_MS = 15_000

/**
 * The driver plugin's channel (packages/ballest-driver): a command with a fresh nonce written to `command.json` in
 * the slot's own copy of the plugin, answered by one `reply <nonce> <json>` line in `host.log`.
 */
export class Plugin extends Context.Service<Plugin, {
  /** Runs one op in the plugin and returns its parsed reply (`{ ok, ... }`). */
  readonly call: (slot: number, op: string, args?: Record<string, unknown>) => Effect.Effect<unknown, DriverError>
}>()("ballest/driver/Plugin") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const slots = yield* Slots
    const lock = yield* Semaphore.make(1)
    let sequence = 0

    const callLocked = Effect.fn("Plugin.call")(function*(n: number, op: string, args: Record<string, unknown>) {
      const slot = slots.paths(n)
      const nonce = `${Date.now()}-${++sequence}`
      const before = yield* logSize(fs, slot.hostLog)
      const temp = `${slot.pluginCommand}.${process.pid}.${sequence}.tmp`
      yield* fs.writeFileString(temp, JSON.stringify({ ...args, nonce, op })).pipe(
        Effect.andThen(fs.rename(temp, slot.pluginCommand)),
        Effect.mapError((cause) => fail(`writing command.json: ${String(cause)}`))
      )
      const sent = Date.now()
      while (Date.now() - sent < TIMEOUT_MS) {
        yield* Effect.sleep("100 millis")
        const reply = replyTo(yield* logFrom(fs, slot.hostLog, before), nonce)
        if (reply !== null) {
          const parsed = yield* Effect.try({
            try: () => JSON.parse(reply) as unknown,
            catch: () => fail(`the plugin's reply isn't JSON: ${reply}`)
          })
          return parsed
        }
      }
      return yield* fail(
        `the driver plugin didn't answer ${op} in ${
          TIMEOUT_MS / 1000
        } s: is it installed in slot ${n} (setup copies it in) and running?`
      )
    })

    return Plugin.of({
      call: (n, op, args = {}) => lock.withPermits(1)(callLocked(n, op, args))
    })
  })

  static readonly layer = Layer.effect(Plugin, Plugin.make).pipe(Layer.provide(Slots.layer))
}
