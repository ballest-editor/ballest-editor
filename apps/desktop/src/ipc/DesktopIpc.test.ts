import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Path } from "effect"
import { vi } from "vitest"
import { ElectronDialog, type FileDialogOptions } from "../electron/ElectronDialog"
import { ElectronShell, parseExternalUrl } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { MapFiles } from "../files/MapFiles"
import { DesktopSettings } from "../settings/DesktopSettings"
import { DesktopUpdates } from "../updates/DesktopUpdates"
import {
  DOWNLOAD_UPDATE_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OPEN_MAP_CHANNEL,
  PING_CHANNEL,
  READ_MAP_CHANNEL,
  RECENT_MAPS_CHANNEL,
  SAVE_MAP_CHANNEL,
  SET_WINDOW_THEME_CHANNEL,
  WRITE_MAP_CHANNEL
} from "./channels"
import { DesktopIpc, type DesktopIpcHandleListener, type DesktopIpcMain } from "./DesktopIpc"
import { installDesktopIpcHandlers } from "./DesktopIpcHandlers"
import { ping } from "./methods/ping"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

/** Stands in for Electron's `ipcMain`: keeps the registered listeners so a test can invoke them. */
const fakeIpcMain = () => {
  const handlers = new Map<string, DesktopIpcHandleListener>()
  const ipcMain: DesktopIpcMain = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel)
  }
  const invoke = (channel: string, raw?: unknown) => {
    const handler = handlers.get(channel)
    if (handler === undefined) return Effect.die(new Error(`no handler on ${channel}`))
    return Effect.tryPromise(() => handler({ sender: { id: 1 } }, raw))
  }
  return { handlers, ipcMain, invoke }
}

/** Dialogs that answer from a queue (a path, or null for cancel) and record what they were asked. */
const fakeDialogs = () => {
  const answers: Array<string | null> = []
  const asked: Array<FileDialogOptions & { readonly kind: "open" | "save" }> = []
  const answer = (kind: "open" | "save") => (options: FileDialogOptions) =>
    Effect.sync(() => {
      asked.push({ ...options, kind })
      return Option.fromNullishOr(answers.shift())
    })
  const layer = Layer.succeed(
    ElectronDialog,
    ElectronDialog.of({ showErrorBox: () => Effect.void, showOpenFile: answer("open"), showSaveFile: answer("save") })
  )
  return { answers, asked, layer }
}

const opened: Array<string> = []
const shellLayer = Layer.succeed(
  ElectronShell,
  ElectronShell.of({
    openExternal: (url) =>
      Effect.sync(() =>
        Option.match(parseExternalUrl(url), {
          onNone: () => false,
          onSome: (href) => opened.push(href) > 0
        })
      )
  })
)

/** Only `setColors` is reached from IPC; it records what each window was given. */
const recoloured: Array<readonly [number, unknown]> = []
const windowLayer = ElectronWindow.layerTest({
  setColors: (id, colors) => Effect.sync(() => void recoloured.push([id, colors]))
})

/** Answers with a fixed state and counts the downloads and installs it was asked for. */
const updateCalls = { download: 0, install: 0 }
const updatesLayer = Layer.succeed(
  DesktopUpdates,
  DesktopUpdates.of({
    state: Effect.succeed({
      status: "available",
      currentVersion: "0.2.0",
      availableVersion: "0.2.1",
      releaseNotes: null,
      downloadPercent: null,
      message: null
    }),
    run: Effect.die("unused"),
    check: Effect.die("unused"),
    download: Effect.sync(() => void updateCalls.download++),
    install: Effect.sync(() => void updateCalls.install++)
  })
)

