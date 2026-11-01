/**
 * The Game link checklist on the Start tab (docs/PROJECTS.md § Shell): the game's install, its maps folder, the
 * creator name, the plugin manager and the editor's plugin, each found or not, with the fix for a missing one. And
 * what changed since the last launch, which is what the notification centre is told about.
 */
import { Option } from "effect"
import { type Creator, creatorProblem, foundCreatorLabel } from "./creator"

/** The three game folders (`GamePathKind` in @ballest/contracts). */
export type GameFolderKind = "install" | "mapsFolder" | "pluginsFolder"

/** How a game folder was found (`GamePath` in @ballest/contracts). */
export interface GameFolder {
  readonly status: "found" | "overridden" | "missing"
  readonly path: string | null
}

export type GameFolders = Readonly<Record<GameFolderKind, GameFolder>>

/** The editor's plugin, compared with the app's copy (`PluginStatus` in @ballest/contracts). */
export interface PluginLookup {
  readonly status: "noGame" | "noPluginManager" | "missing" | "outdated" | "current"
  readonly bundledVersion: string
  readonly installedVersion: string | null
  readonly folder: string | null
}

/** What a launch found, kept until the next one (`GameLinkResult` in @ballest/contracts). */
export interface GameLinkResult {
  readonly game: boolean
  readonly pluginManager: boolean
}

export const gameLinkResultOf = (paths: GameFolders, plugin: PluginLookup): GameLinkResult => ({
  game: paths.install.status !== "missing",
  pluginManager: plugin.status !== "noGame" && plugin.status !== "noPluginManager"
})

export const sameGameLinkResult = (a: GameLinkResult | null, b: GameLinkResult): boolean =>
  a !== null && a.game === b.game && a.pluginManager === b.pluginManager

/** The plugin manager's site, which has its install steps. */
export const PLUGIN_MANAGER_URL = "https://anythinggoes-ballest.github.io/ballest-plugin-manager/"

/** What a checklist row's button does. */
export type GameLinkFix =
  | { readonly _tag: "ChooseFolder"; readonly which: "install" | "mapsFolder" }
  | { readonly _tag: "OpenPluginDocs" }
  | { readonly _tag: "InstallPlugin"; readonly update: boolean }
  | { readonly _tag: "EditCreator" }

/**
 * `ok`: found. `missing`: not found, or not usable; the row carries the fix. `waiting`: still being looked up, or
 * waiting on a row above it (no plugin manager without the game).
 */
export type GameLinkRowState = "ok" | "missing" | "waiting"

export interface GameLinkRow {
  readonly id: "install" | "mapsFolder" | "creator" | "pluginManager" | "plugin"
  /** The row's name, and what the collapsed row calls it ("creator Isaac"). */
  readonly label: string
  readonly short: string
  readonly state: GameLinkRowState
  /** What was found, or what is wrong. */
  readonly title: string
  /** A second line: how it was found, or how to fix it. */
  readonly note: string | null
  /** The folder it is in, when it has one. */
  readonly path: string | null
  /** The game folder Reveal shows; none when there is nothing to show. */
  readonly reveal: GameFolderKind | null
  readonly fix: GameLinkFix | null
}

const LOOKING = "Looking…"

const row = (
  id: GameLinkRow["id"],
  label: string,
  fields: Pick<GameLinkRow, "state" | "title"> & Partial<Omit<GameLinkRow, "id" | "label">>
): GameLinkRow => ({
  id,
  label,
  short: label.toLowerCase(),
  note: null,
  path: null,
  reveal: null,
  fix: null,
  ...fields
})

const folderFound = (folder: GameFolder, which: GameFolderKind) =>
  folder.status === "overridden" ? "Chosen instead of the one Steam lists." : which === "install"
    ? "Found through Steam."
    : "Found next to the game."

const installRow = (paths: GameFolders | null): GameLinkRow => {
  if (paths === null) return row("install", "Game", { state: "waiting", title: LOOKING })
  const { install } = paths
  if (install.status !== "missing") {
    return row("install", "Game", {
      state: "ok",
      title: "Ballest of Them All",
      note: folderFound(install, "install"),
      path: install.path,
      reveal: "install"
    })
  }
  return row("install", "Game", {
    state: "missing",
    title: "Couldn't find Ballest of Them All",
    note:
      "Steam doesn't list it in any of its libraries. Choose the folder that holds Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe.",
    fix: { _tag: "ChooseFolder", which: "install" }
  })
}

