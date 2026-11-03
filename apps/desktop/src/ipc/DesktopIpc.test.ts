import {
  ChooseGamePathResult,
  ExportChecks,
  ExportMapResult,
  GamePaths as GamePathsSchema,
  ImportMapResult,
  InvokeChannels,
  MapBackupFile,
  MapBackups,
  PlayResult,
  PluginStatus,
  ProjectMapFile,
  ProjectMaps,
  ProjectState
} from "@ballest/contracts"
import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import * as Fs from "node:fs"
import { vi } from "vitest"
import { ElectronDialog, type FileDialogOptions, type MessageBoxOptions } from "../electron/ElectronDialog"
import { ElectronShell, parseExternalUrl } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { makeFakePluginBundle, makeFakeSteam } from "../game/fakeSteam"
import { GameCreator } from "../game/GameCreator"
import { GameHost } from "../game/GameHost"
import { GameLink, PlayFile } from "../game/GameLink"
import { GamePaths } from "../game/GamePaths"
import { GamePlay } from "../game/GamePlay"
import { GameProcess } from "../game/GameProcess"
import { SteamLibrary } from "../game/SteamLibrary"
import { NotificationLog } from "../notifications/NotificationLog"
import { Backups } from "../project/Backups"
import { sha256 } from "../project/files"
import { LinkFile, MapLinks } from "../project/MapLinks"
import { Projects } from "../project/Projects"
import { DesktopSettings, DesktopSettingsFile } from "../settings/DesktopSettings"
import { DesktopUpdates } from "../updates/DesktopUpdates"
import { DesktopIpc, type DesktopIpcHandleListener, type DesktopIpcMain, makeIpcMethod } from "./DesktopIpc"
import { installDesktopIpcHandlers } from "./DesktopIpcHandlers"
import { pingHandlers } from "./methods/ping"

const samplesDir = `${import.meta.dirname}/../../../../samples`

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
  /** `invoke`, with the result decoded as `schema` (the shape the contract promises the page). */
  const invokeAs = <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    channel: string,
    raw?: unknown
  ) => invoke(channel, raw).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
  return { handlers, ipcMain, invoke, invokeAs }
}

/** What `desktop-settings.json` in the test's folder holds. */
const readSettings = (fs: FileSystem.FileSystem, dir: string) =>
  fs.readFileString(`${dir}/desktop-settings.json`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(DesktopSettingsFile))),
    Effect.orElseSucceed((): DesktopSettingsFile => ({}))
  )

const hasTag = <A extends { readonly _tag: string }, T extends A["_tag"]>(
  value: A,
  tag: T
): value is Extract<A, { readonly _tag: T }> => value._tag === tag

/** Narrows a tagged result, failing the test on any other tag. */
const expectTag = <A extends { readonly _tag: string }, T extends A["_tag"]>(value: A, tag: T) =>
  hasTag(value, tag) ? value : assert.fail(`expected ${tag}, got ${value._tag}`)

/**
 * Dialogs that answer from a queue (a path, or null for cancel; a message box, the button's index) and record what
 * they were asked.
 */
