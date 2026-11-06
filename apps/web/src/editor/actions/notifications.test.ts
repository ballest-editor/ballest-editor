import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { makeTestDisk } from "../../test/desktopBridge"
import { layerFor, s, untilTrue } from "../../test/editorActions"
import { useEditor } from "../store"
import { keepNotifications, showToasts } from "./notifications"

describe("notification actions", () => {
  it("presents each toast once, the ones waiting first, oldest first, and never a notification", () => {
    useEditor.setState({ toasts: [] })
    s().notify("info", "First", { kind: "mapSaved" })
    s().notify("info", "Second", { kind: "mapSaved" })
    const presented: Array<string> = []
    const stop = showToasts((notice) => presented.push(notice.title))
    assert.deepStrictEqual(presented, ["First", "Second"])
    assert.deepStrictEqual(s().toasts, [])

    s().notify("error", "Third")
    s().notify("info", "Big Loop was changed in the game", { kind: "changedInGame" })
    assert.deepStrictEqual(presented, ["First", "Second", "Third"])

    stop()
    s().notify("info", "Fourth", { kind: "mapSaved" })
    assert.lengthOf(presented, 3)
    assert.lengthOf(s().toasts, 1)
    useEditor.setState({ toasts: [] })
    s().clearNotifications()
  })

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
      s().notify("error", "Before the kept ones were read", { kind: "sidecarUnreadable" })
      const fiber = yield* Effect.forkChild(keepNotifications)
      yield* untilTrue(() => disk.notifications.length === 2)
      assert.deepStrictEqual(s().notifications.map((n) => n.title), [
        "Before the kept ones were read",
        kept.title
      ])
      assert.deepStrictEqual(disk.notifications, s().notifications)

      s().notify("info", "Big Loop was changed in the game", { kind: "changedInGame" })
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