const mapsRow = (paths: GameFolders | null): GameLinkRow => {
  const label = "Maps folder"
  if (paths === null) return { ...row("mapsFolder", label, { state: "waiting", title: LOOKING }), short: "maps" }
  const { install, mapsFolder } = paths
  const fields = ((): Parameters<typeof row>[2] => {
    if (mapsFolder.status !== "missing") {
      return {
        state: "ok",
        title: "UserSavedMaps",
        note: `${folderFound(mapsFolder, "mapsFolder")} Export to game writes here.`,
        path: mapsFolder.path,
        reveal: "mapsFolder"
      }
    }
    if (install.status === "missing") return { state: "waiting", title: "Looked for once the game is found" }
    return mapsFolder.path === null
      ? {
        state: "missing",
        title: "Couldn't work out where the game keeps its maps",
        note: "Choose its UserSavedMaps folder.",
        fix: { _tag: "ChooseFolder", which: "mapsFolder" }
      }
      : {
        state: "missing",
        title: "Run the game once to create its maps folder",
        note: "Or choose the folder, if it keeps its maps somewhere else.",
        path: mapsFolder.path,
        fix: { _tag: "ChooseFolder", which: "mapsFolder" }
      }
  })()
  return { ...row("mapsFolder", label, fields), short: "maps" }
}

const creatorRow = (creator: Creator): GameLinkRow => {
  const label = "Creator"
  const edit: GameLinkFix = { _tag: "EditCreator" }
  if (creator.valid) {
    const from = creator.source === "steam" || creator.source === "mapsFolder"
      ? `${foundCreatorLabel(creator.source)}.`
      : "Typed in Settings › General."
    return {
      ...row("creator", label, {
        state: "ok",
        title: creator.name,
        note: `${from} Written into every exported map and its file name.`,
        fix: edit
      }),
      short: `creator ${creator.name}`
    }
  }
  return row("creator", label, {
    state: "missing",
    title: creator.name === "" ? "No creator name" : `Can't use "${creator.name}"`,
    note: Option.getOrElse(
      creatorProblem(creator),
      () => "Neither Steam nor the maps folder names one. New map asks for it; or set it in Settings › General."
    ),
    fix: edit
  })
}

const pluginManagerRow = (paths: GameFolders | null, plugin: PluginLookup | null): GameLinkRow => {
  const label = "Plugin manager"
  if (plugin === null) return row("pluginManager", label, { state: "waiting", title: LOOKING })
  switch (plugin.status) {
    case "noGame":
      return row("pluginManager", label, { state: "waiting", title: "Looked for once the game is found" })
    case "noPluginManager":
      return row("pluginManager", label, {
        state: "missing",
        title: "Play needs the Ballest plugin manager",
        note: "It runs the editor's plugin inside the game. Its site has the install steps.",
        fix: { _tag: "OpenPluginDocs" }
      })
    default:
      return row("pluginManager", label, {
        state: "ok",
        title: "Ballest plugin manager",
        note: "Installed next to the game's exe.",
        path: paths?.pluginsFolder.path ?? null,
        reveal: paths === null || paths.pluginsFolder.status === "missing" ? null : "pluginsFolder"
      })
  }
}

const pluginRow = (plugin: PluginLookup | null): GameLinkRow => {
  const label = "Editor plugin"
  const fields = ((): Parameters<typeof row>[2] => {
    if (plugin === null) return { state: "waiting", title: LOOKING }
    switch (plugin.status) {
      case "noGame":
      case "noPluginManager":
        return { state: "waiting", title: "Waits for the plugin manager" }
      case "missing":
        return {
          state: "missing",
          title: plugin.installedVersion === null ? "Not installed" : "Some of its files are missing",
          note: "Play races the open map in the game through it.",
          path: plugin.folder,
          fix: { _tag: "InstallPlugin", update: false }
        }
      case "outdated":
        return {
          state: "missing",
          title: `Version ${plugin.installedVersion} is installed`,
          note: `This app comes with ${plugin.bundledVersion}.`,
          path: plugin.folder,
          fix: { _tag: "InstallPlugin", update: true }
        }
      case "current":
        return {
          state: "ok",
          title: `ballest-editor-link ${plugin.installedVersion}`,
          note: "Play races the open map in the game through it.",
          path: plugin.folder
        }
    }
  })()
  return { ...row("plugin", label, fields), short: "plugin" }
}