const fakeDialogs = () => {
  const answers: Array<string | null> = []
  const asked: Array<FileDialogOptions & { readonly kind: "open" | "save" | "folder" }> = []
  const buttons: Array<number> = []
  const messages: Array<MessageBoxOptions> = []
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
      showMessageBox: (options) =>
        Effect.sync(() => {
          messages.push(options)
          return buttons.shift() ?? options.cancelId
        }),
      showSaveFile: answer("save")
    })
  )
  return { answers, asked, buttons, messages, layer }
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
const windowLayer = ElectronWindow.layerTest({
  setColors: (id, colors) => Effect.sync(() => void recoloured.push([id, colors])),
  sendAll: () => Effect.void
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
      releaseDate: null,
      releaseUrl: null,
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
    /** The first project, `Documents/Ballest Editor/My maps` in the temp folder, once `createProject` made it. */
    readonly project: string
    readonly steam: Effect.Success<ReturnType<typeof makeFakeSteam>>
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  machine: Parameters<typeof makeFakeSteam>[1] = { game: "steam", ran: true },
  /** `current`: `project` is the project in use already (remembered in the settings, not yet on disk); `none`: Untitled Project. */
  start: "current" | "none" = "current"
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const project = path.join(dir, "Documents", "Ballest Editor", "My maps")
    if (start === "current") {
      yield* fs.writeFileString(
        path.join(dir, "desktop-settings.json"),
        JSON.stringify({ project: { recent: [project] } } satisfies DesktopSettingsFile)
      )
    }
    const fake = fakeIpcMain()
    const dialogs = fakeDialogs()
    const steam = yield* makeFakeSteam(path.join(dir, "machine"), machine)
    const bundle = yield* makeFakePluginBundle(dir, "0.2.0")
    const game = Layer.mergeAll(GameCreator.layer, Layer.effect(GameLink, GameLink.make(bundle))).pipe(
      Layer.provideMerge(Layer.mergeAll(GamePaths.layer, GameProcess.layer)),
      Layer.provide(SteamLibrary.layer),
      Layer.provide(Layer.succeed(GameHost, GameHost.of(steam.host)))
    )
    const projects = Layer.effect(
      Projects,
      Projects.make(path.dirname(project), "linux", path.join(dir, "userData", "backups"))
    )
      .pipe(
        Layer.provide(Layer.mergeAll(MapLinks.layer, Backups.layer)),
        Layer.provideMerge(game)
      )
    const services = Layer.effect(GamePlay, GamePlay.make).pipe(
      Layer.provideMerge(projects),
      Layer.provide(Layer.mergeAll(shellLayer, windowLayer)),
      Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(path.join(dir, "desktop-settings.json")))),
      Layer.merge(Layer.mergeAll(
        dialogs.layer,
        shellLayer,
        windowLayer,
        updatesLayer,
        Layer.effect(NotificationLog, NotificationLog.make(path.join(dir, "notifications.json"))),
        DesktopIpc.layer(fake.ipcMain)
      ))
    )
    yield* Effect.scoped(
      Effect.gen(function*() {
        yield* installDesktopIpcHandlers()
        yield* body({ fake, dialogs, dir, project, steam })
      })
    ).pipe(Effect.provide(services))
    return fake
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

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

  it.effect(
    "the first Save names the project, and New map, Save, Rename and list keep to its maps folder",
    () =>
      withHandlers(
        ({ dir, fake, project }) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const name = "Map_LevelEditorMain&Track_me.balledit"
            const text = "{\r\n\t\"items\": [ \"é\" ]\r\n}"

            // No project yet: Untitled Project. Nothing is listed or revealed, remembering an open map is a no-op, and
            // writing a map is refused until a project is named.
            assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.projectState), {
              current: null,
              recent: [],
              lastOpenMap: null,
              projectsFolder: path.dirname(project)
            })
            assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listMaps), [])
            assert.isFalse(yield* fake.invoke(InvokeChannels.revealProject, { which: "maps" }))
            yield* fake.invoke(InvokeChannels.rememberOpenMap, { fileName: name })
            assert.isNull((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).lastOpenMap)
            const unnamed = yield* Effect.flip(fake.invoke(InvokeChannels.createMap, { fileName: name, text }))
            assert.match(String(unnamed.cause), /no project yet/)

            // The first Save names the project; it is on disk from then on.
            const named = yield* fake.invokeAs(ProjectState, InvokeChannels.createProject, { name: "My maps" })
            assert.deepStrictEqual(named, {
              current: { path: project, name: "My maps", exists: true },
              recent: [],
              lastOpenMap: null,
              projectsFolder: path.dirname(project)
            })
            assert.isTrue(yield* fake.invoke(InvokeChannels.revealProject, { which: "maps" }))
            assert.isTrue(yield* fake.invoke(InvokeChannels.revealProject, { which: "project" }))
            // the backups folder is made by the first backup
            assert.isFalse(yield* fake.invoke(InvokeChannels.revealProject, { which: "backups" }))
            assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listMaps), [])

            // Project settings › General renames the project in its file; the folder keeps its name
            const renamedProject = yield* fake.invokeAs(ProjectState, InvokeChannels.renameProject, {
              name: " Season 3 "
            })
            assert.deepInclude(renamedProject.current, { path: project, name: "Season 3" })
            assert.deepInclude(JSON.parse(yield* fs.readFileString(path.join(project, "ballest-project.json"))), {
              name: "Season 3"
            })
            const blank = yield* Effect.flip(fake.invoke(InvokeChannels.renameProject, { name: "  " }))
            assert.match(String(blank.cause), /can't name a folder/)

            // the open map is kept per project for the next launch; a name that isn't a map file's is refused
            yield* fake.invoke(InvokeChannels.rememberOpenMap, { fileName: name })
            assert.strictEqual((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).lastOpenMap, name)
            assert.deepInclude((yield* readSettings(fs, dir)).project?.lastOpenMap, { [project]: name })
            assert.match(
              String((yield* Effect.flip(fake.invoke(InvokeChannels.rememberOpenMap, { fileName: "../x" }))).cause),
              /isn't a map file name/
            )
            yield* fake.invoke(InvokeChannels.rememberOpenMap, { fileName: null })
            assert.isNull((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).lastOpenMap)

            const created = yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text })
            assert.deepInclude(created, {
              fileName: name,
              path: path.join(project, "maps", name),
              hash: sha256(new TextEncoder().encode(text)),
              publishedFileId: -1,
              link: null
            })
            assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), text)
            assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(path.join(project, "ballest-project.json"))), {
              formatVersion: 1,
              name: "Season 3",
              exportTarget: "game"
            })
            // A second New map of the same name is refused.
            const clash = yield* Effect.flip(fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" }))
            assert.match(String(clash.cause), /already has a map called/)

            yield* fake.invoke(InvokeChannels.saveMap, { fileName: name, text: `${text}\r\n` })
            assert.deepInclude(yield* fake.invoke(InvokeChannels.readMap, { fileName: name }), {
              text: `${text}\r\n`
            })

            const renamed = "Map_LevelEditorMain&Loop_me.balledit"
            yield* fake.invoke(InvokeChannels.renameMap, { from: name, to: renamed, text: "{\"renamed\":1}" })
            assert.deepStrictEqual(
              (yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)).map((m) => m.fileName),
              [
                renamed
              ]
            )
            // The Save kept the file it wrote over, the Rename the file it moved away from: newest first.
            const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
            assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["project", name], ["project", name]])
            const texts = yield* Effect.forEach(
              backups,
              ({ place, id }) =>
                fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, { place, id }).pipe(
                  Effect.map((b) => b.text)
                )
            )
            assert.deepStrictEqual(texts, [`${text}\r\n`, text])
            assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 2)

            // Names only: nothing reaches outside maps/.
            for (const bad of ["../x.balledit", "a/b.balledit", "x.json", ".balledit", "con:.balledit"]) {
              const error = yield* Effect.flip(fake.invoke(InvokeChannels.saveMap, { fileName: bad, text }))
              assert.match(String(error.cause), /isn't a map file name/, bad)
            }
            assert.isFalse(yield* fs.exists(path.join(project, "x.balledit")))

            // The hash follows the bytes, and the published id is read from them.
            const published = "{\"worldSettings\":{\"levelData\":{\"levelPublishedFileId\":3456}}}"
            assert.deepInclude(yield* fake.invoke(InvokeChannels.saveMap, { fileName: renamed, text: published }), {
              hash: sha256(new TextEncoder().encode(published)),
              publishedFileId: 3456
            })
          }),
        undefined,
        "none"
      )
  )

  it.effect("imports a map from the game's maps folder linked to it, and exports it back with its hash", () =>
    withHandlers(({ fake, dialogs, dir, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const inGame = path.join(steam.maps, name)
        const original = "{\r\n\t\"items\": []\r\n}"
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fs.writeFileString(inGame, original)

        // Not picked: the page can't name a file to import.
        const unpicked = { source: inGame, fileName: name, text: original, replace: false }
        assert.match(String((yield* Effect.flip(fake.invoke(InvokeChannels.importMap, unpicked))).cause), /picked/)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(InvokeChannels.pickImport))
        dialogs.answers.push(inGame)
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.pickImport), { path: inGame, name, text: original })
        assert.strictEqual(Option.getOrNull(dialogs.asked[0]!.defaultPath), steam.maps)

        const imported = expectTag(
          yield* fake.invokeAs(ImportMapResult, InvokeChannels.importMap, unpicked),
          "Imported"
        )
        const hash = sha256(new TextEncoder().encode(original))
        assert.deepInclude(imported.map.link?.origin, { path: inGame, hash })
        assert.deepInclude(imported.map.link?.export, { path: inGame, hash })
        assert.strictEqual(imported.map.link?.lastSeenHash, hash)
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), original)
        const links = yield* fs.readFileString(path.join(project, ".ballest", "link.json")).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(LinkFile)))
        )
        assert.deepStrictEqual(Object.keys(links.maps), [name])

        // The same name again: reported, then replaced on request with the old copy in backups.
        const again = { ...unpicked, text: "{\"v\":2}" }
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.importMap, again), {
          _tag: "Clash",
          fileName: name
        })
        yield* fake.invoke(InvokeChannels.importMap, { ...again, replace: true })
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), "{\"v\":2}")
        assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 1)

        // A file from elsewhere has an origin but no export.
        const download = path.join(dir, "Downloads", "Map_LevelEditorMain&Other_me.balledit")
        yield* fs.makeDirectory(path.dirname(download), { recursive: true })
        yield* fs.writeFileString(download, "{}")
        dialogs.answers.push(download)
        yield* fake.invoke(InvokeChannels.pickImport)
        const other = expectTag(
          yield* fake.invokeAs(ImportMapResult, InvokeChannels.importMap, {
            source: download,
            fileName: path.basename(download),
            text: "{}",
            replace: false
          }),
          "Imported"
        )
        assert.deepInclude(other.map.link, { export: null, lastSeenHash: null })

        const exported = expectTag(
          yield* fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          }),
          "Exported"
        )
        const exportedHash = sha256(new TextEncoder().encode("{\"v\":2}"))
        assert.deepStrictEqual(exported.file, { path: inGame, name })
        assert.deepInclude(exported.link.export, { path: inGame, hash: exportedHash })
        assert.strictEqual(exported.link.lastSeenHash, exportedHash)
        assert.deepInclude(exported.link.origin, { path: inGame, hash })
        assert.strictEqual(yield* fs.readFileString(inGame), "{\"v\":2}")
      })
    ))

  it.effect("asks before exporting over the draft of a published map", () =>
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
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" })

        assert.deepStrictEqual(
          yield* fake.invoke(InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          }),
          { _tag: "Published", file: { path: target, name }, publishedFileId: 3561234567 }
        )
        assert.strictEqual(yield* fs.readFileString(target), published)
        const replaced = yield* fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: true,
          overwriteChanged: false
        })
        assert.strictEqual(replaced._tag, "Exported")
        assert.strictEqual(yield* fs.readFileString(target), "{}")

        // A never-published draft (-1) is replaced without the published question (the game changed the export, so
        // only that is asked).
        yield* fs.writeFileString(
          target,
          JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: -1 } } })
        )
        const again = yield* fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: false,
          overwriteChanged: true
        })
        assert.strictEqual(again._tag, "Exported")
      })
    ))

  it.effect("reports an export the game changed once, asks before exporting over it, and re-imports it", () =>
    withHandlers(({ fake, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Sync_me.balledit"
        const inGame = path.join(steam.maps, name)
        const inProject = path.join(project, "maps", name)
        const hashOf = (text: string) => sha256(new TextEncoder().encode(text))
        const check = fake.invokeAs(ExportChecks, InvokeChannels.checkExports)
        const exportIt = (overwriteChanged: boolean) =>
          fake.invokeAs(ExportMapResult, InvokeChannels.exportMap, {
            fileName: name,
            replacePublished: false,
            overwriteChanged
          })
        const linkOf = Effect.gen(function*() {
          const maps = yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)
          return maps.find((m) => m.fileName === name)?.link
        })
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{\"v\":1}" })
        expectTag(yield* exportIt(false), "Exported")
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })

        // The in-game editor saves it: reported once, however often it is looked at.
        const saved = "{\"v\":1,\"editorState\":{}}"
        yield* fs.writeFileString(inGame, saved)
        const [first, second] = yield* Effect.all([check, check], { concurrency: "unbounded" })
        assert.deepStrictEqual([first, second].flatMap((c) => c.changed), [name])
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })
        assert.deepInclude(yield* linkOf, { lastSeenHash: hashOf(saved) })
        assert.strictEqual((yield* linkOf)?.export?.hash, hashOf("{\"v\":1}"))

        // Export asks first; overwriting keeps the game's version in the backups.
        assert.deepStrictEqual(yield* exportIt(false), { _tag: "ChangedInGame", file: { path: inGame, name } })
        assert.strictEqual(yield* fs.readFileString(inGame), saved)
        expectTag(yield* exportIt(true), "Exported")
        assert.strictEqual(yield* fs.readFileString(inGame), "{\"v\":1}")
        const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        const [kept] = backups
        assert.deepInclude(kept, { place: "export", fileName: name })
        assert.strictEqual((yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, kept)).text, saved)

        // Saved in the game again, and seen by an Export first: the check doesn't report it again.
        const again = "{\"v\":1,\"editorState\":{\"again\":1}}"
        yield* fs.writeFileString(inGame, again)
        expectTag(yield* exportIt(false), "ChangedInGame")
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })

        // Re-import: the game's version replaces the project's, which goes to the project's backups.
        const reimported = yield* fake.invokeAs(ProjectMapFile, InvokeChannels.reimportMap, { fileName: name })
        assert.strictEqual(reimported.text, again)
        assert.strictEqual(yield* fs.readFileString(inProject), again)
        assert.deepInclude(reimported.link?.export, { path: inGame, hash: hashOf(again) })
        assert.strictEqual(reimported.link?.lastSeenHash, hashOf(again))
        const projectBackup = (yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)).find((b) =>
          b.place === "project"
        )
        assert.strictEqual(
          (yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, projectBackup)).text,
          "{\"v\":1}"
        )
        expectTag(yield* exportIt(false), "Exported")

        // Deleted in the game: the link's export is dropped, once.
        yield* fs.remove(inGame)
        assert.deepStrictEqual(yield* check, { changed: [], missing: [name] })
        assert.deepInclude(yield* linkOf, { export: null, lastSeenHash: null })
        assert.deepStrictEqual(yield* check, { changed: [], missing: [] })
        const refused = yield* Effect.flip(fake.invoke(InvokeChannels.reimportMap, { fileName: name }))
        assert.match(String(refused.cause), /no export/)
      })
    ))

  it.effect("drops no link while the game's maps folder isn't there", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const name = "Map_LevelEditorMain&Away_me.balledit"
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{}" })
        yield* fake.invoke(InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: false,
          overwriteChanged: false
        })
        yield* fs.remove(steam.maps, { recursive: true })
        assert.deepStrictEqual(yield* fake.invokeAs(ExportChecks, InvokeChannels.checkExports), {
          changed: [],
          missing: []
        })
        const [map] = yield* fake.invokeAs(ProjectMaps, InvokeChannels.listMaps)
        assert.isNotNull(map?.link?.export)
      })
    ))

  it.effect("Export keeps the game's copy it writes over in userData's backups, once per change", () =>
    withHandlers(({ fake, dir, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        yield* fs.makeDirectory(steam.maps, { recursive: true })
        yield* fs.writeFileString(path.join(steam.maps, name), "{\"edited\":\"in game\"}")
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "{\"v\":1}" })

        const exportIt = fake.invoke(InvokeChannels.exportMap, {
          fileName: name,
          replacePublished: false,
          overwriteChanged: false
        })
        yield* exportIt
        // The same bytes again: nothing to keep.
        yield* exportIt
        const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
        assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["export", name]])
        const [backup] = backups
        const read = yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, backup)
        assert.strictEqual(read.text, "{\"edited\":\"in game\"}")
        assert.lengthOf(yield* fs.readDirectory(path.join(dir, "userData", "backups")), 1)

        // Only names main wrote in its own folders.
        for (const id of ["../desktop-settings.json", `../../${name}`, name, "notes.txt"]) {
          const error = yield* Effect.flip(fake.invoke(InvokeChannels.readBackup, { place: "export", id }))
          assert.match(String(error.cause), /doesn't exist/, id)
        }
        const unknown = { place: "project", id: `2026-10-31T12-00-00-000Z ${name}` }
        assert.match(String((yield* Effect.flip(fake.invoke(InvokeChannels.readBackup, unknown))).cause), /exist/)
      })
    ))

  it.effect(
    "every sample goes into the backups and comes back byte for byte",
    () =>
      withHandlers(({ fake }) =>
        Effect.gen(function*() {
          const samples = Fs.readdirSync(samplesDir, { recursive: true, encoding: "utf8" })
            .filter((file) => /\.(balledit|ballmap)$/.test(file))
          assert.isAbove(samples.length, 0)
          for (const [i, sample] of samples.entries()) {
            const text = Fs.readFileSync(`${samplesDir}/${sample}`, "utf8")
            const fileName = `Map_LevelEditorMain&Sample ${i}_me.balledit`
            yield* fake.invoke(InvokeChannels.createMap, { fileName, text })
            yield* fake.invoke(InvokeChannels.saveMap, { fileName, text: "{}" })
            const backups = yield* fake.invokeAs(MapBackups, InvokeChannels.listBackups)
            const backup = backups.find((b) => b.fileName === fileName)
            assert.isDefined(backup, sample)
            const read = yield* fake.invokeAs(MapBackupFile, InvokeChannels.readBackup, backup)
            assert.isTrue(read.text === text, `${sample} differs after the backup`)
          }
        })
      ),
    // every sample is written, hashed and read back: tens of MB, slow on a CI runner
    60_000
  )

  it.effect(
    "chooses another project folder, refuses the game's maps folder and switches back",
    () =>
      withHandlers(
        ({ fake, dialogs, dir, project, steam }) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const other = path.join(dir, "Elsewhere")

            dialogs.answers.push(null)
            assert.isNull(yield* fake.invoke(InvokeChannels.chooseProject))
            // No project yet, so the dialog starts where projects are made.
            assert.strictEqual(Option.getOrNull(dialogs.asked[0]!.defaultPath), path.dirname(project))
            yield* fake.invoke(InvokeChannels.createProject, { name: "My maps" })

            for (const refused of [steam.maps, path.join(steam.maps, "sub")]) {
              dialogs.answers.push(refused)
              const error = yield* Effect.flip(fake.invoke(InvokeChannels.chooseProject))
              assert.match(String(error.cause), /game's maps folder or inside it/)
            }

            dialogs.answers.push(other)
            const chosen = yield* fake.invoke(InvokeChannels.chooseProject)
            assert.deepStrictEqual(chosen, {
              current: { path: other, name: "Elsewhere", exists: false },
              recent: [{ path: project, name: "My maps", exists: true }],
              lastOpenMap: null,
              projectsFolder: path.dirname(project)
            })
            // Only a recent project can be switched to by path.
            const error = yield* Effect.flip(
              fake.invoke(InvokeChannels.switchProject, { path: path.join(dir, "Random") })
            )
            assert.match(String(error.cause), /picked/)
            const back = yield* fake.invokeAs(ProjectState, InvokeChannels.switchProject, { path: project })
            assert.strictEqual(back.current?.path, project)
            assert.deepStrictEqual(back.recent.map((p) => p.path), [other])

            // New project makes `<projectsFolder>/<name>` on disk and uses it; a second one of that name is refused.
            const made = yield* fake.invokeAs(ProjectState, InvokeChannels.createProject, { name: " Season 3 " })
            const season = path.join(path.dirname(project), "Season 3")
            assert.deepInclude(made.current, { path: season, name: "Season 3", exists: true })
            assert.deepStrictEqual(made.recent.map((p) => p.path), [project, other])
            assert.isTrue(yield* fs.exists(path.join(season, "maps")))
            assert.strictEqual(yield* fs.readFileString(path.join(season, ".gitignore")), ".ballest/\n")
            const again = yield* Effect.flip(fake.invoke(InvokeChannels.createProject, { name: "Season 3" }))
            assert.match(String(again.cause), /already holds a project/)
            for (const bad of ["", ".hidden", "a/b", "x".repeat(65)]) {
              const refused = yield* Effect.flip(fake.invoke(InvokeChannels.createProject, { name: bad }))
              assert.match(String(refused.cause), /can't name a folder/)
            }
          }),
        undefined,
        "none"
      )
  )

  it.effect("reports, chooses, resets and reveals the game folders", () =>
    withHandlers(({ fake, dialogs, dir, steam }) =>
      Effect.gen(function*() {
        const found = {
          install: { status: "found", path: steam.install },
          mapsFolder: { status: "found", path: steam.maps },
          pluginsFolder: { status: "missing", path: `${steam.install}/Ballest/Binaries/Win64/plugins` }
        }
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.gamePaths), found)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(InvokeChannels.chooseGamePath, { which: "mapsFolder" }))
        dialogs.answers.push(dir)
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.chooseGamePath, { which: "mapsFolder" }), {
          ...found,
          mapsFolder: { status: "overridden", path: dir }
        })
        assert.deepStrictEqual(dialogs.asked.map((d) => [d.kind, Option.getOrNull(d.defaultPath)]), [
          ["folder", steam.maps],
          ["folder", steam.maps]
        ])
        // Not the game: refused, and the install stays as found.
        dialogs.answers.push(dir)
        const error = yield* Effect.flip(fake.invoke(InvokeChannels.chooseGamePath, { which: "install" }))
        assert.match(String(error.cause), /isn't Ballest of Them All's folder/)
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.resetGamePath, { which: "mapsFolder" }), found)

        opened.length = 0
        assert.isTrue(yield* fake.invoke(InvokeChannels.revealGamePath, { which: "mapsFolder" }))
        assert.isFalse(yield* fake.invoke(InvokeChannels.revealGamePath, { which: "pluginsFolder" }))
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.revealGamePath, { which: "/etc" }))).cause),
          /Expected/
        )
        assert.deepStrictEqual(opened, [steam.maps])
      })
    ))

  it.effect("launches the game through Steam and tells whether it runs", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
        assert.isFalse(yield* fake.invoke(InvokeChannels.isGameRunning))
        assert.isTrue(yield* fake.invoke(InvokeChannels.launchGame))
        assert.deepStrictEqual(opened, ["steam://rungameid/3339810"])
      })
    ))

  it.effect("finds the creator from Steam's login file", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        assert.isNull(yield* fake.invoke(InvokeChannels.findCreator))
        const config = path.join(steam.steam, "config")
        yield* fs.makeDirectory(config)
        yield* fs.writeFileString(
          path.join(config, "loginusers.vdf"),
          `"users"\n{\n\t"76561198000000001"\n\t{\n\t\t"PersonaName"\t\t"Marble"\n\t\t"MostRecent"\t\t"1"\n\t}\n}\n`
        )
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.findCreator), { name: "Marble", source: "steam" })
      })
    ))

  it.effect("reports the plugin and installs it once the plugin manager is there", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const folder = path.join(steam.plugins, "ballest-editor-link")
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.pluginStatus), {
          status: "noPluginManager",
          bundledVersion: "0.2.0",
          installedVersion: null,
          folder
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.installPlugin))).cause),
          /plugin manager isn't installed/
        )

        yield* fs.makeDirectory(steam.plugins)
        yield* fs.writeFileString(path.join(path.dirname(steam.plugins), "version.dll"), "")
        assert.deepInclude(yield* fake.invoke(InvokeChannels.pluginStatus), { status: "missing" })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.installPlugin), {
          plugin: { status: "current", bundledVersion: "0.2.0", installedVersion: "0.2.0", folder },
          restartGame: false
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.pluginStatus, { folder: "/etc" }))).cause),
          /undefined/
        )
      })
    ))

  it.effect("Play exports the map, hands it to the installed plugin and starts the game", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        opened.length = 0
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const text = JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: -1 } }, items: [] })
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text })
        yield* fs.makeDirectory(steam.plugins)
        yield* fs.writeFileString(path.join(path.dirname(steam.plugins), "version.dll"), "")
        yield* fake.invoke(InvokeChannels.installPlugin)

        const result = expectTag(
          yield* fake.invokeAs(PlayResult, InvokeChannels.play, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          }),
          "Played"
        )
        assert.deepInclude(result, { sent: true, launch: "launched" })
        assert.deepStrictEqual(result.file, { path: path.join(steam.maps, name), name })
        assert.strictEqual(result.link.export?.hash, sha256(new TextEncoder().encode(text)))
        assert.strictEqual(yield* fs.readFileString(path.join(steam.maps, name)), text)
        const play = yield* fs.readFileString(path.join(steam.plugins, "ballest-editor-link", "play.json")).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(PlayFile)))
        )
        assert.strictEqual(play.map, name)
        assert.deepStrictEqual(opened, ["steam://rungameid/3339810"])
        // Only a project map's file name.
        const bad = yield* Effect.flip(
          fake.invoke(InvokeChannels.play, {
            fileName: "../x.balledit",
            replacePublished: false,
            overwriteChanged: false
          })
        )
        assert.match(String(bad.cause), /isn't a map file name/)
      })
    ))

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

  it.effect("reports the update state and passes on download and install", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        assert.deepInclude(yield* fake.invoke(InvokeChannels.getUpdateState), {
          status: "available",
          availableVersion: "0.2.1"
        })
        assert.isUndefined(yield* fake.invoke(InvokeChannels.downloadUpdate))
        assert.isUndefined(yield* fake.invoke(InvokeChannels.installUpdate))
        assert.deepStrictEqual(updateCalls, { download: 1, install: 1 })
        assert.match(
          String((yield* Effect.flip(fake.invoke(InvokeChannels.downloadUpdate, { now: true }))).cause),
          /undefined/
        )
      })
    ))

  it.effect("without a game install, the install can be chosen; a folder without the exe isn't saved", () =>
    withHandlers(({ fake, dialogs, dir, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const paths = yield* fake.invokeAs(GamePathsSchema, InvokeChannels.gamePaths)
        assert.deepStrictEqual(paths.install, { status: "missing", path: null })
        assert.strictEqual((yield* fake.invokeAs(PluginStatus, InvokeChannels.pluginStatus)).status, "noGame")

        dialogs.answers.push(dir)
        const error = yield* Effect.flip(fake.invoke(InvokeChannels.chooseGamePath, { which: "install" }))
        assert.match(String(error.cause), /isn't Ballest of Them All's folder/)
        assert.isUndefined((yield* readSettings(fs, dir)).game)

        // the folder the fixture would have put the game in, with the exe: taken, and kept as the override
        const exe = `${steam.install}/Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe`
        yield* fs.makeDirectory(exe.slice(0, exe.lastIndexOf("/")), { recursive: true })
        yield* fs.writeFileString(exe, "")
        dialogs.answers.push(steam.install)
        const chosen = yield* fake.invokeAs(ChooseGamePathResult, InvokeChannels.chooseGamePath, {
          which: "install"
        })
        assert.deepStrictEqual(chosen?.install, { status: "overridden", path: steam.install })
        assert.deepStrictEqual((yield* readSettings(fs, dir)).game, { install: steam.install })
      }), { game: "none" }))

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
