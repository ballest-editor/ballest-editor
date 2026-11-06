/**
 * The Game link checklist (docs/DESKTOP.md § Game link; on desktop, the Settings › Game page, and the short dialog when
 * something is missing): the game's install, its maps folder, the creator name, the plugin manager and the editor's
 * plugin, each found or not, with the fix for a missing one and, for a folder, Choose folder… and reset. And what changed
 * since the last launch, which is what the notification centre is told about.
 */
import { Option } from "effect"
import { type Creator, creatorProblem, foundCreatorLabel } from "./creator"
import { segmentsOf } from "./paths"

/** The three game folders (`GamePathKind` in @ballest/contracts). */
export type GameFolderKind = "install" | "mapsFolder" | "pluginsFolder"

/** How a game folder was found (`GamePath` in @ballest/contracts). */
export interface GameFolder {
  readonly status: "found" | "overridden" | "missing"
  readonly path: string | null
}

export type GameFolders = Readonly<Record<GameFolderKind, GameFolder>>

export const GAME_FOLDER_KINDS: ReadonlyArray<GameFolderKind> = ["install", "mapsFolder", "pluginsFolder"]

/** The folders chosen instead of the ones found: what Settings › Game's "Reset game to defaults" puts back. */
export const overriddenFolders = (paths: GameFolders | null): ReadonlyArray<GameFolderKind> =>
  paths === null ? [] : GAME_FOLDER_KINDS.filter((which) => paths[which].status === "overridden")

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

/** The Install section of the plugin manager's README. */
export const PLUGIN_MANAGER_URL = "https://github.com/AnythingGoes-ballest/ballest-plugin-manager#install"

/** What a checklist row's button does. ChooseFolder on a row that is fine picks another folder. */
export type GameLinkFix =
  | { readonly _tag: "ChooseFolder"; readonly which: GameFolderKind }
  | { readonly _tag: "OpenPluginDocs" }
  | { readonly _tag: "InstallPlugin"; readonly label: string }
  | { readonly _tag: "EditCreator" }

/**
 * `ok`: found. `missing`: not found, or not usable; the row carries the fix. `optional`: not found, but only Play
 * needs it (the plugin manager), so nothing is wrong; the row carries the fix all the same. `waiting`: still being
 * looked up, or waiting on a row above it (no plugin manager without the game).
 */
export type GameLinkRowState = "ok" | "missing" | "optional" | "waiting"

export interface GameLinkRow {
  readonly id: "install" | "mapsFolder" | "creator" | "pluginManager" | "plugin"
  readonly label: string
  readonly state: GameLinkRowState
  /** What was found, or what is wrong. */
  readonly title: string
  /** The one line Settings › Game shows ("Found", "Not found"): the title, unless a shorter word says the same. */
  readonly status: string
  /** A second line: how it was found, or how to fix it. */
  readonly note: string | null
  /** The folder it is in, when it has one. */
  readonly path: string | null
  /** The game folder Reveal shows; none when there is nothing to show. */
  readonly reveal: GameFolderKind | null
  /** The folder chosen instead of the one found, which reset looks up again. */
  readonly reset: GameFolderKind | null
  /** Its buttons, the main one first. */
  readonly fixes: ReadonlyArray<GameLinkFix>
}

const LOOKING = "Looking…"

const row = (
  id: GameLinkRow["id"],
  label: string,
  fields: Pick<GameLinkRow, "state" | "title"> & Partial<Omit<GameLinkRow, "id" | "label">>
): GameLinkRow => ({
  id,
  label,
  status: fields.title,
  note: null,
  path: null,
  reveal: null,
  reset: null,
  fixes: [],
  ...fields
})

const choose = (which: GameFolderKind): GameLinkFix => ({ _tag: "ChooseFolder", which })

/** A folder that is there: its path, Reveal, Choose folder…, and reset when it was chosen here. */
const folderThere = (paths: GameFolders, which: GameFolderKind, found: string) => {
  const folder = paths[which]
  const overridden = folder.status === "overridden"
  return {
    status: overridden ? "Chosen here" : "Found",
    note: overridden ? "Chosen here instead of the one Steam knows about." : found,
    path: folder.path,
    reveal: which,
    reset: overridden ? which : null,
    fixes: [choose(which)]
  }
}

const installRow = (paths: GameFolders | null): GameLinkRow => {
  if (paths === null) return row("install", "Game", { state: "waiting", title: LOOKING })
  const { install } = paths
  if (install.status !== "missing") {
    return row("install", "Game", {
      state: "ok",
      title: "Ballest of Them All",
      ...folderThere(paths, "install", "Found through Steam.")
    })
  }
  return row("install", "Game", {
    state: "missing",
    title: "Couldn't find Ballest of Them All",
    status: "Not found",
    note:
      "Steam doesn't list it in any of its libraries. Choose the folder that holds Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe.",
    fixes: [choose("install")]
  })
}

