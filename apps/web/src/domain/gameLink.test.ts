import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { creatorOf } from "./creator"
import {
  anythingMissing,
  GAME_FOUND,
  GAME_NOT_FOUND,
  type GameFolders,
  gameLinkChanges,
  gameLinkResultOf,
  type GameLinkRow,
  gameLinkRows,
  MUTABLE_KINDS,
  overriddenFolders,
  pathCrumbs,
  playWithoutPluginNotice,
  PLUGIN_MANAGER_FOUND,
  PLUGIN_MANAGER_MISSING,
  PLUGIN_MISSING,
  type PluginLookup,
  pluginUpdateNotice
} from "./gameLink"

const PLUGINS = "/game/Ballest/Binaries/Win64/plugins"

const everything: GameFolders = {
  install: { status: "found", path: "/game" },
  mapsFolder: { status: "found", path: "/pfx/UserSavedMaps" },
  pluginsFolder: { status: "found", path: PLUGINS }
}

const plugin = (status: PluginLookup["status"], installedVersion: string | null = null): PluginLookup => ({
  status,
  bundledVersion: "0.2.0",
  installedVersion,
  folder: `${PLUGINS}/ballest-editor-link`,
  hostVersion: "0.34.2",
  requiredHost: "0.34.0",
  hostTooOld: false
})

const isaac = creatorOf(null, Option.some({ name: "Isaac", source: "steam" }))

/** The rows by id. */
const byId = (rows: ReadonlyArray<GameLinkRow>) => {
  const find = (id: GameLinkRow["id"]) => rows.find((row) => row.id === id) ?? assert.fail(`no ${id} row`)
  return {
    install: find("install"),
    mapsFolder: find("mapsFolder"),
    creator: find("creator"),
    pluginManager: find("pluginManager"),
    plugin: find("plugin")
  }
}

