import { FileLimit, fileLimitOf, type PlayResult, PlaySessionEnded, PushChannels } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, FileSystem, Layer, Option, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { ElectronShell } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { layerProjectsAt } from "../project/layers"
import { MapFiles } from "../project/MapFiles"
import { WindowRegistry } from "../project/WindowRegistry"
import { DesktopSettings } from "../settings/DesktopSettings"
import { layerFakeGamePaths, makeFakePluginBundle, runScoped, tempFakeSteam } from "./fakeSteam"
import { GameLink, PlayFile } from "./GameLink"
import { GamePlay, SESSION_POLL } from "./GamePlay"
import { GameProcess } from "./GameProcess"

const mapText = (publishedFileId: number) =>
  JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: publishedFileId } }, items: [] })

const name = "Map_LevelEditorMain&Loop_me.balledit"

/**
 * GamePlay over a fake Steam with the plugin manager, a project with `name` in it, a game whose process is `game.running`,
 * a shell that counts launches and a window that keeps what main sent, its progress reports apart. `reads.corrupt` makes
 * what's in the game's maps folder read back as other bytes.
 */
const setup = Effect.gen(function*() {
  const { dir, fs, path, steam } = yield* tempFakeSteam
  const bundle = yield* makeFakePluginBundle(dir, "0.2.0")
  const game = { running: false, launches: 0, steamAnswers: true }
  const sent: Array<readonly [string, unknown]> = []
  const progress: Array<unknown> = []
  const reads = { corrupt: false }
  const settings = path.join(dir, "desktop-settings.json")
  // the window started on the project (`--project`); `dir` is where New project would make its siblings
  const project = path.join(dir, "project")
  yield* fs.makeDirectory(project)
  const base = Layer.mergeAll(
    Layer.effect(GameLink, GameLink.make(bundle)),
    layerProjectsAt(dir, "linux", path.join(dir, "userData", "backups"), Option.some(project))
  ).pipe(
    Layer.provideMerge(layerFakeGamePaths(steam.host, settings)),
    Layer.provideMerge(Layer.effect(WindowRegistry, WindowRegistry.make(path.join(dir, "windows"), 1, () => true))),
    Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(settings))),
    Layer.provideMerge(ElectronWindow.layerTest({
      sendAll: (channel, payload) =>
        Effect.sync(() =>
          void (channel === PushChannels.onGameWriteProgress ? progress.push(payload) : sent.push([channel, payload]))
        )
    }))
  )
  const fakes = Layer.mergeAll(
    Layer.succeed(GameProcess, GameProcess.of({ isRunning: Effect.sync(() => game.running) })),
    Layer.succeed(
      ElectronShell,
      ElectronShell.of({
        openExternal: () => Effect.succeed(false),
        launchGame: Effect.sync(() => {
          game.launches++
          return game.steamAnswers
        }),
        openFolder: () => Effect.succeed(false)
      })
    )
  )
  const services = yield* Layer.build(
    // GamePlay sees the fake process; GameLink keeps the fake Steam's.
    Layer.effect(GamePlay, GamePlay.make).pipe(Layer.provide(fakes), Layer.provideMerge(base))
  ).pipe(
    Effect.provideService(FileSystem.FileSystem, {
      ...fs,
      readFile: (file) =>
        reads.corrupt && file.startsWith(steam.maps) ? Effect.succeed(new Uint8Array([0])) : fs.readFile(file)
    })
  )
  const play = yield* GamePlay.pipe(Effect.provide(services))
  const files = yield* MapFiles.pipe(Effect.provide(services))
  const link = yield* GameLink.pipe(Effect.provide(services))
  yield* files.create(name, mapText(-1))
  const playJson = path.join(steam.plugins, "ballest-editor-link", "play.json")
  /** Nothing reached the game: no export, no request for the plugin, no launch. */
  const wroteNothing = Effect.gen(function*() {
    assert.isFalse(yield* fs.exists(path.join(steam.maps, name)))
    assert.isFalse(yield* fs.exists(playJson))
    assert.strictEqual(game.launches, 0)
  })
  return {
    fs,
    path,
    dir,
    steam,
    game,
    sent,
    progress,
    reads,
    files,
    link,
    play,
    playJson,
    wroteNothing
  }
})