const mapsRow = (paths: GameFolders | null): GameLinkRow => {
  const label = "Maps folder"
  if (paths === null) return row("mapsFolder", label, { state: "waiting", title: LOOKING })
  const { install, mapsFolder } = paths
  const fields = ((): Parameters<typeof row>[2] => {
    if (mapsFolder.status !== "missing") {
      const there = folderThere(paths, "mapsFolder", "Found next to the game.")
      return { state: "ok", title: "UserSavedMaps", ...there, note: `${there.note} Export to game writes here.` }
    }
    if (install.status === "missing") return { state: "waiting", title: "Looked for once the game is found" }
    return mapsFolder.path === null
      ? {
        state: "missing",
        title: "Couldn't work out where the game keeps its maps",
        status: "Not found",
        note: "Choose its UserSavedMaps folder.",
        fixes: [choose("mapsFolder")]
      }
      : {
        state: "missing",
        title: "Run the game once to create its maps folder",
        note: "Or choose the folder, if it keeps its maps somewhere else.",
        path: mapsFolder.path,
        fixes: [choose("mapsFolder")]
      }
  })()
  return row("mapsFolder", label, fields)
}

const creatorRow = (creator: Creator): GameLinkRow => {
  const label = "Creator"
  const edit: GameLinkFix = { _tag: "EditCreator" }
  if (creator.valid) {
    const from = creator.source === "steam" || creator.source === "mapsFolder"
      ? `${foundCreatorLabel(creator.source)}.`
      : "Typed in Settings › General."
    return row("creator", label, {
      state: "ok",
      title: creator.name,
      note: `${from} Written into every exported map and its file name.`,
      fixes: [edit]
    })
  }
  return row("creator", label, {
    state: "missing",
    title: creator.name === "" ? "No creator name" : `Can't use "${creator.name}"`,
    note: Option.getOrElse(
      creatorProblem(creator),
      () => "Neither Steam nor the maps folder names one. The first Save asks for it; or set it in Settings › General."
    ),
    fixes: [edit]
  })
}

/**
 * The plugin manager, and the plugins folder it is found by. The folder can be chosen, for a plugin manager whose
 * plugins aren't next to the game's exe.
 */
const pluginManagerRow = (paths: GameFolders | null, plugin: PluginLookup | null): GameLinkRow => {
  const label = "Plugin manager"
  if (paths === null || plugin === null) return row("pluginManager", label, { state: "waiting", title: LOOKING })
  const { pluginsFolder } = paths
  switch (plugin.status) {
    case "noGame":
      return row("pluginManager", label, {
        state: "waiting",
        title: "Looked for once the game is found",
        reset: pluginsFolder.status === "overridden" ? "pluginsFolder" : null
      })
    case "noPluginManager": {
      const docs: GameLinkFix = { _tag: "OpenPluginDocs" }
      const why = "Play races the open map through it; Export doesn't need it."
      return row("pluginManager", label, {
        state: "optional",
        title: "Not installed (optional, for Play)",
        ...(pluginsFolder.status === "missing"
          ? {
            note: `${why} Installed somewhere else? Choose its plugins folder.`,
            fixes: [docs, choose("pluginsFolder")]
          }
          : pluginsFolder.status === "overridden"
          ? {
            note: `${why} Not found with the plugins folder chosen here.`,
            path: pluginsFolder.path,
            reset: "pluginsFolder",
            fixes: [docs]
          }
          : { note: why, fixes: [docs] })
      })
    }
    default:
      return row("pluginManager", label, {
        state: "ok",
        title: "Ballest plugin manager",
        // Found means its plugins folder is there too.
        ...folderThere(paths, "pluginsFolder", "Installed next to the game's exe.")
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
          fixes: [{ _tag: "InstallPlugin", label: `Install ${plugin.bundledVersion}` }]
        }
      case "outdated":
        return {
          state: "missing",
          title: `Version ${plugin.installedVersion} is installed`,
          note: `This app comes with ${plugin.bundledVersion}.`,
          path: plugin.folder,
          fixes: [{ _tag: "InstallPlugin", label: "Update" }]
        }
      case "current":
        return {
          state: "ok",
          title: `ballest-editor-link ${plugin.installedVersion}`,
          status: `Version ${plugin.installedVersion}`,
          note: "Play races the open map in the game through it.",
          path: plugin.folder
        }
    }
  })()
  return row("plugin", label, fields)
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

/** The most a path shows: the two folders it starts from, and the one it ends in with `…` for those between. */
const MAX_CRUMBS = 4

/**
 * A folder's path as a row shows it. A Steam library's path starts at Steam, wherever the library is and whatever it is
 * called, and leaves out `steamapps`, which every path in it has: "Steam › compatdata › … › UserSavedMaps".
 */
