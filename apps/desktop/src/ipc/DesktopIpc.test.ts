import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { PING_CHANNEL } from "./channels"
import { DesktopIpc, type DesktopIpcHandleListener, type DesktopIpcMain } from "./DesktopIpc"
import { installDesktopIpcHandlers } from "./DesktopIpcHandlers"

/** Stands in for Electron's `ipcMain`: keeps the registered listeners so a test can invoke them. */
const fakeIpcMain = () => {
  const handlers = new Map<string, DesktopIpcHandleListener>()
  const ipcMain: DesktopIpcMain = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel)
  }
  const invoke = (channel: string, raw: unknown) => {
    const handler = handlers.get(channel)
    if (handler === undefined) return Effect.die(new Error(`no handler on ${channel}`))
    return Effect.tryPromise(() => handler({ sender: { id: 1 } }, raw))
  }
  return { handlers, ipcMain, invoke }
}

describe("DesktopIpc", () => {
  it.effect("ping round-trips a valid payload and rejects an invalid one", () =>
    Effect.gen(function*() {
      const fake = fakeIpcMain()
      yield* Effect.scoped(
        Effect.gen(function*() {
          yield* installDesktopIpcHandlers()
          assert.deepStrictEqual(yield* fake.invoke(PING_CHANNEL, { message: "hello" }), { message: "hello" })

          for (const invalid of [undefined, "hello", { message: 1 }, { message: "x".repeat(1025) }]) {
            const error = yield* Effect.flip(fake.invoke(PING_CHANNEL, invalid))
            assert.match(String(error.cause), /Expected|length/)
          }
        })
      ).pipe(Effect.provide(DesktopIpc.layer(fake.ipcMain)))

      // Closing the scope unregisters every handler.
      assert.strictEqual(fake.handlers.size, 0)
    }))

  it.effect("replaces a handler left on the channel", () =>
    Effect.gen(function*() {
      const fake = fakeIpcMain()
      fake.ipcMain.handle(PING_CHANNEL, () => Promise.resolve("stale"))
      yield* Effect.scoped(
        Effect.gen(function*() {
          yield* installDesktopIpcHandlers()
          assert.deepStrictEqual(yield* fake.invoke(PING_CHANNEL, { message: "fresh" }), { message: "fresh" })
        })
      ).pipe(Effect.provide(DesktopIpc.layer(fake.ipcMain)))
    }))
})