const played = (result: PlayResult) =>
  result._tag === "Played" ? result : assert.fail(`expected Played, got ${result._tag}`)

const readPlay = (fs: FileSystem.FileSystem, file: string) =>
  fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(PlayFile))))

/** Lets forked work (the session follower) run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

describe("GamePlay.play", () => {
  it.effect("exports the map, writes play.json for the plugin and starts the game", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, game, link, play, playJson } = yield* setup
      yield* link.installPlugin
      const result = played(yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false }))
      assert.strictEqual(yield* fs.readFileString(path.join(steam.maps, name)), mapText(-1))
      assert.deepInclude(result, { sent: true, launch: "launched" })
      assert.strictEqual(result.plugin.status, "current")
      assert.strictEqual(game.launches, 1)
      const first = yield* readPlay(fs, playJson)
      assert.strictEqual(first.map, name)

      // Again, with the game up: a new nonce, no second launch.
      game.running = true
      const again = played(yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false }))
      assert.strictEqual(again.launch, "running")
      assert.strictEqual(game.launches, 1)
      const second = yield* readPlay(fs, playJson)
      assert.notStrictEqual(second.nonce, first.nonce)
      // Nothing else lands in the plugin's folder (the temp file is renamed over play.json).
      assert.deepStrictEqual((yield* fs.readDirectory(path.dirname(playJson))).sort(), [
        "info.toml",
        "main.as",
        "play.json"
      ])
    })))

  it.effect("reports reading the copy back, then the handoff, and nothing for a Play that stops at a refusal", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, progress, play } = yield* setup
      const payload = { fileName: name, replacePublished: false, overwriteChanged: false }
      yield* play.play(payload)
      assert.deepStrictEqual(progress, [{ fileName: name, stage: "verify" }, { fileName: name, stage: "launch" }])

      progress.length = 0
      yield* fs.writeFileString(path.join(steam.maps, name), mapText(3561234567))
      assert.strictEqual((yield* play.play(payload))._tag, "Published")
      assert.deepStrictEqual(progress, [])
    })))

  it.effect("fails a Play whose copy doesn't read back as what was written, and records no export", () =>
    runScoped(Effect.gen(function*() {
      const { game, reads, play } = yield* setup
      reads.corrupt = true
      const failed = yield* Effect.flip(play.play({ fileName: name, replacePublished: false, overwriteChanged: false }))
      assert.strictEqual(failed._tag, "ExportUnverifiedError")
      assert.strictEqual(game.launches, 0)
    })))

  it.effect("without the plugin, exports and starts the game but writes nothing into the plugins folder", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, game, play } = yield* setup
      const result = played(yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false }))
      assert.deepInclude(result, { sent: false, launch: "launched" })
      assert.strictEqual(result.plugin.status, "missing")
      assert.isTrue(yield* fs.exists(path.join(steam.maps, name)))
      assert.deepStrictEqual(yield* fs.readDirectory(steam.plugins), [])
      assert.strictEqual(game.launches, 1)
    })))

  it.effect("says when Steam couldn't be asked to start the game", () =>
    runScoped(Effect.gen(function*() {
      const { game, play } = yield* setup
      game.steamAnswers = false
      assert.strictEqual(
        played(yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false })).launch,
        "failed"
      )
    })))

  it.effect("refuses a published map, which the plugin manager won't race, and writes nothing", () =>
    runScoped(Effect.gen(function*() {
      const { files, link, play, wroteNothing } = yield* setup
      yield* link.installPlugin
      yield* files.save(name, mapText(3561234567))
      assert.deepStrictEqual(yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false }), {
        _tag: "PublishedMap"
      })
      yield* wroteNothing
    })))

  it.effect("refuses a file past the character limit with the reason, and writes nothing", () =>
    runScoped(
      Effect.gen(function*() {
        const { fs, path, dir, steam, game, link, play, playJson } = yield* setup
        yield* link.installPlugin
        // 65 characters in 66 bytes (`é` and NULs), past a small limit (fileLimit.ipc.test.ts proves the game's)
        const map = path.join(dir, "project", "maps", name)
        yield* fs.writeFileString(map, "é")
        yield* fs.truncate(map, 66)
        const refused = yield* Effect.flip(
          play.play({ fileName: name, replacePublished: true, overwriteChanged: true })
        )
        assert.match(refused.message, /^The map's file has 65 characters \(maximum 64\)/)
        const written = yield* Effect.forEach([path.join(steam.maps, name), playJson], (file) => fs.exists(file))
        assert.deepStrictEqual({ written, launches: game.launches }, { written: [false, false], launches: 0 })
      }).pipe(Effect.provideService(FileLimit, fileLimitOf(64)))
    ))

  it.effect("asks before writing over a published map's draft in the maps folder, as Export does", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, dir, steam, link, play, playJson } = yield* setup
      yield* link.installPlugin
      const draft = path.join(steam.maps, name)
      yield* fs.makeDirectory(steam.maps, { recursive: true })
      yield* fs.writeFileString(draft, mapText(3561234567))
      assert.deepStrictEqual(yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false }), {
        _tag: "Published",
        file: { path: draft, name },
        publishedFileId: 3561234567
      })
      assert.isFalse(yield* fs.exists(playJson))
      played(yield* play.play({ fileName: name, replacePublished: true, overwriteChanged: false }))
      assert.strictEqual(yield* fs.readFileString(draft), mapText(-1))
      // The game's copy it wrote over is in the backups.
      assert.lengthOf(yield* fs.readDirectory(path.join(dir, "userData", "backups")), 1)
    })))
})

describe("GamePlay.openInGame", () => {
  const payload = { fileName: name, replacePublished: false, overwriteChanged: false, force: false }
  const answers = (fs: FileSystem.FileSystem, folder: string, outcome: string, nonce: number) =>
    Effect.andThen(
      fs.makeDirectory(folder, { recursive: true }),
      fs.writeFileString(`${folder}/ballest-editor-link.txt`, `edited=${nonce} ${outcome}\r\n`)
    )

  it.effect("exports the map, writes an edit request for the plugin and starts the game", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, game, link, play, playJson } = yield* setup
      yield* link.installPlugin
      assert.deepInclude(yield* play.openInGame(payload), { _tag: "Opening", launch: "launched", outcome: "pending" })
      assert.strictEqual(yield* fs.readFileString(path.join(steam.maps, name)), mapText(-1))
      assert.deepInclude(yield* readPlay(fs, playJson), { map: name, mode: "edit", force: false })
      assert.strictEqual(game.launches, 1)
      // told to replace what the in-game editor holds: the plugin hears so
      yield* play.openInGame({ ...payload, force: true })
      assert.deepInclude(yield* readPlay(fs, playJson), { map: name, mode: "edit", force: true })
    })))

  it.effect("writes nothing without a plugin that can open maps: an older one would race the map", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, play, playJson, wroteNothing } = yield* setup
      yield* fs.makeDirectory(path.dirname(playJson), { recursive: true })
      yield* fs.writeFileString(path.join(path.dirname(playJson), "info.toml"), "[meta]\nversion = \"0.1.0\"\n")
      yield* fs.writeFileString(path.join(path.dirname(playJson), "main.as"), "// 0.1.0\n")
      const result = yield* play.openInGame(payload)
      assert.strictEqual(result._tag === "NeedsPlugin" && result.plugin.status, "outdated")
      yield* wroteNothing
    })))

  it.effect("writes nothing while the game still runs the plugin it loaded before an update", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, link, play, wroteNothing } = yield* setup
      yield* link.installPlugin
      const log = path.join(path.dirname(steam.maps), "PluginManager", "host.log")
      yield* fs.makeDirectory(path.dirname(log), { recursive: true })
      yield* fs.writeFileString(
        log,
        "[12:25:51.840] [info] [host] Ballest plugin host 0.34.2 starting\r\n[12:25:52.000] [info] [ballest-editor-link] loaded Ballest Editor link 0.1.0\r\n"
      )
      yield* fs.makeDirectory(path.join(steam.host.procDir, "4242"), { recursive: true })
      yield* fs.writeFileString(
        path.join(steam.host.procDir, "4242", "cmdline"),
        "wine\0Z:\\games\\Ballest\\Binaries\\Win64\\Ballest-Win64-Shipping.exe\0"
      )
      const result = yield* play.openInGame(payload)
      assert.isTrue(result._tag === "NeedsPlugin" && result.plugin.runningOlder)
      yield* wroteNothing
    })))

  it.effect("opens a published map's draft, which Play refuses", () =>
    runScoped(Effect.gen(function*() {
      const { link, play, files } = yield* setup
      yield* link.installPlugin
      const published = "Map_LevelEditorMain&Live_me.balledit"
      yield* files.create(published, mapText(123))
      assert.strictEqual((yield* play.openInGame({ ...payload, fileName: published }))._tag, "Opening")
    })))

  it.live("tells a running game's answer, and that an export it loaded is no older than its copy", () =>
    runScoped(Effect.gen(function*() {
      const { dir, fs, path, steam, game, link, play, playJson, files } = yield* setup
      yield* link.installPlugin
      game.running = true
      // what MapExports looks at to know the game is up
      yield* fs.makeDirectory(path.join(steam.host.procDir, "4242"), { recursive: true })
      yield* fs.writeFileString(
        path.join(steam.host.procDir, "4242", "cmdline"),
        "wine\0Z:\\games\\Ballest\\Binaries\\Win64\\Ballest-Win64-Shipping.exe\0"
      )
      const storage = path.join(path.dirname(steam.maps), "PluginManager", "storage")
      const answered = (outcome: string) =>
        Effect.gen(function*() {
          yield* fs.remove(playJson, { force: true })
          const asked = yield* Effect.forkChild(play.openInGame(payload))
          while (!(yield* fs.exists(playJson))) yield* Effect.sleep("5 millis")
          const { nonce } = yield* readPlay(fs, playJson)
          yield* answers(fs, storage, outcome, nonce)
          return yield* Fiber.join(asked)
        })
      const stale = Effect.map(files.info(path.join(dir, "project"), name), (map) => map.link?.exportedWhileRunning)
      assert.deepInclude(yield* answered("unsaved Big Loop"), {
        outcome: "unsaved",
        inGame: "Big Loop",
        launch: "running"
      })
      assert.isTrue(yield* stale)
      assert.deepInclude(yield* answered("opened"), { outcome: "opened", inGame: null, launch: "running" })
      assert.isFalse(yield* stale)
      // pressed again: the same bytes are no newer than what the game loaded
      assert.deepInclude(yield* answered("unsaved Big Loop"), { outcome: "unsaved" })
      assert.isFalse(yield* stale)
    })))
})

describe("GamePlay.sessionEnds", () => {
  it.effect("says when the game a Play started has closed, once, with the last map raced", () =>
    runScoped(Effect.gen(function*() {
      const { files, game, sent, play } = yield* setup
      const other = "Map_LevelEditorMain&Other_me.balledit"
      yield* files.create(other, mapText(-1))
      const ends = yield* Stream.runCollect(Stream.take(play.sessionEnds, 1)).pipe(Effect.forkChild)
      yield* settle

      yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false })
      yield* settle
      // The game takes a while to start.
      yield* TestClock.adjust(SESSION_POLL)
      game.running = true
      yield* TestClock.adjust(SESSION_POLL)
      yield* play.play({ fileName: other, replacePublished: false, overwriteChanged: false })
      yield* TestClock.adjust("1 minute")
      assert.lengthOf(sent, 0)

      game.running = false
      yield* TestClock.adjust(SESSION_POLL)
      const [ended] = yield* Fiber.join(ends)
      assert.strictEqual(ended?.fileName, other)
      assert.lengthOf(sent, 1)
      const [channel, payload] = sent[0]!
      assert.strictEqual(channel, PushChannels.onPlaySessionEnded)
      const decoded = yield* Schema.decodeUnknownEffect(PlaySessionEnded)(payload)
      assert.strictEqual(decoded.fileName, other)

      // Nothing more until the next Play.
      yield* TestClock.adjust("1 hour")
      assert.lengthOf(sent, 1)
    })))

  it.effect("drops a session whose game never started, and follows the next Play's", () =>
    runScoped(Effect.gen(function*() {
      const { game, sent, play } = yield* setup
      yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false })
      yield* settle
      yield* TestClock.adjust("10 minutes")
      game.running = true
      yield* TestClock.adjust("1 minute")
      game.running = false
      yield* TestClock.adjust("1 minute")
      assert.lengthOf(sent, 0)

      game.running = true
      yield* play.play({ fileName: name, replacePublished: false, overwriteChanged: false })
      yield* settle
      game.running = false
      yield* TestClock.adjust(SESSION_POLL)
      assert.lengthOf(sent, 1)
    })))
})
