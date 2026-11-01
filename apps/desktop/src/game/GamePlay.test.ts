import { type PlayResult, PlaySessionEnded } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, FileSystem, Layer, Path, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { ElectronShell } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { PLAY_SESSION_ENDED_CHANNEL } from "../ipc/channels"
import { Backups } from "../project/Backups"
import { sha256 } from "../project/files"
import { MapLinks } from "../project/MapLinks"
import { Projects } from "../project/Projects"
import { DesktopSettings } from "../settings/DesktopSettings"
import { layerFakeGamePaths, makeFakePluginBundle, makeFakeSteam, runScoped } from "./fakeSteam"
import { GameLink, PlayFile } from "./GameLink"
import { GamePlay, SESSION_POLL } from "./GamePlay"
import { GameProcess } from "./GameProcess"

// The shell and the window are fakes below; only the module import needs a stand-in.
vi.mock("electron", () => ({}))

const mapText = (publishedFileId: number) =>
  JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: publishedFileId } }, items: [] })

const name = "Map_LevelEditorMain&Loop_me.balledit"

/**
 * GamePlay over a fake Steam with the plugin manager, a project with `name` in it, a game whose process is `game.running`,
 * a shell that counts launches and a window that keeps what main sent.
 */
const setup = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = yield* fs.makeTempDirectoryScoped()
  const steam = yield* makeFakeSteam(dir, { game: "steam", ran: true, pluginManager: true })
  const bundle = yield* makeFakePluginBundle(dir, "0.2.0")
  const game = { running: false, launches: 0, steamAnswers: true }
  const sent: Array<readonly [string, unknown]> = []
  const settings = path.join(dir, "desktop-settings.json")
  const base = Layer.mergeAll(
    Layer.effect(GameLink, GameLink.make(bundle)),
    Layer.effect(Projects, Projects.make(path.join(dir, "project"), "linux", path.join(dir, "userData", "backups")))
      .pipe(Layer.provide(Layer.mergeAll(MapLinks.layer, Backups.layer)))
  ).pipe(
    Layer.provideMerge(layerFakeGamePaths(steam.host, settings)),
    Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(settings)))
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
    ),
    ElectronWindow.layerTest({ sendAll: (channel, payload) => Effect.sync(() => void sent.push([channel, payload])) })
  )
  const services = yield* Layer.build(
    // GamePlay sees the fake process; GameLink keeps the fake Steam's.
    Layer.effect(GamePlay, GamePlay.make).pipe(Layer.provide(fakes), Layer.provideMerge(base))
  )
  const play = yield* GamePlay.pipe(Effect.provide(services))
  const projects = yield* Projects.pipe(Effect.provide(services))
  const link = yield* GameLink.pipe(Effect.provide(services))
  yield* projects.create(name, mapText(-1))
  return {
    fs,
    path,
    dir,
    steam,
    game,
    sent,
    projects,
    link,
    play,
    playJson: path.join(steam.plugins, "ballest-editor-link", "play.json")
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
      const result = played(yield* play.play({ fileName: name, replacePublished: false }))
      const exported = path.join(steam.maps, name)
      assert.strictEqual(yield* fs.readFileString(exported), mapText(-1))
      assert.deepStrictEqual(result.file, { path: exported, name })
      assert.strictEqual(result.link.export?.hash, sha256(new TextEncoder().encode(mapText(-1))))
      assert.deepInclude(result, { sent: true, launch: "launched" })
      assert.strictEqual(result.plugin.status, "current")
      assert.strictEqual(game.launches, 1)
      const first = yield* readPlay(fs, playJson)
      assert.strictEqual(first.map, name)

      // Again, with the game up: a new nonce, no second launch.
      game.running = true
      const again = played(yield* play.play({ fileName: name, replacePublished: false }))
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

  it.effect("without the plugin, exports and starts the game but writes nothing into the plugins folder", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, game, play } = yield* setup
      const result = played(yield* play.play({ fileName: name, replacePublished: false }))
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
      assert.strictEqual(played(yield* play.play({ fileName: name, replacePublished: false })).launch, "failed")
    })))

  it.effect("refuses a published map, which the plugin manager won't race, and writes nothing", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, steam, game, projects, link, play, playJson } = yield* setup
      yield* link.installPlugin
      yield* projects.save(name, mapText(3561234567))
      assert.deepStrictEqual(yield* play.play({ fileName: name, replacePublished: false }), {
        _tag: "PublishedMap",
        fileName: name,
        publishedFileId: 3561234567
      })
      assert.isFalse(yield* fs.exists(path.join(steam.maps, name)))
      assert.isFalse(yield* fs.exists(playJson))
      assert.strictEqual(game.launches, 0)
    })))

  it.effect("asks before writing over a published map's draft in the maps folder, as Export does", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, dir, steam, link, play, playJson } = yield* setup
      yield* link.installPlugin
      const draft = path.join(steam.maps, name)
      yield* fs.makeDirectory(steam.maps, { recursive: true })
      yield* fs.writeFileString(draft, mapText(3561234567))
      assert.deepStrictEqual(yield* play.play({ fileName: name, replacePublished: false }), {
        _tag: "Published",
        file: { path: draft, name },
        publishedFileId: 3561234567
      })
      assert.isFalse(yield* fs.exists(playJson))
      played(yield* play.play({ fileName: name, replacePublished: true }))
      assert.strictEqual(yield* fs.readFileString(draft), mapText(-1))
      // The game's copy it wrote over is in the backups.
      assert.lengthOf(yield* fs.readDirectory(path.join(dir, "userData", "backups")), 1)
    })))
})

