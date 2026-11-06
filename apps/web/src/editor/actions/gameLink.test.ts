import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Option } from "effect"
import { TestClock } from "effect/testing"
import { creatorOf } from "../../domain/creator"
import { allFound, GAME_NOT_FOUND, gameLinkRows, PLUGIN_MANAGER_MISSING } from "../../domain/gameLink"
import { defaultSettings } from "../../domain/Settings"
import { useEditor } from "../../editor/store"
import { GAME_EXE, makeTestDisk, type TestDisk } from "../../test/desktopBridge"
import { layerFor, noticesWhile, s } from "../../test/editorActions"
import {
  checkGameLinkEffect,
  chooseGameLinkFolderEffect,
  findCreatorEffect,
  GAME_LINK_WATCH_INTERVAL,
  installPluginEffect,
  launchGameEffect,
  watchGameLinkEffect
} from "./gameLink"
import { muteNotificationKindEffect } from "./notifications"

describe("launch actions", () => {
  it.effect("Launch starts the game through Steam unless it is running", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      disk.game.running = true
      yield* launchGameEffect
      assert.strictEqual(disk.game.launches, 0)
      disk.game.running = false
      yield* launchGameEffect
      assert.strictEqual(disk.game.launches, 1)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("creator actions", () => {
  it.effect("puts the creator found on the machine in the store, until the user types one", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      s().setSettings(defaultSettings)
      yield* findCreatorEffect
      assert.isTrue(Option.isNone(s().foundCreator))

      disk.game.creator = { name: "Speedy Marble", source: "steam" }
      yield* findCreatorEffect
      assert.deepStrictEqual(creatorOf(s().settings.general.creatorName, s().foundCreator), {
        name: "Speedy Marble",
        source: "steam",
        valid: true
      })
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("plugin actions", () => {
  it.effect("Install puts the plugin in, and says when the game must restart to load it", () => {
    const disk = makeTestDisk()
    return noticesWhile((notices) =>
      Effect.gen(function*() {
        s().setPluginStatus(disk.game.plugin)
        yield* installPluginEffect
        assert.strictEqual(disk.game.pluginInstalls, 1)
        assert.deepInclude(s().pluginStatus, { status: "current", installedVersion: "0.2.0" })
        assert.deepStrictEqual(notices, ["Installed the editor's plugin"])

        disk.game.plugin = { ...disk.game.plugin, status: "outdated", installedVersion: "0.1.0" }
        disk.game.running = true
        s().setPluginStatus(disk.game.plugin)
        yield* installPluginEffect
        assert.strictEqual(notices[1], "Updated the editor's plugin to 0.2.0. Restart the game to use Play.")
      })
    ).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Install fails without the plugin manager, and installs nothing", () => {
    const disk = makeTestDisk()
    disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager" }
    return Effect.gen(function*() {
      const error = yield* Effect.flip(installPluginEffect)
      assert.match(error.message, /plugin manager isn't installed/)
      assert.strictEqual(disk.game.pluginInstalls, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("game link actions", () => {
  const found = { game: true, pluginManager: true }
  const installed = (disk: TestDisk) => {
    disk.game.paths = {
      ...disk.game.paths,
      pluginsFolder: { status: "found", path: "/game/Ballest/Binaries/Win64/plugins" }
    }
    disk.game.plugin = { ...disk.game.plugin, status: "current", installedVersion: "0.2.0" }
  }
  /** What a restart forgets: the store's lookups and notifications (the disk keeps its own). */
  const restart = Effect.sync(() =>
    useEditor.setState({
      notifications: [],
      mutedNotificationKinds: new Set(),
      gameLink: { firstRun: true, last: null },
      gamePathProblem: null,
      gamePaths: null,
      pluginStatus: null
    })
  )
  const kinds = () => s().notifications.map((n) => n.kind)
  const pinned = () => s().notifications.filter((n) => n.persistent && n.resolvedAt === null).map((n) => n.kind)

  it.effect("a first launch that finds everything shows nothing, and neither does the next one", () => {
    const disk = makeTestDisk()
    installed(disk)
    s().setSettings({ ...defaultSettings, general: { ...defaultSettings.general, creatorName: "Isaac" } })
    return Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.isTrue(s().gameLink.firstRun)
      assert.isTrue(allFound(gameLinkRows(s().gamePaths, s().pluginStatus, creatorOf("Isaac", Option.none()))))
      assert.deepStrictEqual(kinds(), [])
      assert.deepStrictEqual(disk.gameLink.last, found)
      assert.isNull(s().dialog)

      yield* restart
      yield* checkGameLinkEffect
      assert.isFalse(s().gameLink.firstRun)
      assert.deepStrictEqual(kinds(), [])
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a first launch opens the dialog for a missing row; a later one only for what Export needs", () => {
    const disk = makeTestDisk()
    installed(disk)
    disk.game.plugin = { ...disk.game.plugin, status: "missing", installedVersion: null }
    s().setSettings({ ...defaultSettings, general: { ...defaultSettings.general, creatorName: "Isaac" } })
    return Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.strictEqual(s().dialog?.id, "gameLink")
      s().closeDialog()

      yield* restart
      yield* checkGameLinkEffect
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a first launch doesn't open the dialog for the optional plugin manager", () => {
    const disk = makeTestDisk()
    installed(disk)
    disk.game.paths = { ...disk.game.paths, pluginsFolder: { status: "missing", path: null } }
    disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager", installedVersion: null }
    s().setSettings({ ...defaultSettings, general: { ...defaultSettings.general, creatorName: "Isaac" } })
    return Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a lost game is pinned; a folder without the exe is refused with the reason, the game's resolves it", () => {
    const disk = makeTestDisk({ [`/games/Ballest of Them All/${GAME_EXE}`]: "" })
    disk.gameLink.last = found
    disk.game.paths = {
      install: { status: "missing", path: null },
      mapsFolder: { status: "missing", path: null },
      pluginsFolder: { status: "missing", path: null }
    }
    disk.game.plugin = { ...disk.game.plugin, status: "noGame", folder: null }
    return Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(pinned(), [GAME_NOT_FOUND])
      assert.deepStrictEqual(disk.gameLink.last, { game: false, pluginManager: false })

      disk.answers.push("/home/me/Downloads")
      yield* chooseGameLinkFolderEffect("install")
      assert.deepInclude(s().gamePathProblem, { which: "install" })
      assert.match(s().gamePathProblem!.message, /^\/home\/me\/Downloads isn't Ballest of Them All's folder/)
      assert.strictEqual(disk.game.paths.install.status, "missing")
      assert.deepStrictEqual(pinned(), [GAME_NOT_FOUND])

      disk.answers.push("/games/Ballest of Them All")
      yield* chooseGameLinkFolderEffect("install")
      assert.isNull(s().gamePathProblem)
      assert.deepStrictEqual(s().gamePaths?.install, { status: "overridden", path: "/games/Ballest of Them All" })
      assert.deepStrictEqual(pinned(), [])
      assert.strictEqual(disk.gameLink.last?.game, true)

      // found again by the next launch: no news, since this session already kept it
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(kinds(), [])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  /** A launch that finds the plugin manager gone since the last one, which found everything. */
  const pluginManagerLost = () => {
    const disk = makeTestDisk()
    disk.gameLink.last = found
    disk.game.plugin = { ...disk.game.plugin, status: "noPluginManager" }
    const launch = Effect.gen(function*() {
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(pinned(), [PLUGIN_MANAGER_MISSING])
    })
    return { disk, launch }
  }

  it.effect("Don't show again keeps the plugin manager's notification hidden across restarts", () => {
    const { disk, launch } = pluginManagerLost()
    return Effect.gen(function*() {
      yield* launch
      assert.strictEqual(s().notifications[0]?.actions[0]?.command._tag, "OpenExternal")

      yield* muteNotificationKindEffect(PLUGIN_MANAGER_MISSING)
      assert.deepStrictEqual(kinds(), [])
      assert.deepStrictEqual(disk.gameLink.muted, [PLUGIN_MANAGER_MISSING])

      // it comes back, then goes again: muted, so nothing shows
      disk.gameLink.last = found
      yield* restart
      yield* checkGameLinkEffect
      assert.deepStrictEqual(kinds(), [])
      assert.isTrue(s().mutedNotificationKinds.has(PLUGIN_MANAGER_MISSING))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("installing the plugin manager resolves its pinned notification on the next look", () => {
    const { disk, launch } = pluginManagerLost()
    return Effect.gen(function*() {
      yield* launch
      disk.game.plugin = { ...disk.game.plugin, status: "missing" }
      yield* chooseGameLinkFolderEffect("mapsFolder")
      // cancelled: nothing looked up again
      assert.deepStrictEqual(pinned(), [PLUGIN_MANAGER_MISSING])
      disk.answers.push("/elsewhere/UserSavedMaps")
      yield* chooseGameLinkFolderEffect("mapsFolder")
      assert.deepStrictEqual(pinned(), [])
      assert.deepStrictEqual(disk.gameLink.last, found)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("the watch flips a row by itself, and leaves a refused folder's reason on its row", () => {
    const { disk, launch } = pluginManagerLost()
    return Effect.gen(function*() {
      yield* launch
      s().setGamePathProblem({ which: "install", message: "Not the game's folder" })
      const watch = yield* Effect.forkChild(watchGameLinkEffect)
      yield* TestClock.adjust(GAME_LINK_WATCH_INTERVAL)
      assert.strictEqual(s().pluginStatus?.status, "noPluginManager")
      const shown = s().gamePaths

      disk.game.plugin = { ...disk.game.plugin, status: "missing" }
      yield* TestClock.adjust(GAME_LINK_WATCH_INTERVAL)
      assert.strictEqual(s().pluginStatus?.status, "missing")
      assert.deepStrictEqual(pinned(), [])
      assert.strictEqual(s().gamePaths, shown, "the folders didn't change, so the store keeps them")
      assert.strictEqual(s().gamePathProblem?.message, "Not the game's folder")

      yield* Fiber.interrupt(watch)
      disk.game.plugin = { ...disk.game.plugin, status: "current" }
      yield* TestClock.adjust(GAME_LINK_WATCH_INTERVAL)
      assert.strictEqual(s().pluginStatus?.status, "missing", "stopped with the page")
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
