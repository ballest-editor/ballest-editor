import { InvokeChannels } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { vi } from "vitest"
import { DesktopIpc, makeIpcMethod } from "./DesktopIpc"
import { fakeIpcMain, opened, readSettings, recoloured, updateCalls, withHandlers } from "./handlersHarness"
import { pingHandlers } from "./methods/ping"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

describe("DesktopIpc", () => {
  it.effect("registers every method, and ping round-trips a valid payload and rejects an invalid one", () =>
    Effect.gen(function*() {
      const ipc = yield* withHandlers(({ fake }) =>
        Effect.gen(function*() {
          // Every method in the table has its handler, on its channel.
          assert.sameMembers([...fake.handlers.keys()], Object.values(InvokeChannels))
          assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.ping, { message: "hello" }), { message: "hello" })

          for (const invalid of [undefined, "hello", { message: 1 }, { message: "x".repeat(1025) }]) {
            const error = yield* Effect.flip(fake.invoke(InvokeChannels.ping, invalid))
            assert.match(String(error.cause), /Expected|length/)
          }
        })
      )
      // Closing the scope unregisters every handler.
      assert.strictEqual(ipc.handlers.size, 0)
    }))

  it.effect("replaces a handler left on the channel", () =>
    Effect.gen(function*() {
      const fake = fakeIpcMain()
      fake.ipcMain.handle(InvokeChannels.ping, () => Promise.resolve("stale"))
      yield* Effect.scoped(
        Effect.gen(function*() {
          yield* (yield* DesktopIpc).handle(makeIpcMethod("ping", pingHandlers.ping))
          assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.ping, { message: "fresh" }), { message: "fresh" })
        })
      ).pipe(Effect.provide(DesktopIpc.layer(fake.ipcMain)))
    }))

  it.effect("opens only web links externally", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
        assert.isTrue(yield* fake.invoke(InvokeChannels.openExternal, { url: "https://example.com/a" }))
        assert.isFalse(yield* fake.invoke(InvokeChannels.openExternal, { url: "file:///etc/passwd" }))
        assert.deepStrictEqual(opened, ["https://example.com/a"])
      })
    ))

  it.effect("recolours the sender's window to the page theme", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(InvokeChannels.setWindowTheme, { dark: false })
        assert.deepStrictEqual(recoloured, [[1, {
          overlay: { color: "#01000000", symbolColor: "#09090b", height: 40 },
          background: "#ffffff"
        }]])
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.setWindowTheme, { dark: "yes" }))).cause),
          /boolean/
        )
      })
    ))

  it.effect("asks Save / Don't save / Cancel in a box modal to the sender's window", () =>
    withHandlers(({ fake, dialogs }) =>
      Effect.gen(function*() {
        const prompt = { message: "Save the changes to Big Loop before closing?", detail: "Or lose them." }
        dialogs.buttons.push(0, 1, 2)
        const choices = yield* Effect.forEach([1, 2, 3, 4], () => fake.invoke(InvokeChannels.confirmUnsaved, prompt))
        // the fourth box was closed with Escape
        assert.deepStrictEqual(choices, ["save", "discard", "cancel", "cancel"])
        assert.deepInclude(dialogs.messages[0], {
          owner: 1,
          ...prompt,
          buttons: ["Save", "Don't save", "Cancel"],
          cancelId: 2
        })
      })
    ))

  it.effect("reports the update state and passes on check, download and install", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        assert.deepInclude(yield* fake.invoke(InvokeChannels.getUpdateState), {
          status: "available",
          availableVersion: "0.2.1"
        })
        assert.isUndefined(yield* fake.invoke(InvokeChannels.checkForUpdates))
        assert.isUndefined(yield* fake.invoke(InvokeChannels.downloadUpdate))
        assert.isUndefined(yield* fake.invoke(InvokeChannels.installUpdate))
        assert.deepStrictEqual(updateCalls, { check: 1, download: 1, install: 1 })
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.downloadUpdate, { now: true }))).cause),
          /undefined/
        )
      })
    ))

  it.effect("keeps the Game link's last result and the muted notification kinds in desktop-settings.json", () =>
    withHandlers(({ fake, dir }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.gameLinkMemory), { last: null, muted: [] })
        const last = { game: true, pluginManager: false }
        assert.isUndefined(yield* fake.invoke(InvokeChannels.rememberGameLink, last))
        assert.deepStrictEqual(
          yield* fake.invoke(InvokeChannels.muteNotifications, { kind: "pluginManagerMissing" }),
          [
            "pluginManagerMissing"
          ]
        )
        // muting twice keeps one
        assert.deepStrictEqual(
          yield* fake.invoke(InvokeChannels.muteNotifications, { kind: "pluginManagerMissing" }),
          [
            "pluginManagerMissing"
          ]
        )
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.gameLinkMemory), {
          last,
          muted: ["pluginManagerMissing"]
        })
        assert.deepInclude(yield* readSettings(fs, dir), {
          gameLink: { last },
          notifications: { muted: ["pluginManagerMissing"] }
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.rememberGameLink, { game: "yes" }))).cause),
          /Expected/
        )
      })
    ))

  it.effect("keeps the notifications in notifications.json, dropping entries it can't read", () =>
    withHandlers(({ fake, dir }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const file = path.join(dir, "notifications.json")
        const record = {
          id: "n1",
          kind: "mapExported",
          level: "info",
          title: "Exported Big Loop to the game's maps folder",
          body: null,
          at: "2026-10-31T12:00:00.000Z",
          read: false,
          persistent: false,
          resolvedAt: null,
          actions: [{ label: "Reveal", command: { _tag: "RevealGamePath", which: "mapsFolder" } }]
        }
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.loadNotifications), [])
        assert.isUndefined(yield* fake.invoke(InvokeChannels.saveNotifications, { records: [record] }))
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.loadNotifications), [record])

        // A newer version's action, and a broken entry, are dropped; the rest survive.
        const newer = { ...record, id: "n2", actions: [{ label: "Re-import", command: { _tag: "Later" } }] }
        yield* fs.writeFileString(file, JSON.stringify({ formatVersion: 1, notifications: [newer, 3, record] }))
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.loadNotifications), [record])
        yield* fs.writeFileString(file, "{ not json")
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.loadNotifications), [])

        const tooMany = Array.from({ length: 101 }, (_, i) => ({ ...record, id: `n${i}` }))
        const error = yield* Effect.flip(fake.invoke(InvokeChannels.saveNotifications, { records: tooMany }))
        assert.match(String(error.cause), /length/)
      })
    ))
})
