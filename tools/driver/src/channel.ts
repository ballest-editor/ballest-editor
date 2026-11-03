import { Context, Effect, FileSystem, Layer, Semaphore } from "effect"
import { replies } from "./hostLog.ts"
import { logFrom, logSize } from "./logFile.ts"
import { type DriverError, fail, Slots } from "./slots.ts"

const READ_TIMEOUT_MS = 8_000
const QUIET_MS = 400

/**
 * The host's file test channel (docs/DRIVER.md § Transport): one command written to `test_command.txt` next to
 * `host.log`, which the host reads twice a second and deletes; its replies are the `test: ` lines the log gains
 * after that. A reply is complete once the log has stayed quiet for a moment.
 */
export class Channel extends Context.Service<Channel, {
  /** Sends one command and returns its reply lines (empty when the command answered nothing in time). */
  readonly send: (
    slot: number,
    command: string,
    timeoutMs?: number
  ) => Effect.Effect<ReadonlyArray<string>, DriverError>
}>()("ballest/driver/Channel") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const slots = yield* Slots

    // One command at a time per slot: the host reads one file, and MCP clients call tools concurrently.
    const locks = new Map<number, Semaphore.Semaphore>()
    const lockOf = (n: number) =>
      Effect.gen(function*() {
        const found = locks.get(n)
        if (found !== undefined) return found
        const made = yield* Semaphore.make(1)
        locks.set(n, made)
        return made
      })
    let sequence = 0

    const sendLocked = Effect.fn("Channel.send")(function*(n: number, command: string, timeoutMs: number) {
      const slot = slots.paths(n)
      const line = command.trim()
      if (line.length === 0) return yield* fail("an empty command")
      if (line.includes("\n")) {
        return yield* fail("one command at a time (the host's `seq a || b` runs several on one frame)")
      }
      const before = yield* logSize(fs, slot.hostLog)
      const temp = `${slot.commandFile}.${process.pid}.${++sequence}.tmp`
      yield* fs.writeFileString(temp, `${line}\n`).pipe(
        Effect.andThen(fs.rename(temp, slot.commandFile)),
        Effect.mapError((cause) => fail(`writing the command: ${String(cause)}`))
      )
      // The host deletes the file when it has read it.
      const sent = Date.now()
      while (yield* fs.exists(slot.commandFile).pipe(Effect.orElseSucceed(() => false))) {
        if (Date.now() - sent > READ_TIMEOUT_MS) {
          yield* fs.remove(slot.commandFile, { force: true }).pipe(Effect.ignore)
          return yield* fail(
            `slot ${n} didn't read the command in ${READ_TIMEOUT_MS / 1000} s: is it running and ready?`
          )
        }
        yield* Effect.sleep("100 millis")
      }
      // Then the replies: wait for the first, then for the log to go quiet.
      let last = before
      let quietSince = Date.now()
      let lines: ReadonlyArray<string> = []
      while (Date.now() - sent < timeoutMs) {
        yield* Effect.sleep("100 millis")
        const now = yield* logSize(fs, slot.hostLog)
        if (now !== last) {
          last = now
          quietSince = Date.now()
          lines = replies(yield* logFrom(fs, slot.hostLog, before))
        } else if (lines.length > 0 && Date.now() - quietSince >= QUIET_MS) {
          break
        }
      }
      return lines
    })

    const send = (n: number, command: string, timeoutMs = 15_000) =>
      lockOf(n).pipe(Effect.flatMap((lock) => lock.withPermits(1)(sendLocked(n, command, timeoutMs))))

    return Channel.of({ send })
  })

  static readonly layer = Layer.effect(Channel, Channel.make).pipe(Layer.provide(Slots.layer))
}
