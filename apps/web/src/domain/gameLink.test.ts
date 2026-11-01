import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { creatorOf } from "./creator"
import {
  allFound,
  GAME_FOUND,
  GAME_NOT_FOUND,
  type GameFolders,
  gameLinkChanges,
  gameLinkResultOf,
  type GameLinkRow,
  gameLinkRows,
  PLUGIN_MANAGER_FOUND,
  PLUGIN_MANAGER_MISSING,
  type PluginLookup
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
  folder: `${PLUGINS}/ballest-editor-link`
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
  it("finds everything: each row has its path and Reveal, and the summary names the creator", () => {
    const rows = gameLinkRows(everything, plugin("current", "0.2.0"), isaac)
    assert.isTrue(allFound(rows))
    assert.deepStrictEqual(rows.map((row) => row.short), ["game", "maps", "creator Isaac", "plugin manager", "plugin"])
    const { install, mapsFolder, pluginManager, plugin: editorPlugin } = byId(rows)
    assert.deepInclude(install, { path: "/game", reveal: "install", fix: null })
    assert.deepInclude(mapsFolder, { path: "/pfx/UserSavedMaps", reveal: "mapsFolder" })
    assert.deepInclude(pluginManager, { path: PLUGINS, reveal: "pluginsFolder" })
    assert.deepInclude(editorPlugin, { title: "ballest-editor-link 0.2.0", fix: null })
  })

  it("is looking until the lookups are in", () => {
    const rows = gameLinkRows(null, null, isaac)
    assert.deepStrictEqual(rows.map((row) => row.state), ["waiting", "waiting", "ok", "waiting", "waiting"])
    assert.isFalse(allFound(rows))
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
      fix: { _tag: "ChooseFolder", which: "install" }
    })
    assert.deepInclude(mapsFolder, { state: "waiting", fix: null })
    assert.deepInclude(pluginManager, { state: "waiting", fix: null })
    assert.deepInclude(editorPlugin, { state: "waiting", fix: null })
  })

  it("with the game but no maps folder yet says to run the game once", () => {
    const paths: GameFolders = { ...everything, mapsFolder: { status: "missing", path: "/pfx/UserSavedMaps" } }
    assert.deepInclude(byId(gameLinkRows(paths, plugin("current", "0.2.0"), isaac)).mapsFolder, {
      state: "missing",
      title: "Run the game once to create its maps folder",
      reveal: null,
      fix: { _tag: "ChooseFolder", which: "mapsFolder" }
    })
  })

  it("without the plugin manager links to its install docs; the plugin waits for it", () => {
    const paths: GameFolders = { ...everything, pluginsFolder: { status: "missing", path: PLUGINS } }
    const { pluginManager, plugin: editorPlugin } = byId(gameLinkRows(paths, plugin("noPluginManager"), isaac))
    assert.deepInclude(pluginManager, {
      state: "missing",
      title: "Play needs the Ballest plugin manager",
      fix: { _tag: "OpenPluginDocs" }
    })
    assert.deepInclude(editorPlugin, { state: "waiting", fix: null })
  })

  it("offers Install for a missing plugin and Update for an older one", () => {
    assert.deepInclude(byId(gameLinkRows(everything, plugin("missing"), isaac)).plugin, {
      state: "missing",
      title: "Not installed",
      fix: { _tag: "InstallPlugin", update: false }
    })
    assert.deepInclude(byId(gameLinkRows(everything, plugin("outdated", "0.1.0"), isaac)).plugin, {
      state: "missing",
      title: "Version 0.1.0 is installed",
      fix: { _tag: "InstallPlugin", update: true }
    })
  })

  it("shows the creator in use and where it is from, and a name that can't be used", () => {
    const rows = (creator: ReturnType<typeof creatorOf>) => byId(gameLinkRows(everything, plugin("current"), creator))
    assert.match(rows(isaac).creator.note!, /^From Steam\./)
    assert.match(rows(creatorOf("Speedy", Option.none())).creator.note!, /^Typed in Settings/)
    assert.deepInclude(rows(creatorOf(null, Option.none())).creator, {
      state: "missing",
      title: "No creator name",
      fix: { _tag: "EditCreator" }
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
