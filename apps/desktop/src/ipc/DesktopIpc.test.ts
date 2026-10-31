import {
  ExportMapResult,
  ImportMapResult,
  MapBackupFile,
  MapBackups,
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
import { GameLink } from "../game/GameLink"
import { GamePaths } from "../game/GamePaths"
import { GameProcess } from "../game/GameProcess"
import { SteamLibrary } from "../game/SteamLibrary"
import { NotificationLog } from "../notifications/NotificationLog"
import { Backups } from "../project/Backups"
import { sha256 } from "../project/files"
import { LinkFile, MapLinks } from "../project/MapLinks"
import { Projects } from "../project/Projects"
import { DesktopSettings } from "../settings/DesktopSettings"
import { DesktopUpdates } from "../updates/DesktopUpdates"
import * as channels from "./channels"
import { DesktopIpc, type DesktopIpcHandleListener, type DesktopIpcMain } from "./DesktopIpc"
import { installDesktopIpcHandlers } from "./DesktopIpcHandlers"
import { ping } from "./methods/ping"

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
    /** The default project: `Documents/Ballest Editor/Maps` in the temp folder. */
    readonly project: string
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
    const bundle = yield* makeFakePluginBundle(dir, "0.2.0")
    const game = Layer.mergeAll(GameCreator.layer, Layer.effect(GameLink, GameLink.make(bundle))).pipe(
      Layer.provideMerge(Layer.mergeAll(GamePaths.layer, GameProcess.layer)),
      Layer.provide(SteamLibrary.layer),
      Layer.provide(Layer.succeed(GameHost, GameHost.of(steam.host)))
    )
    const project = path.join(dir, "Documents", "Ballest Editor", "Maps")
    const projects = Layer.effect(Projects, Projects.make(project, "linux", path.join(dir, "userData", "backups")))
      .pipe(
        Layer.provide(Layer.mergeAll(MapLinks.layer, Backups.layer)),
        Layer.provideMerge(game)
      )
    const services = projects.pipe(
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
  it.effect("ping round-trips a valid payload and rejects an invalid one", () =>
    Effect.gen(function*() {
      const ipc = yield* withHandlers(({ fake }) =>
        Effect.gen(function*() {
          assert.deepStrictEqual(yield* fake.invoke(channels.PING_CHANNEL, { message: "hello" }), { message: "hello" })

          for (const invalid of [undefined, "hello", { message: 1 }, { message: "x".repeat(1025) }]) {
            const error = yield* Effect.flip(fake.invoke(channels.PING_CHANNEL, invalid))
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
      fake.ipcMain.handle(channels.PING_CHANNEL, () => Promise.resolve("stale"))
      yield* Effect.scoped(
        Effect.gen(function*() {
          yield* (yield* DesktopIpc).handle(ping)
          assert.deepStrictEqual(yield* fake.invoke(channels.PING_CHANNEL, { message: "fresh" }), { message: "fresh" })
        })
      ).pipe(Effect.provide(DesktopIpc.layer(fake.ipcMain)))
    }))

  it.effect("New map makes the default project on disk, and Save, Rename and list keep to its maps folder", () =>
    withHandlers(({ fake, project }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const text = "{\r\n\t\"items\": [ \"é\" ]\r\n}"

        assert.deepStrictEqual(yield* fake.invoke(channels.PROJECT_STATE_CHANNEL), {
          current: { path: project, name: "Maps", exists: false, isDefault: true },
          recent: []
        })
        assert.deepStrictEqual(yield* fake.invoke(channels.LIST_MAPS_CHANNEL), [])
        assert.isFalse(yield* fake.invoke(channels.REVEAL_PROJECT_CHANNEL))

        const created = yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text })
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
          name: "Maps",
          exportTarget: "game"
        })
        assert.strictEqual(yield* fs.readFileString(path.join(project, ".gitignore")), ".ballest/\n")
        assert.deepInclude((yield* fake.invokeAs(ProjectState, channels.PROJECT_STATE_CHANNEL)).current, {
          exists: true
        })
        // A second New map of the same name is refused.
        const clash = yield* Effect.flip(fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text: "{}" }))
        assert.match(String(clash.cause), /already has a map called/)

        yield* fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName: name, text: `${text}\r\n` })
        assert.deepInclude(yield* fake.invoke(channels.READ_MAP_CHANNEL, { fileName: name }), { text: `${text}\r\n` })

        const renamed = "Map_LevelEditorMain&Loop_me.balledit"
        yield* fake.invoke(channels.RENAME_MAP_CHANNEL, { from: name, to: renamed, text: "{\"renamed\":1}" })
        assert.deepStrictEqual((yield* fake.invokeAs(ProjectMaps, channels.LIST_MAPS_CHANNEL)).map((m) => m.fileName), [
          renamed
        ])
        // The Save kept the file it wrote over, the Rename the file it moved away from: newest first.
        const backups = yield* fake.invokeAs(MapBackups, channels.LIST_BACKUPS_CHANNEL)
        assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["project", name], ["project", name]])
        const texts = yield* Effect.forEach(backups, ({ place, id }) =>
          fake.invokeAs(MapBackupFile, channels.READ_BACKUP_CHANNEL, { place, id }).pipe(Effect.map((b) =>
            b.text
          )))
        assert.deepStrictEqual(texts, [`${text}\r\n`, text])
        assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 2)

        // Names only: nothing reaches outside maps/.
        for (const bad of ["../x.balledit", "a/b.balledit", "x.json", ".balledit", "con:.balledit"]) {
          const error = yield* Effect.flip(fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName: bad, text }))
          assert.match(String(error.cause), /isn't a map file name/, bad)
        }
        assert.isFalse(yield* fs.exists(path.join(project, "x.balledit")))

        // The hash follows the bytes, and the published id is read from them.
        const published = "{\"worldSettings\":{\"levelData\":{\"levelPublishedFileId\":3456}}}"
        assert.deepInclude(yield* fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName: renamed, text: published }), {
          hash: sha256(new TextEncoder().encode(published)),
          publishedFileId: 3456
        })
      })
    ))

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
        assert.match(String((yield* Effect.flip(fake.invoke(channels.IMPORT_MAP_CHANNEL, unpicked))).cause), /picked/)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(channels.PICK_IMPORT_CHANNEL))
        dialogs.answers.push(inGame)
        assert.deepStrictEqual(yield* fake.invoke(channels.PICK_IMPORT_CHANNEL), { path: inGame, name, text: original })
        assert.strictEqual(Option.getOrNull(dialogs.asked[0]!.defaultPath), steam.maps)

        const imported = expectTag(
          yield* fake.invokeAs(ImportMapResult, channels.IMPORT_MAP_CHANNEL, unpicked),
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
        assert.deepStrictEqual(yield* fake.invoke(channels.IMPORT_MAP_CHANNEL, again), {
          _tag: "Clash",
          fileName: name
        })
        yield* fake.invoke(channels.IMPORT_MAP_CHANNEL, { ...again, replace: true })
        assert.strictEqual(yield* fs.readFileString(path.join(project, "maps", name)), "{\"v\":2}")
        assert.lengthOf(yield* fs.readDirectory(path.join(project, ".ballest", "backups")), 1)

        // A file from elsewhere has an origin but no export.
        const download = path.join(dir, "Downloads", "Map_LevelEditorMain&Other_me.balledit")
        yield* fs.makeDirectory(path.dirname(download), { recursive: true })
        yield* fs.writeFileString(download, "{}")
        dialogs.answers.push(download)
        yield* fake.invoke(channels.PICK_IMPORT_CHANNEL)
        const other = expectTag(
          yield* fake.invokeAs(ImportMapResult, channels.IMPORT_MAP_CHANNEL, {
            source: download,
            fileName: path.basename(download),
            text: "{}",
            replace: false
          }),
          "Imported"
        )
        assert.deepInclude(other.map.link, { export: null, lastSeenHash: null })

        const exported = expectTag(
          yield* fake.invokeAs(ExportMapResult, channels.EXPORT_MAP_CHANNEL, {
            fileName: name,
            replacePublished: false
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
        yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text: "{}" })

        assert.deepStrictEqual(
          yield* fake.invoke(channels.EXPORT_MAP_CHANNEL, { fileName: name, replacePublished: false }),
          { _tag: "Published", file: { path: target, name }, publishedFileId: 3561234567 }
        )
        assert.strictEqual(yield* fs.readFileString(target), published)
        const replaced = yield* fake.invokeAs(ExportMapResult, channels.EXPORT_MAP_CHANNEL, {
          fileName: name,
          replacePublished: true
        })
        assert.strictEqual(replaced._tag, "Exported")
        assert.strictEqual(yield* fs.readFileString(target), "{}")

        // A never-published draft (-1) is replaced without asking.
        yield* fs.writeFileString(
          target,
          JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: -1 } } })
        )
        const again = yield* fake.invokeAs(ExportMapResult, channels.EXPORT_MAP_CHANNEL, {
          fileName: name,
          replacePublished: false
        })
        assert.strictEqual(again._tag, "Exported")
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
        yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text: "{\"v\":1}" })

        const exportIt = fake.invoke(channels.EXPORT_MAP_CHANNEL, { fileName: name, replacePublished: false })
        yield* exportIt
        // The same bytes again: nothing to keep.
        yield* exportIt
        const backups = yield* fake.invokeAs(MapBackups, channels.LIST_BACKUPS_CHANNEL)
        assert.deepStrictEqual(backups.map((b) => [b.place, b.fileName]), [["export", name]])
        const [backup] = backups
        const read = yield* fake.invokeAs(MapBackupFile, channels.READ_BACKUP_CHANNEL, backup)
        assert.strictEqual(read.text, "{\"edited\":\"in game\"}")
        assert.lengthOf(yield* fs.readDirectory(path.join(dir, "userData", "backups")), 1)

        // Only names main wrote in its own folders.
        for (const id of ["../desktop-settings.json", `../../${name}`, name, "notes.txt"]) {
          const error = yield* Effect.flip(fake.invoke(channels.READ_BACKUP_CHANNEL, { place: "export", id }))
          assert.match(String(error.cause), /doesn't exist/, id)
        }
        const unknown = { place: "project", id: `2026-10-31T12-00-00-000Z ${name}` }
        assert.match(String((yield* Effect.flip(fake.invoke(channels.READ_BACKUP_CHANNEL, unknown))).cause), /exist/)
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
            yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName, text })
            yield* fake.invoke(channels.SAVE_MAP_CHANNEL, { fileName, text: "{}" })
            const backups = yield* fake.invokeAs(MapBackups, channels.LIST_BACKUPS_CHANNEL)
            const backup = backups.find((b) => b.fileName === fileName)
            assert.isDefined(backup, sample)
            const read = yield* fake.invokeAs(MapBackupFile, channels.READ_BACKUP_CHANNEL, backup)
            assert.isTrue(read.text === text, `${sample} differs after the backup`)
          }
        })
      ),
    // every sample is written, hashed and read back: tens of MB, slow on a CI runner
    60_000
  )

  it.effect("chooses another project folder, refuses the game's maps folder and switches back", () =>
    withHandlers(({ fake, dialogs, dir, project, steam }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const other = path.join(dir, "Elsewhere")

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(channels.CHOOSE_PROJECT_CHANNEL))
        // The project doesn't exist yet, so the dialog starts in its parent.
        assert.strictEqual(Option.getOrNull(dialogs.asked[0]!.defaultPath), path.dirname(project))

        for (const refused of [steam.maps, path.join(steam.maps, "sub")]) {
          dialogs.answers.push(refused)
          const error = yield* Effect.flip(fake.invoke(channels.CHOOSE_PROJECT_CHANNEL))
          assert.match(String(error.cause), /game's maps folder or inside it/)
        }

        dialogs.answers.push(other)
        const chosen = yield* fake.invoke(channels.CHOOSE_PROJECT_CHANNEL)
        assert.deepStrictEqual(chosen, {
          current: { path: other, name: "Elsewhere", exists: false, isDefault: false },
          recent: [{ path: project, name: "Maps", exists: false, isDefault: true }]
        })
        // Only a recent project or the default can be switched to by path.
        const error = yield* Effect.flip(
          fake.invoke(channels.SWITCH_PROJECT_CHANNEL, { path: path.join(dir, "Random") })
        )
        assert.match(String(error.cause), /picked/)
        const back = yield* fake.invokeAs(ProjectState, channels.SWITCH_PROJECT_CHANNEL, { path: project })
        assert.strictEqual(back.current.path, project)
        assert.deepStrictEqual(back.recent.map((p) => p.path), [other])
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
        assert.deepStrictEqual(yield* fake.invoke(channels.GAME_PATHS_CHANNEL), found)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "mapsFolder" }))
        dialogs.answers.push(dir)
        assert.deepStrictEqual(yield* fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "mapsFolder" }), {
          ...found,
          mapsFolder: { status: "overridden", path: dir }
        })
        assert.deepStrictEqual(dialogs.asked.map((d) => [d.kind, Option.getOrNull(d.defaultPath)]), [
          ["folder", steam.maps],
          ["folder", steam.maps]
        ])
        // Not the game: refused, and the install stays as found.
        dialogs.answers.push(dir)
        const error = yield* Effect.flip(fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "install" }))
        assert.match(String(error.cause), /isn't Ballest of Them All's folder/)
        assert.deepStrictEqual(yield* fake.invoke(channels.RESET_GAME_PATH_CHANNEL, { which: "mapsFolder" }), found)

        opened.length = 0
        assert.isTrue(yield* fake.invoke(channels.REVEAL_GAME_PATH_CHANNEL, { which: "mapsFolder" }))
        assert.isFalse(yield* fake.invoke(channels.REVEAL_GAME_PATH_CHANNEL, { which: "pluginsFolder" }))
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.REVEAL_GAME_PATH_CHANNEL, { which: "/etc" }))).cause),
          /Expected/
        )
        assert.deepStrictEqual(opened, [steam.maps])
      })
    ))

  it.effect("launches the game through Steam and tells whether it runs", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
        assert.isFalse(yield* fake.invoke(channels.IS_GAME_RUNNING_CHANNEL))
        assert.isTrue(yield* fake.invoke(channels.LAUNCH_GAME_CHANNEL))
        assert.deepStrictEqual(opened, ["steam://rungameid/3339810"])
      })
    ))

  it.effect("finds the creator from Steam's login file", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        assert.isNull(yield* fake.invoke(channels.FIND_CREATOR_CHANNEL))
        const config = path.join(steam.steam, "config")
        yield* fs.makeDirectory(config)
        yield* fs.writeFileString(
          path.join(config, "loginusers.vdf"),
          `"users"\n{\n\t"76561198000000001"\n\t{\n\t\t"PersonaName"\t\t"Marble"\n\t\t"MostRecent"\t\t"1"\n\t}\n}\n`
        )
        assert.deepStrictEqual(yield* fake.invoke(channels.FIND_CREATOR_CHANNEL), { name: "Marble", source: "steam" })
      })
    ))

  it.effect("reports the plugin and installs it once the plugin manager is there", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const folder = path.join(steam.plugins, "ballest-editor-link")
        assert.deepStrictEqual(yield* fake.invoke(channels.PLUGIN_STATUS_CHANNEL), {
          status: "noPluginManager",
          bundledVersion: "0.2.0",
          installedVersion: null,
          folder
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.INSTALL_PLUGIN_CHANNEL))).cause),
          /plugin manager isn't installed/
        )

        yield* fs.makeDirectory(steam.plugins)
        yield* fs.writeFileString(path.join(path.dirname(steam.plugins), "version.dll"), "")
        assert.deepInclude(yield* fake.invoke(channels.PLUGIN_STATUS_CHANNEL), { status: "missing" })
        assert.deepStrictEqual(yield* fake.invoke(channels.INSTALL_PLUGIN_CHANNEL), {
          plugin: { status: "current", bundledVersion: "0.2.0", installedVersion: "0.2.0", folder },
          restartGame: false
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.PLUGIN_STATUS_CHANNEL, { folder: "/etc" }))).cause),
          /undefined/
        )
      })
    ))

  it.effect("opens only web links externally", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
        assert.isTrue(yield* fake.invoke(channels.OPEN_EXTERNAL_CHANNEL, { url: "https://example.com/a" }))
        assert.isFalse(yield* fake.invoke(channels.OPEN_EXTERNAL_CHANNEL, { url: "file:///etc/passwd" }))
        assert.deepStrictEqual(opened, ["https://example.com/a"])
      })
    ))

  it.effect("recolours the sender's window to the page theme", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(channels.SET_WINDOW_THEME_CHANNEL, { dark: false })
        assert.deepStrictEqual(recoloured, [[1, {
          overlay: { color: "#01000000", symbolColor: "#09090b", height: 40 },
          background: "#ffffff"
        }]])
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.SET_WINDOW_THEME_CHANNEL, { dark: "yes" }))).cause),
          /boolean/
        )
      })
    ))

  it.effect("asks Save / Don't save / Cancel in a box modal to the sender's window", () =>
    withHandlers(({ fake, dialogs }) =>
      Effect.gen(function*() {
        const prompt = { message: "Save the changes to Big Loop before closing?", detail: "Or lose them." }
        dialogs.buttons.push(0, 1, 2)
        const choices = yield* Effect.forEach([1, 2, 3, 4], () => fake.invoke(channels.CONFIRM_UNSAVED_CHANNEL, prompt))
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
        assert.deepInclude(yield* fake.invoke(channels.GET_UPDATE_STATE_CHANNEL), {
          status: "available",
          availableVersion: "0.2.1"
        })
        assert.isUndefined(yield* fake.invoke(channels.DOWNLOAD_UPDATE_CHANNEL))
        assert.isUndefined(yield* fake.invoke(channels.INSTALL_UPDATE_CHANNEL))
        assert.deepStrictEqual(updateCalls, { download: 1, install: 1 })
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.DOWNLOAD_UPDATE_CHANNEL, { now: true }))).cause),
          /undefined/
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
        assert.deepStrictEqual(yield* fake.invoke(channels.LOAD_NOTIFICATIONS_CHANNEL), [])
        assert.isUndefined(yield* fake.invoke(channels.SAVE_NOTIFICATIONS_CHANNEL, { records: [record] }))
        assert.deepStrictEqual(yield* fake.invoke(channels.LOAD_NOTIFICATIONS_CHANNEL), [record])

        // A newer version's action, and a broken entry, are dropped; the rest survive.
        const newer = { ...record, id: "n2", actions: [{ label: "Re-import", command: { _tag: "Later" } }] }
        yield* fs.writeFileString(file, JSON.stringify({ formatVersion: 1, notifications: [newer, 3, record] }))
        assert.deepStrictEqual(yield* fake.invoke(channels.LOAD_NOTIFICATIONS_CHANNEL), [record])
        yield* fs.writeFileString(file, "{ not json")
        assert.deepStrictEqual(yield* fake.invoke(channels.LOAD_NOTIFICATIONS_CHANNEL), [])

        const tooMany = Array.from({ length: 101 }, (_, i) => ({ ...record, id: `n${i}` }))
        const error = yield* Effect.flip(fake.invoke(channels.SAVE_NOTIFICATIONS_CHANNEL, { records: tooMany }))
        assert.match(String(error.cause), /length/)
      })
    ))
})
