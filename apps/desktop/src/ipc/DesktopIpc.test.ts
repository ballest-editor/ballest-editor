import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Path } from "effect"
import { vi } from "vitest"
import { ElectronDialog, type FileDialogOptions } from "../electron/ElectronDialog"
import { ElectronShell, parseExternalUrl } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { MapFiles } from "../files/MapFiles"
import { makeFakeSteam } from "../game/fakeSteam"
import { GameHost } from "../game/GameHost"
import { GamePaths } from "../game/GamePaths"
import { GameProcess } from "../game/GameProcess"
import { SteamLibrary } from "../game/SteamLibrary"
import { DesktopSettings } from "../settings/DesktopSettings"
import {
  CHOOSE_GAME_PATH_CHANNEL,
  GAME_PATHS_CHANNEL,
  IS_GAME_RUNNING_CHANNEL,
  LAUNCH_GAME_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OPEN_MAP_CHANNEL,
  PING_CHANNEL,
  READ_MAP_CHANNEL,
  RECENT_MAPS_CHANNEL,
  RESET_GAME_PATH_CHANNEL,
  REVEAL_GAME_PATH_CHANNEL,
  SAVE_MAP_CHANNEL,
  SAVE_TO_GAME_CHANNEL,
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
  const asked: Array<FileDialogOptions & { readonly kind: "open" | "save" | "folder" }> = []
  const answer = (kind: "open" | "save" | "folder") => (options: FileDialogOptions) =>
    Effect.sync(() => {
      asked.push({ ...options, kind })
      return Option.fromNullishOr(answers.shift())
    })
  const layer = Layer.succeed(
    ElectronDialog,
    ElectronDialog.of({
      showErrorBox: () => Effect.void,
      showOpenFile: answer("open"),
      showOpenFolder: answer("folder"),
      showSaveFile: answer("save")
    })
  )
  return { answers, asked, layer }
}

/** What the shell was asked to open: web links, the game, folders. */
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
      ),
    launchGame: Effect.sync(() => opened.push("steam://rungameid/3339810") > 0),
    openFolder: (path) => Effect.sync(() => opened.push(path) > 0)
  })
)

/** Only `setColors` is reached from IPC; it records what each window was given. */
const recoloured: Array<readonly [number, unknown]> = []
const windowLayer = Layer.succeed(
  ElectronWindow,
  ElectronWindow.of({
    create: () => Effect.die("unused"),
    load: () => Effect.die("unused"),
    closed: () => Effect.die("unused"),
    workAreas: Effect.succeed([]),
    setColors: (id, colors) => Effect.sync(() => void recoloured.push([id, colors]))
  })
)

