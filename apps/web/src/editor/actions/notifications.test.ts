import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { makeTestDisk } from "../../test/desktopBridge"
import { layerFor, s, untilTrue } from "../../test/editorActions"
import { keepNotifications } from "./notifications"

describe("notification actions", () => {
  it.effect("keeps the notifications across a restart: the kept ones under this session's, then every change", () => {
    const disk = makeTestDisk()
    const kept = {
      id: "kept-1",
      kind: "mapExported",
      level: "info" as const,
      title: "Exported Big Loop to the game's maps folder",
      body: null,
      at: "2026-10-30T12:00:00.000Z",
      read: true,
      persistent: false,
      resolvedAt: null,
      actions: [{ label: "Reveal", command: { _tag: "RevealGamePath" as const, which: "mapsFolder" as const } }]
    }
    disk.notifications = [kept]
    return Effect.gen(function*() {
      s().clearNotifications()
      s().notify("error", "Before the kept ones were read")
      const fiber = yield* Effect.forkChild(keepNotifications)
      yield* untilTrue(() => disk.notifications.length === 2)
      assert.deepStrictEqual(s().notifications.map((n) => n.title), [
        "Before the kept ones were read",
        kept.title
      ])
      assert.deepStrictEqual(disk.notifications, s().notifications)

      s().notify("info", "Saved Big Loop", { kind: "mapSaved" })
      yield* untilTrue(() => disk.notifications.length === 3)
      s().markNotificationsRead()
      yield* untilTrue(() => disk.notifications.every((n) => n.read))
      yield* Fiber.interrupt(fiber)
      s().clearNotifications()
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)))
      // stopped: the clear isn't written
      assert.strictEqual(disk.notifications.length, 3)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