/** Every service the handlers need, over a temp folder; runs `body` with the handlers installed. */
const withHandlers = <A, E>(
  body: (env: {
    readonly fake: ReturnType<typeof fakeIpcMain>
    readonly dialogs: ReturnType<typeof fakeDialogs>
    readonly dir: string
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const fake = fakeIpcMain()
    const dialogs = fakeDialogs()
    const services = MapFiles.layer.pipe(
      Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(path.join(dir, "desktop-settings.json")))),
      Layer.merge(Layer.mergeAll(dialogs.layer, shellLayer, windowLayer, updatesLayer, DesktopIpc.layer(fake.ipcMain)))
    )
    yield* Effect.scoped(
      Effect.gen(function*() {
        yield* installDesktopIpcHandlers()
        yield* body({ fake, dialogs, dir })
      })
    ).pipe(Effect.provide(services))
    return fake
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe("DesktopIpc", () => {
  it.effect("ping round-trips a valid payload and rejects an invalid one", () =>
    Effect.gen(function*() {
      const ipc = yield* withHandlers(({ fake }) =>
        Effect.gen(function*() {
          assert.deepStrictEqual(yield* fake.invoke(PING_CHANNEL, { message: "hello" }), { message: "hello" })

          for (const invalid of [undefined, "hello", { message: 1 }, { message: "x".repeat(1025) }]) {
            const error = yield* Effect.flip(fake.invoke(PING_CHANNEL, invalid))
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
      fake.ipcMain.handle(PING_CHANNEL, () => Promise.resolve("stale"))
      yield* Effect.scoped(
        Effect.gen(function*() {
          yield* (yield* DesktopIpc).handle(ping)
          assert.deepStrictEqual(yield* fake.invoke(PING_CHANNEL, { message: "fresh" }), { message: "fresh" })
        })
      ).pipe(Effect.provide(DesktopIpc.layer(fake.ipcMain)))
    }))

  it.effect("opens a picked map, saves it back over the same file and lists it as recent", () =>
    withHandlers(({ fake, dialogs, dir }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const file = path.join(dir, "Map_LevelEditorMain&Track_me.balledit")
        const text = "{\r\n\t\"items\": [ \"é\" ]\r\n}"
        yield* fs.writeFileString(file, text)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(OPEN_MAP_CHANNEL))
        // Not picked yet: the page can't name a path itself.
        assert.match(String((yield* Effect.flip(fake.invoke(READ_MAP_CHANNEL, { path: file }))).cause), /picked/)

        dialogs.answers.push(file)
        assert.deepStrictEqual(yield* fake.invoke(OPEN_MAP_CHANNEL), {
          path: file,
          name: "Map_LevelEditorMain&Track_me.balledit",
          text
        })
        assert.deepStrictEqual(yield* fake.invoke(WRITE_MAP_CHANNEL, { path: file, text: `${text}\r\n` }), {
          path: file,
          name: "Map_LevelEditorMain&Track_me.balledit"
        })
        assert.strictEqual(yield* fs.readFileString(file), `${text}\r\n`)
        assert.deepStrictEqual(yield* fake.invoke(RECENT_MAPS_CHANNEL), [
          { path: file, name: "Map_LevelEditorMain&Track_me.balledit" }
        ])
        assert.deepStrictEqual(dialogs.asked.map((d) => [d.kind, Option.getOrNull(d.defaultPath)]), [
          ["open", null],
          ["open", null]
        ])
      })
    ))

  it.effect("save as asks where, starting next to the open map, and writes the chosen file", () =>
    withHandlers(({ fake, dialogs, dir }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const near = path.join(dir, "maps", "old.balledit")
        const chosen = path.join(dir, "elsewhere.balledit")
        const payload = { name: "Map_LevelEditorMain&New_me.balledit", text: "{}", near }

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(SAVE_MAP_CHANNEL, payload))
        dialogs.answers.push(chosen)
        assert.deepStrictEqual(yield* fake.invoke(SAVE_MAP_CHANNEL, payload), {
          path: chosen,
          name: "elsewhere.balledit"
        })
        assert.strictEqual(yield* fs.readFileString(chosen), "{}")
        assert.strictEqual(
          Option.getOrNull(dialogs.asked[0]!.defaultPath),
          path.join(dir, "maps", "Map_LevelEditorMain&New_me.balledit")
        )
        // Without an open map, the dialog starts next to the last recent file.
        dialogs.answers.push(null)
        yield* fake.invoke(SAVE_MAP_CHANNEL, { name: "x.balledit", text: "{}" })
        assert.strictEqual(Option.getOrNull(dialogs.asked[2]!.defaultPath), path.join(dir, "x.balledit"))

        const notMap = { ...payload, name: "x.balledit" }
        dialogs.answers.push(path.join(dir, "x.exe"))
        assert.match(String((yield* Effect.flip(fake.invoke(SAVE_MAP_CHANNEL, notMap))).cause), /isn't a map file/)
      })
    ))

  it.effect("opens only web links externally", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        assert.isTrue(yield* fake.invoke(OPEN_EXTERNAL_CHANNEL, { url: "https://example.com/a" }))
        assert.isFalse(yield* fake.invoke(OPEN_EXTERNAL_CHANNEL, { url: "file:///etc/passwd" }))
        assert.deepStrictEqual(opened, ["https://example.com/a"])
      })
    ))

  it.effect("recolours the sender's window to the page theme", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(SET_WINDOW_THEME_CHANNEL, { dark: false })
        assert.deepStrictEqual(recoloured, [[1, {
          overlay: { color: "#01000000", symbolColor: "#09090b", height: 40 },
          background: "#ffffff"
        }]])
        assert.match(
          String((yield* Effect.flip(fake.invoke(SET_WINDOW_THEME_CHANNEL, { dark: "yes" }))).cause),
          /boolean/
        )
      })
    ))

  it.effect("reports the update state and passes on download and install", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        assert.deepInclude(yield* fake.invoke(GET_UPDATE_STATE_CHANNEL), {
          status: "available",
          availableVersion: "0.2.1"
        })
        assert.isUndefined(yield* fake.invoke(DOWNLOAD_UPDATE_CHANNEL))
        assert.isUndefined(yield* fake.invoke(INSTALL_UPDATE_CHANNEL))
        assert.deepStrictEqual(updateCalls, { download: 1, install: 1 })
        assert.match(
          String((yield* Effect.flip(fake.invoke(DOWNLOAD_UPDATE_CHANNEL, { now: true }))).cause),
          /undefined/
        )
      })
    ))
})