/** The checklist, top to bottom: the game's folders, the creator, then what Play needs. */
export const gameLinkRows = (
  paths: GameFolders | null,
  plugin: PluginLookup | null,
  creator: Creator
): ReadonlyArray<GameLinkRow> => [
  installRow(paths),
  mapsRow(paths),
  creatorRow(creator),
  pluginManagerRow(paths, plugin),
  pluginRow(plugin)
]

export const allFound = (rows: ReadonlyArray<GameLinkRow>): boolean => rows.every((r) => r.state === "ok")

// --- notifications: only when a result changes between launches ---------------------------

/** The game's install is gone (persistent: pinned until it is found again). */
export const GAME_NOT_FOUND = "gameNotFound"
export const GAME_FOUND = "gameFound"
/** The plugin manager is gone (persistent). */
export const PLUGIN_MANAGER_MISSING = "pluginManagerMissing"
export const PLUGIN_MANAGER_FOUND = "pluginManagerFound"

/** The notification kinds whose notifications offer "Don't show again". */
export const MUTABLE_KINDS: ReadonlySet<string> = new Set([
  GAME_NOT_FOUND,
  GAME_FOUND,
  PLUGIN_MANAGER_MISSING,
  PLUGIN_MANAGER_FOUND
])

/** A notification's button (`NotificationCommand` in @ballest/contracts). */
export type GameLinkCommand =
  | { readonly _tag: "ChooseGamePath"; readonly which: "install" }
  | { readonly _tag: "RevealGamePath"; readonly which: GameFolderKind }
  | { readonly _tag: "OpenExternal"; readonly url: string }

export interface GameLinkNotice {
  readonly kind: string
  readonly level: "info" | "error"
  readonly title: string
  readonly body?: string
  readonly persistent: boolean
  readonly actions: ReadonlyArray<{ readonly label: string; readonly command: GameLinkCommand }>
}

const gameLost: GameLinkNotice = {
  kind: GAME_NOT_FOUND,
  level: "error",
  title: "Couldn't find Ballest of Them All",
  body: "It was there last time. Export to game, Launch game and Play need it: choose its folder if it moved.",
  persistent: true,
  actions: [{ label: "Choose folder…", command: { _tag: "ChooseGamePath", which: "install" } }]
}

const gameBack: GameLinkNotice = {
  kind: GAME_FOUND,
  level: "info",
  title: "Found Ballest of Them All",
  persistent: false,
  actions: [{ label: "Reveal", command: { _tag: "RevealGamePath", which: "install" } }]
}

const pluginManagerLost: GameLinkNotice = {
  kind: PLUGIN_MANAGER_MISSING,
  level: "error",
  title: "The Ballest plugin manager isn't installed any more",
  body: "Play needs it to race a map in the game.",
  persistent: true,
  actions: [{ label: "Install steps", command: { _tag: "OpenExternal", url: PLUGIN_MANAGER_URL } }]
}

const pluginManagerBack: GameLinkNotice = {
  kind: PLUGIN_MANAGER_FOUND,
  level: "info",
  title: "Found the Ballest plugin manager",
  persistent: false,
  actions: [{ label: "Reveal", command: { _tag: "RevealGamePath", which: "pluginsFolder" } }]
}

/**
 * What to tell the notification centre about `current`, given what the last launch found (`previous`; null on the
 * first launch, when the checklist itself is in front of the user and nothing is notified). `resolve`: the persistent
 * kinds whose cause has gone away. The plugin manager is reported only while the game is found both times: without
 * the game it can't be looked for, and the game's own notice says so.
 */
export const gameLinkChanges = (
  previous: GameLinkResult | null,
  current: GameLinkResult
): { readonly notices: ReadonlyArray<GameLinkNotice>; readonly resolve: ReadonlyArray<string> } => {
  const resolve = [
    ...(current.game ? [GAME_NOT_FOUND] : []),
    ...(current.pluginManager ? [PLUGIN_MANAGER_MISSING] : [])
  ]
  if (previous === null) return { notices: [], resolve }
  const notices: Array<GameLinkNotice> = []
  if (previous.game !== current.game) notices.push(current.game ? gameBack : gameLost)
  else if (current.game && previous.pluginManager !== current.pluginManager) {
    notices.push(current.pluginManager ? pluginManagerBack : pluginManagerLost)
  }
  return { notices, resolve }
}