describe("Game link checklist", () => {
  it("finds everything: each row has its path, Reveal and Choose folder…, and the creator's row names them", () => {
    const rows = gameLinkRows(everything, plugin("current", "0.2.0"), isaac)
    assert.isTrue(rows.every((row) => row.state === "ok"))
    assert.deepStrictEqual(rows.map((row) => row.id), ["install", "mapsFolder", "creator", "pluginManager", "plugin"])
    const { creator, install, mapsFolder, pluginManager, plugin: editorPlugin } = byId(rows)
    assert.strictEqual(creator.title, "Isaac")
    assert.deepInclude(install, {
      note: "Found through Steam.",
      path: "/game",
      reveal: "install",
      reset: null,
      fixes: [{ _tag: "ChooseFolder", which: "install" }]
    })
    assert.deepInclude(mapsFolder, {
      path: "/pfx/UserSavedMaps",
      reveal: "mapsFolder",
      fixes: [{ _tag: "ChooseFolder", which: "mapsFolder" }]
    })
    assert.deepInclude(pluginManager, {
      path: PLUGINS,
      reveal: "pluginsFolder",
      fixes: [{ _tag: "ChooseFolder", which: "pluginsFolder" }]
    })
    assert.deepInclude(editorPlugin, { title: "ballest-editor-link 0.2.0", status: "Version 0.2.0", fixes: [] })
    assert.deepStrictEqual([install.status, mapsFolder.status, pluginManager.status], ["Found", "Found", "Found"])
    assert.deepStrictEqual(overriddenFolders(everything), [])
  })

  it("is looking until the lookups are in", () => {
    const rows = gameLinkRows(null, null, isaac)
    assert.deepStrictEqual(rows.map((row) => row.state), ["waiting", "waiting", "ok", "waiting", "waiting"])
  })

  it("without the game offers Choose folder…, and the rows that depend on it wait", () => {
    const paths: GameFolders = {
      install: { status: "missing", path: null },
      mapsFolder: { status: "missing", path: null },
      pluginsFolder: { status: "missing", path: null }
    }
    const { install, mapsFolder, pluginManager, plugin: editorPlugin } = byId(
      gameLinkRows(paths, plugin("noGame"), isaac)
    )
    assert.deepInclude(install, {
      state: "missing",
      title: "Couldn't find Ballest of Them All",
      status: "Not found",
      fixes: [{ _tag: "ChooseFolder", which: "install" }]
    })
    assert.deepInclude(mapsFolder, { state: "waiting", fixes: [] })
    assert.deepInclude(pluginManager, { state: "waiting", reset: null, fixes: [] })
    assert.deepInclude(editorPlugin, { state: "waiting", fixes: [] })
  })

  it("without the game can still reset a plugins folder chosen here", () => {
    const paths: GameFolders = {
      install: { status: "missing", path: null },
      mapsFolder: { status: "missing", path: null },
      pluginsFolder: { status: "overridden", path: PLUGINS }
    }
    const { pluginManager } = byId(gameLinkRows(paths, plugin("noGame"), isaac))
    assert.deepInclude(pluginManager, { state: "waiting", reset: "pluginsFolder" })
  })

  it("with the game but no maps folder yet says to run the game once", () => {
    const paths: GameFolders = { ...everything, mapsFolder: { status: "missing", path: "/pfx/UserSavedMaps" } }
    assert.deepInclude(byId(gameLinkRows(paths, plugin("current", "0.2.0"), isaac)).mapsFolder, {
      state: "missing",
      title: "Run the game once to create its maps folder",
      status: "Run the game once to create its maps folder",
      reveal: null,
      fixes: [{ _tag: "ChooseFolder", which: "mapsFolder" }]
    })
  })

  it("says which folders were chosen here, and offers to reset each to the one Steam knows about", () => {
    const paths: GameFolders = {
      install: { status: "overridden", path: "/elsewhere" },
      mapsFolder: { status: "found", path: "/pfx/UserSavedMaps" },
      pluginsFolder: { status: "overridden", path: "/elsewhere/plugins" }
    }
    const { install, mapsFolder, pluginManager } = byId(gameLinkRows(paths, plugin("current", "0.2.0"), isaac))
    assert.deepInclude(install, {
      state: "ok",
      note: "Chosen here instead of the one Steam knows about.",
      path: "/elsewhere",
      reset: "install"
    })
    assert.deepInclude(mapsFolder, { note: "Found next to the game. Export to game writes here.", reset: null })
    assert.deepInclude(pluginManager, { path: "/elsewhere/plugins", reset: "pluginsFolder" })
    assert.deepStrictEqual(overriddenFolders(paths), ["install", "pluginsFolder"])
    assert.deepStrictEqual(overriddenFolders(null), [])
  })

  it("without the plugin manager links to its install docs and lets its plugins folder be chosen; the plugin waits", () => {
    const paths: GameFolders = { ...everything, pluginsFolder: { status: "missing", path: PLUGINS } }
    const { pluginManager, plugin: editorPlugin } = byId(gameLinkRows(paths, plugin("noPluginManager"), isaac))
    // optional: only Play needs it, so nothing is wrong, but the row still carries the fix
    assert.deepInclude(pluginManager, {
      state: "optional",
      title: "Not installed (optional, for Play)",
      fixes: [{ _tag: "OpenPluginDocs" }, { _tag: "ChooseFolder", which: "pluginsFolder" }]
    })
    assert.isFalse(anythingMissing(gameLinkRows(paths, plugin("noPluginManager"), isaac)))
    assert.deepInclude(editorPlugin, { state: "waiting", fixes: [] })
  })

  it("without the plugin manager in a plugins folder chosen here offers to reset it", () => {
    const paths: GameFolders = { ...everything, pluginsFolder: { status: "overridden", path: "/elsewhere" } }
    assert.deepInclude(byId(gameLinkRows(paths, plugin("noPluginManager"), isaac)).pluginManager, {
      state: "optional",
      path: "/elsewhere",
      reset: "pluginsFolder",
      fixes: [{ _tag: "OpenPluginDocs" }]
    })
  })

  it("asks for the plugin manager first when it is too old to run the app's plugin", () => {
    const old = { ...plugin("outdated", "0.1.0"), hostVersion: "0.33.2", hostTooOld: true }
    const row = byId(gameLinkRows(everything, old, isaac)).plugin
    assert.deepInclude(row, { state: "missing", title: "Plugin manager needs 0.34.0 (the game has 0.33.2)" })
    assert.deepStrictEqual(row.fixes, [])
  })

  it("prompts for what an update needs next, and for nothing when there is none", () => {
    const wanted = "open maps in the in-game editor"
    assert.isNull(pluginUpdateNotice(plugin("current", "0.2.0"), wanted))
    assert.isNull(pluginUpdateNotice(plugin("missing"), wanted))
    assert.isNull(pluginUpdateNotice({ ...plugin("noPluginManager"), hostTooOld: true }, wanted))
    assert.deepInclude(pluginUpdateNotice(plugin("outdated", "0.1.0"), wanted), {
      title: `Update the editor's plugin to ${wanted}`,
      actions: [{ label: "Update plugin", command: { _tag: "InstallPlugin" } }]
    })
    const old = { ...plugin("outdated", "0.1.0"), hostVersion: "0.33.2", hostTooOld: true }
    assert.strictEqual(pluginUpdateNotice(old, wanted)?.title, `Update the plugin manager to ${wanted}`)
  })

  it("offers Install with the version it installs for a missing plugin, and Update for an older one", () => {
    assert.deepInclude(byId(gameLinkRows(everything, plugin("missing"), isaac)).plugin, {
      state: "missing",
      title: "Not installed",
      fixes: [{ _tag: "InstallPlugin", label: "Install 0.2.0" }]
    })
    assert.deepInclude(byId(gameLinkRows(everything, plugin("outdated", "0.1.0"), isaac)).plugin, {
      state: "missing",
      title: "Version 0.1.0 is installed",
      fixes: [{ _tag: "InstallPlugin", label: "Update" }]
    })
  })

  it("writes a folder's path as a breadcrumb, from Steam when it is in a library", () => {
    const prefix = "steamapps/compatdata/3339810/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved"
    assert.deepStrictEqual(pathCrumbs(`/home/player/.local/share/Steam/${prefix}/UserSavedMaps`), [
      "Steam",
      "compatdata",
      "…",
      "UserSavedMaps"
    ])
    assert.deepStrictEqual(pathCrumbs(`/mnt/games/SteamLibrary/${prefix}/UserSavedMaps`), [
      "Steam",
      "compatdata",
      "…",
      "UserSavedMaps"
    ])
    assert.deepStrictEqual(pathCrumbs("D:\\SteamLibrary\\steamapps\\common\\Ballest of Them All"), [
      "Steam",
      "common",
      "Ballest of Them All"
    ])
    assert.deepStrictEqual(pathCrumbs("C:\\Users\\player\\AppData\\Local\\Ballest\\Saved\\UserSavedMaps"), [
      "C:",
      "Users",
      "…",
      "UserSavedMaps"
    ])
    assert.deepStrictEqual(pathCrumbs("/mnt/games/plugins"), ["mnt", "games", "plugins"])
    assert.deepStrictEqual(pathCrumbs("/"), ["/"])
  })

  it("shows the creator in use and where it is from, and a name that can't be used", () => {
    const rows = (creator: ReturnType<typeof creatorOf>) => byId(gameLinkRows(everything, plugin("current"), creator))
    assert.match(rows(isaac).creator.note!, /^From Steam\./)
    assert.match(rows(creatorOf("Speedy", Option.none())).creator.note!, /^Typed in Settings/)
    assert.deepInclude(rows(creatorOf(null, Option.none())).creator, {
      state: "missing",
      title: "No creator name",
      fixes: [{ _tag: "EditCreator" }]
    })
    const odd = rows(creatorOf(null, Option.some({ name: "x_y ★", source: "steam" }))).creator
    assert.strictEqual(odd.state, "missing")
    assert.match(odd.note!, /has characters a map file name can't have/)
  })
})

describe("Game link notifications", () => {
  const found = { game: true, pluginManager: true }
  const kinds = (changes: ReturnType<typeof gameLinkChanges>) => changes.notices.map((n) => n.kind)

  it("notify nothing on the first launch or when nothing changed", () => {
    assert.deepStrictEqual(kinds(gameLinkChanges(null, { game: false, pluginManager: false })), [])
    assert.deepStrictEqual(kinds(gameLinkChanges(found, found)), [])
    const missing = { game: false, pluginManager: false }
    assert.deepStrictEqual(kinds(gameLinkChanges(missing, missing)), [])
  })

  it("notify the game lost (pinned, with Choose folder…) and found again", () => {
    const lost = gameLinkChanges(found, { game: false, pluginManager: false })
    assert.deepStrictEqual(kinds(lost), [GAME_NOT_FOUND])
    assert.deepInclude(lost.notices[0], { persistent: true, level: "error" })
    assert.deepStrictEqual(lost.notices[0]?.actions.map((a) => a.command), [{
      _tag: "ChooseGamePath",
      which: "install"
    }])
    assert.deepStrictEqual(lost.resolve, [])

    const back = gameLinkChanges({ game: false, pluginManager: false }, found)
    assert.deepStrictEqual(kinds(back), [GAME_FOUND])
    assert.deepStrictEqual(back.resolve, [GAME_NOT_FOUND, PLUGIN_MANAGER_MISSING])
  })

  it("notify the plugin manager appearing and disappearing while the game stays", () => {
    const gone = gameLinkChanges(found, { game: true, pluginManager: false })
    assert.deepStrictEqual(kinds(gone), [PLUGIN_MANAGER_MISSING])
    assert.deepInclude(gone.notices[0], { persistent: true })
    assert.deepStrictEqual(gone.notices[0]?.actions[0]?.command._tag, "OpenExternal")
    assert.deepStrictEqual(gone.resolve, [GAME_NOT_FOUND])
    assert.deepStrictEqual(kinds(gameLinkChanges({ game: true, pluginManager: false }, found)), [PLUGIN_MANAGER_FOUND])
  })

  it("reads the result off the folders and the plugin", () => {
    assert.deepStrictEqual(gameLinkResultOf(everything, plugin("missing")), found)
    assert.deepStrictEqual(gameLinkResultOf(everything, plugin("noPluginManager")), {
      game: true,
      pluginManager: false
    })
    assert.deepStrictEqual(
      gameLinkResultOf({ ...everything, install: { status: "overridden", path: "/elsewhere" } }, plugin("current")),
      found
    )
  })
})

describe("Play without the plugin", () => {
  it("shares the Game link's kind for a missing game or plugin manager, and has its own for the plugin", () => {
    const notice = (status: Parameters<typeof playWithoutPluginNotice>[2]) =>
      playWithoutPluginNotice("Big Loop", true, status)
    assert.deepStrictEqual(
      (["noGame", "noPluginManager", "missing"] as const).map((status) => [
        notice(status).kind,
        notice(status).persistent,
        notice(status).actions.map((a) => a.command._tag)
      ]),
      [
        [GAME_NOT_FOUND, true, ["ChooseGamePath"]],
        [PLUGIN_MANAGER_MISSING, true, ["OpenExternal"]],
        [PLUGIN_MISSING, true, ["InstallPlugin"]]
      ]
    )
    assert.match(notice("missing").title, /^Exported Big Loop and started the game\. Install the editor's plugin/)
    assert.isFalse(playWithoutPluginNotice("Big Loop", false, "missing").title.includes("started"))
    assert.isTrue(MUTABLE_KINDS.has(PLUGIN_MISSING))
  })
})
