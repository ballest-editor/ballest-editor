/**
 * The Game link (docs/DESKTOP.md § Game link): the game's folders, the creator name, the plugin manager and the
 * editor's plugin, looked up at startup and on request; the notifications for what changed; Open game (Steam).
 */
import { Duration, Effect, Equal, Option } from "effect"
import { creatorOf } from "../../domain/creator"
import {
  anythingMissing,
  exportReady,
  gameLinkChanges,
  type GameLinkResult,
  gameLinkResultOf,
  gameLinkRows,
  PLUGIN_MISSING,
  sameGameLinkResult
} from "../../domain/gameLink"
import { type GamePathKind, type GamePaths, Platform } from "../../services/Platform"
import { useEditor } from "../store"
import { run, runUntilCleanup } from "./run"
import { notifyNotice } from "./shared"

/**
 * Looks up the creator name the game would use (the Steam persona name). Settings › General shows it until the user
 * types their own. Nothing to report when it fails: the user can still type a name.
 */
export const findCreatorEffect = Effect.gen(function*() {
  useEditor.getState().setFoundCreator(yield* (yield* Platform).findCreator)
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't look up the creator name", error)))

/** Looks the creator name up again, for Settings › General: the user may have logged in to Steam since. */
export const findCreator = () => run(findCreatorEffect)

/** Starts the game through Steam, unless it is already running. */
export const launchGameEffect = Effect.gen(function*() {
  const platform = yield* Platform
  if (yield* platform.isGameRunning) {
    useEditor.getState().notify("info", "Ballest of Them All is already running", { kind: "gameLaunch" })
    return
  }
  yield* platform.launchGame
  useEditor.getState().notify("info", "Starting Ballest of Them All through Steam", { kind: "gameLaunch" })
})

export const launchGame = () => run(launchGameEffect)

/** Looks the editor-link plugin up again: it depends on the game folders. */
const refreshPluginStatus = Effect.gen(function*() {
  useEditor.getState().setPluginStatus(yield* (yield* Platform).pluginStatus)
})

/** Keeps `current` for the next launch to compare with, unless it is what was kept already; a failure is only logged. */
const rememberGameLink = (current: GameLinkResult) =>
  Effect.gen(function*() {
    if (sameGameLinkResult(useEditor.getState().lastGameLink, current)) return
    useEditor.getState().setLastGameLink(current)
    yield* (yield* Platform).rememberGameLink(current)
  }).pipe(Effect.catch((error) => Effect.logWarning("Couldn't keep the Game link's result", error)))

/** Tells the notification centre what `previous` → `current` changed: new notices, and pinned ones resolved. */
const reportGameLink = (previous: GameLinkResult | null, current: GameLinkResult) => {
  const { notices, resolve } = gameLinkChanges(previous, current)
  const { resolveNotifications } = useEditor.getState()
  for (const kind of resolve) resolveNotifications(kind)
  for (const notice of notices) notifyNotice(notice)
}

/**
 * After the game's folders or the plugin were looked up again in this session: the pinned notifications whose cause
 * is gone resolve themselves, and the result is kept. Nothing new is notified; the checklist already shows it.
 */
const noteGameLink = Effect.gen(function*() {
  const { gamePaths, pluginStatus } = useEditor.getState()
  if (gamePaths === null || pluginStatus === null) return
  const current = gameLinkResultOf(gamePaths, pluginStatus)
  reportGameLink(null, current)
  yield* rememberGameLink(current)
})

/**
 * The startup check behind the Game link (desktop): looks up the game's folders and the plugin, and notifies only
 * what changed since the last launch (none on the first). Persistent notices (game not found, plugin manager missing)
 * stay pinned until their cause goes away. The Game link dialog opens by itself whenever a folder Export needs is
 * missing, and on the first launch if anything else is; with everything found nothing shows, and the plugin manager,
 * which only Play needs, never opens it.
 */
export const checkGameLinkEffect = Effect.gen(function*() {
  const platform = yield* Platform
  const memory = yield* platform.gameLinkMemory
  useEditor.getState().muteNotifications(memory.muted)
  useEditor.getState().setLastGameLink(memory.last)
  const paths = yield* platform.gamePaths
  useEditor.getState().setGamePaths(paths)
  const plugin = yield* platform.pluginStatus
  useEditor.getState().setPluginStatus(plugin)
  const current = gameLinkResultOf(paths, plugin)
  reportGameLink(memory.last, current)
  yield* rememberGameLink(current)
  const { foundCreator, openDialog, settings } = useEditor.getState()
  const rows = gameLinkRows(paths, plugin, creatorOf(settings.general.creatorName, foundCreator))
  if (!exportReady(paths) || (memory.last === null && anythingMissing(rows))) openDialog({ id: "gameLink" })
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't check the Game link", error)))

/** Runs a lookup that may return the game's folders (none: the user cancelled) and shows them, and the plugin. */
const gamePathsShown = <E, R>(
  lookup: (platform: Platform["Service"]) => Effect.Effect<Option.Option<GamePaths>, E, R>
) =>
  Effect.gen(function*() {
    const paths = yield* lookup(yield* Platform)
    if (Option.isNone(paths)) return
    useEditor.getState().setGamePaths(paths.value)
    useEditor.getState().setGamePathProblem(null)
    yield* refreshPluginStatus
    yield* noteGameLink
  })

/** Looks the game's folders up again, and the plugin with them. */
export const loadGamePaths = () => run(gamePathsShown((platform) => Effect.asSome(platform.gamePaths)))

/** A folder dialog; the chosen folder replaces the one found for `which`. */
export const chooseGamePath = (which: GamePathKind) => run(gamePathsShown((platform) => platform.chooseGamePath(which)))

/**
 * Choose folder… in the Game link: `chooseGamePath`, but a folder main refuses (not the game's) is shown on the
 * checklist's row instead of toasted, and nothing is saved.
 */
export const chooseGameLinkFolderEffect = (which: GamePathKind) =>
  gamePathsShown((platform) =>
    platform.chooseGamePath(which).pipe(
      Effect.catch((error) =>
        Effect.sync(() => useEditor.getState().setGamePathProblem({ which, message: error.message })).pipe(
          Effect.as(Option.none<GamePaths>())
        )
      )
    )
  )

export const chooseGameLinkFolder = (which: GamePathKind) => run(chooseGameLinkFolderEffect(which))

/** Check again on the Game link: the folders, the plugin and the creator, looked up afresh. */
export const refreshGameLink = () => Promise.all([loadGamePaths(), findCreator()])

/** How often Settings › Game looks again while it is open. */
export const GAME_LINK_WATCH_INTERVAL = Duration.seconds(5)

/**
 * One look of the watch: what Check again looks up, through the same calls. It puts in the store only what changed, so
 * a page where nothing did doesn't draw again, and it leaves a refused folder's reason on its row.
 */
const lookAtGameLink = Effect.gen(function*() {
  const platform = yield* Platform
  const paths = yield* platform.gamePaths
  const plugin = yield* platform.pluginStatus
  const creator = yield* platform.findCreator
  const s = useEditor.getState()
  if (!Equal.equals(s.gamePaths, paths)) s.setGamePaths(paths)
  if (!Equal.equals(s.pluginStatus, plugin)) s.setPluginStatus(plugin)
  if (!Equal.equals(s.foundCreator, creator)) s.setFoundCreator(creator)
  yield* noteGameLink
})

/** Looks again every `GAME_LINK_WATCH_INTERVAL`, each look once the last is done; one that fails only waits for the next. */
export const watchGameLinkEffect = Effect.sleep(GAME_LINK_WATCH_INTERVAL).pipe(
  Effect.andThen(lookAtGameLink),
  Effect.catch((error) => Effect.logWarning("Couldn't look at the Game link", error)),
  Effect.forever
)

/** Keeps the Game link's rows live until the returned function is called. */
export const watchGameLink = () => runUntilCleanup(watchGameLinkEffect, "Stopped watching the Game link")

/** Goes back to the folders found through Steam, one after the other (each reset rewrites the desktop settings). */
export const resetGamePaths = (kinds: ReadonlyArray<GamePathKind>) =>
  run(
    gamePathsShown((platform) =>
      Effect.forEach(kinds, platform.resetGamePath).pipe(Effect.andThen(Effect.asSome(platform.gamePaths)))
    )
  )

/**
 * Install / Update on the Game link: copies the app's editor-link plugin into the game's plugins folder. Only ever
 * run when the user asks. The plugin manager loads a plugin copied in by hand when the game starts, hence the restart.
 */
export const installPluginEffect = Effect.gen(function*() {
  const { status } = useEditor.getState().pluginStatus ?? {}
  const { plugin, restartGame } = yield* (yield* Platform).installPlugin
  useEditor.getState().setPluginStatus(plugin)
  yield* noteGameLink
  useEditor.getState().resolveNotifications(PLUGIN_MISSING)
  const done = status === "outdated"
    ? `Updated the editor's plugin to ${plugin.bundledVersion}`
    : "Installed the editor's plugin"
  useEditor.getState().notify("info", restartGame ? `${done}. Restart the game to use Play.` : done, {
    kind: "pluginInstalled"
  })
})

export const installPlugin = () => run(installPluginEffect)

/** Opens a web page in the browser (the desktop app's default browser). */
export const openExternalLink = (url: string) =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.openExternal(url)))

export const revealGamePath = (which: GamePathKind) =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.revealGamePath(which)))