export const pathCrumbs = (path: string): ReadonlyArray<string> => {
  const segments = segmentsOf(path)
  const library = segments.findLastIndex((segment) => segment.toLowerCase() === "steamapps")
  const crumbs = library < 0 ? segments : ["Steam", ...segments.slice(library + 1)]
  if (crumbs.length === 0) return [path]
  return crumbs.length <= MAX_CRUMBS ? crumbs : [...crumbs.slice(0, 2), "…", ...crumbs.slice(-1)]
}

/** Whether anything is missing that Export, Open game or Play need; the optional plugin manager doesn't count. */
export const anythingMissing = (rows: ReadonlyArray<GameLinkRow>): boolean => rows.some((r) => r.state === "missing")

/** Whether the folders Export needs, the game's install and its maps folder, are both there. */
export const exportReady = (paths: GameFolders): boolean =>
  paths.install.status !== "missing" && paths.mapsFolder.status !== "missing"

// --- notifications: only when a result changes between launches ---------------------------

/** The game's install is gone (persistent: pinned until it is found again). */
export const GAME_NOT_FOUND = "gameNotFound"
export const GAME_FOUND = "gameFound"
/** The plugin manager is gone (persistent). */
export const PLUGIN_MANAGER_MISSING = "pluginManagerMissing"
export const PLUGIN_MANAGER_FOUND = "pluginManagerFound"
/**
 * Play exported a map but the editor's plugin isn't installed to race it (persistent: Install, or a Play that reaches
 * the plugin, resolves it).
 */
export const PLUGIN_MISSING = "pluginMissing"

/** The notification kinds whose notifications offer "Don't show again". */
export const MUTABLE_KINDS: ReadonlySet<string> = new Set([
  GAME_NOT_FOUND,
  GAME_FOUND,
  PLUGIN_MANAGER_MISSING,
  PLUGIN_MANAGER_FOUND,
  PLUGIN_MISSING
])

/** A notification's button (`NotificationCommand` in @ballest/contracts). */
export type GameLinkCommand =
  | { readonly _tag: "ChooseGamePath"; readonly which: "install" }
  | { readonly _tag: "RevealGamePath"; readonly which: GameFolderKind }
  | { readonly _tag: "OpenExternal"; readonly url: string }
  | { readonly _tag: "InstallPlugin" }

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
  body: "It was there last time. Export to game, Open game and Play need it: choose its folder if it moved.",
  persistent: true,
  actions: [{ label: "Choose folder…", command: { _tag: "ChooseGamePath", which: "install" } }]
}

const gameBack: GameLinkNotice = {
  kind: GAME_FOUND,
  level: "info",
  title: "Found Ballest of Them All",
  persistent: false,
  actions: [{ label: "Reveal in folder", command: { _tag: "RevealGamePath", which: "install" } }]
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
  actions: [{ label: "Reveal in folder", command: { _tag: "RevealGamePath", which: "pluginsFolder" } }]
}

/**
 * What to tell the notification centre about `current`, given what the last launch found (`previous`; null on the
 * first launch, when nothing is notified: the Game link dialog says what is missing). `resolve`: the persistent
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

/**
 * What Play says when it exported a map (`label`; `started`: and started the game) but couldn't hand it to the editor's
 * plugin. A missing game or plugin manager is the Game link's own pinned notice, under its kind, so there is one per
 * cause however it was found and the Game link resolves it; only a missing plugin is Play's own.
 */
export const playWithoutPluginNotice = (
  label: string,
  started: boolean,
  status: PluginLookup["status"]
): GameLinkNotice => {
  const exported = `Exported ${label}${started ? " and started the game" : ""}.`
  switch (status) {
    case "noGame":
      return {
        ...gameLost,
        title: `${exported} Play couldn't find Ballest of Them All to race it`,
        body: "Choose the game's folder, so Play can find the plugin manager in it."
      }
    case "noPluginManager":
      return {
        ...pluginManagerLost,
        title: `${exported} Play needs the Ballest plugin manager to race it`,
        body: "It runs the editor's plugin inside the game. Its README has the install steps."
      }
    default:
      return {
        kind: PLUGIN_MISSING,
        level: "info",
        title: `${exported} Install the editor's plugin and Play races it for you`,
        body: "Until then, open it from the in-game editor. The game loads the plugin the next time it starts.",
        persistent: true,
        actions: [{ label: "Install plugin", command: { _tag: "InstallPlugin" } }]
      }
  }
}

/** The pinned notices a Play that reached the plugin shows are out of date: the game, its plugin manager and the plugin are all there. */
export const RESOLVED_BY_PLAY: ReadonlyArray<string> = [GAME_NOT_FOUND, PLUGIN_MANAGER_MISSING, PLUGIN_MISSING]