describe("GamePlay.sessionEnds", () => {
  it.effect("says when the game a Play started has closed, once, with the last map raced", () =>
    runScoped(Effect.gen(function*() {
      const { projects, game, sent, play } = yield* setup
      const other = "Map_LevelEditorMain&Other_me.balledit"
      yield* projects.create(other, mapText(-1))
      const ends = yield* Stream.runCollect(Stream.take(play.sessionEnds, 1)).pipe(Effect.forkChild)
      yield* settle

      yield* play.play({ fileName: name, replacePublished: false })
      yield* settle
      // The game takes a while to start.
      yield* TestClock.adjust(SESSION_POLL)
      game.running = true
      yield* TestClock.adjust(SESSION_POLL)
      yield* play.play({ fileName: other, replacePublished: false })
      yield* TestClock.adjust("1 minute")
      assert.lengthOf(sent, 0)

      game.running = false
      yield* TestClock.adjust(SESSION_POLL)
      const [ended] = yield* Fiber.join(ends)
      assert.strictEqual(ended?.fileName, other)
      assert.lengthOf(sent, 1)
      const [channel, payload] = sent[0]!
      assert.strictEqual(channel, PLAY_SESSION_ENDED_CHANNEL)
      const decoded = yield* Schema.decodeUnknownEffect(PlaySessionEnded)(payload)
      assert.strictEqual(decoded.fileName, other)

      // Nothing more until the next Play.
      yield* TestClock.adjust("1 hour")
      assert.lengthOf(sent, 1)
    })))

  it.effect("drops a session whose game never started, and follows the next Play's", () =>
    runScoped(Effect.gen(function*() {
      const { game, sent, play } = yield* setup
      yield* play.play({ fileName: name, replacePublished: false })
      yield* settle
      yield* TestClock.adjust("10 minutes")
      game.running = true
      yield* TestClock.adjust("1 minute")
      game.running = false
      yield* TestClock.adjust("1 minute")
      assert.lengthOf(sent, 0)

      game.running = true
      yield* play.play({ fileName: name, replacePublished: false })
      yield* settle
      game.running = false
      yield* TestClock.adjust(SESSION_POLL)
      assert.lengthOf(sent, 1)
    })))
})