/** Every service the handlers need, over a temp folder; runs `body` with the handlers installed. */
const withHandlers = <A, E>(
  body: (env: {
    readonly fake: ReturnType<typeof fakeIpcMain>
    readonly dialogs: ReturnType<typeof fakeDialogs>
    readonly dir: string
    readonly steam: Effect.Success<ReturnType<typeof makeFakeSteam>>
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const fake = fakeIpcMain()
    const dialogs = fakeDialogs()
    const steam = yield* makeFakeSteam(path.join(dir, "machine"), { game: "steam", ran: true })
    const game = Layer.mergeAll(GamePaths.layer, GameProcess.layer).pipe(
      Layer.provide(SteamLibrary.layer),
      Layer.provide(Layer.succeed(GameHost, GameHost.of(steam.host)))
    )
    const services = Layer.mergeAll(MapFiles.layer, game).pipe(
      Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(path.join(dir, "desktop-settings.json")))),
      Layer.merge(Layer.mergeAll(dialogs.layer, shellLayer, windowLayer, DesktopIpc.layer(fake.ipcMain)))
    )
    yield* Effect.scoped(
      Effect.gen(function*() {
        yield* installDesktopIpcHandlers()
        yield* body({ fake, dialogs, dir, steam })
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

  it.effect("saves into the game's maps folder, then treats the file as picked", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const target = path.join(steam.maps, name)
        const text = "{\r\n\t\"items\": []\r\n}"
        assert.deepStrictEqual(
          yield* fake.invoke(SAVE_TO_GAME_CHANNEL, { name, text, replacePublished: false }),
          { _tag: "Saved", file: { path: target, name } }
        )
        assert.strictEqual(yield* fs.readFileString(target), text)
        assert.deepStrictEqual(yield* fake.invoke(RECENT_MAPS_CHANNEL), [{ path: target, name }])
        assert.deepStrictEqual(yield* fake.invoke(READ_MAP_CHANNEL, { path: target }), { path: target, name, text })

        for (const bad of ["../x.balledit", "a/b.balledit", "x.json", ".balledit", "con:.balledit"]) {
          const error = yield* Effect.flip(
            fake.invoke(SAVE_TO_GAME_CHANNEL, { name: bad, text, replacePublished: false })
          )
          assert.match(String(error.cause), /isn't a map file name/, bad)
        }
      })
    ))

  it.effect("asks before replacing the draft of a published map", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Published_me.balledit"
        const target = path.join(steam.maps, name)
        const published = JSON.stringify({
          worldSettings: { levelData: { levelPublishedFileId: 3561234567 } },
          items: []
        })
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fs.writeFileString(target, published)

        assert.deepStrictEqual(
          yield* fake.invoke(SAVE_TO_GAME_CHANNEL, { name, text: "{}", replacePublished: false }),
          {
            _tag: "Published",
            file: { path: target, name },
            publishedFileId: 3561234567
          }
        )
        assert.strictEqual(yield* fs.readFileString(target), published)
        assert.deepStrictEqual(yield* fake.invoke(SAVE_TO_GAME_CHANNEL, { name, text: "{}", replacePublished: true }), {
          _tag: "Saved",
          file: { path: target, name }
        })
        assert.strictEqual(yield* fs.readFileString(target), "{}")

        // A never-published draft (-1) is replaced without asking.
        yield* fs.writeFileString(
          target,
          JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: -1 } } })
        )
        assert.deepStrictEqual(
          yield* fake.invoke(SAVE_TO_GAME_CHANNEL, { name, text: "{}", replacePublished: false }),
          {
            _tag: "Saved",
            file: { path: target, name }
          }
        )
      })
    ))

  it.effect("reports, chooses, resets and reveals the game folders", () =>
    withHandlers(({ fake, dialogs, dir, steam }) =>
      Effect.gen(function*() {
        const found = {
          install: { status: "found", path: steam.install },
          mapsFolder: { status: "found", path: steam.maps },
          pluginsFolder: { status: "missing", path: `${steam.install}/Ballest/Binaries/Win64/plugins` }
        }
        assert.deepStrictEqual(yield* fake.invoke(GAME_PATHS_CHANNEL), found)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(CHOOSE_GAME_PATH_CHANNEL, { which: "mapsFolder" }))
        dialogs.answers.push(dir)
        assert.deepStrictEqual(yield* fake.invoke(CHOOSE_GAME_PATH_CHANNEL, { which: "mapsFolder" }), {
          ...found,
          mapsFolder: { status: "overridden", path: dir }
        })
        assert.deepStrictEqual(dialogs.asked.map((d) => [d.kind, Option.getOrNull(d.defaultPath)]), [
          ["folder", steam.maps],
          ["folder", steam.maps]
        ])
        // Not the game: refused, and the install stays as found.
        dialogs.answers.push(dir)
        const error = yield* Effect.flip(fake.invoke(CHOOSE_GAME_PATH_CHANNEL, { which: "install" }))
        assert.match(String(error.cause), /isn't Ballest of Them All's folder/)
        assert.deepStrictEqual(yield* fake.invoke(RESET_GAME_PATH_CHANNEL, { which: "mapsFolder" }), found)

        opened.length = 0
        assert.isTrue(yield* fake.invoke(REVEAL_GAME_PATH_CHANNEL, { which: "mapsFolder" }))
        assert.isFalse(yield* fake.invoke(REVEAL_GAME_PATH_CHANNEL, { which: "pluginsFolder" }))
        assert.match(
          String((yield* Effect.flip(fake.invoke(REVEAL_GAME_PATH_CHANNEL, { which: "/etc" }))).cause),
          /Expected/
        )
        assert.deepStrictEqual(opened, [steam.maps])
      })
    ))

  it.effect("launches the game through Steam and tells whether it runs", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
        assert.isFalse(yield* fake.invoke(IS_GAME_RUNNING_CHANNEL))
        assert.isTrue(yield* fake.invoke(LAUNCH_GAME_CHANNEL))
        assert.deepStrictEqual(opened, ["steam://rungameid/3339810"])
      })
    ))

  it.effect("opens only web links externally", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
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
})
