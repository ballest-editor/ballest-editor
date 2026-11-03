import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { makeTestDisk } from "../../test/desktopBridge"
import { layerFor, s, untilTrue } from "../../test/editorActions"
import { followUpdateState } from "./startup"

/** Waits, in real time, for the store's update state to reach `status`: the bridge answers with promises. */
const untilUpdate = (status: string) => untilTrue(() => s().update?.status === status)

describe("update actions", () => {
  it.effect("follow the desktop updater's state into the store, and stop when interrupted", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(followUpdateState)
      yield* untilUpdate("idle")
      assert.deepInclude(s().update, { status: "idle", currentVersion: "0.2.0" })
      disk.updater.push({
        ...disk.updater.state,
        status: "downloading",
        availableVersion: "0.2.1",
        downloadPercent: 40
      })
      yield* untilUpdate("downloading")
      assert.deepInclude(s().update, { status: "downloading", downloadPercent: 40 })
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(disk.updater.listeners.size, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
