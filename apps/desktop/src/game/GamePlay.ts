import {
  isNeverPublished,
  type OpenInGamePayload,
  type OpenInGameResult,
  type PlayLaunch,
  type PlayPayload,
  type PlayResult,
  PlaySessionEnded,
  PushChannels
} from "@ballest/contracts"
import { Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { ElectronShell } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import type { BackupError } from "../project/Backups"
import { type ExportUnverifiedError, MapExports, type MapRefusedError } from "../project/MapExports"
import { MapFiles } from "../project/MapFiles"
import type { MapLinkError } from "../project/MapLinks"
import { type ProjectError, Projects } from "../project/Projects"
import { GameLink, type GameLinkError, opensMaps } from "./GameLink"
import type { GamePathError } from "./GamePaths"
import { GameProcess } from "./GameProcess"
import { reportGameWriteProgress } from "./gameWriteProgress"

/** How often a Play's game session is looked at: is the game up yet, is it still running. */
export const SESSION_POLL = "5 seconds"
/** How long a game Play started may take to show up; one that never does (Steam updating it, a closed prompt) is dropped. */
const SESSION_START_TIMEOUT = "5 minutes"

const encodeEnded = Schema.encodeEffect(PlaySessionEnded)

type PlayError =
  | MapRefusedError
  | ExportUnverifiedError
  | ProjectError
  | MapLinkError
  | BackupError
  | GamePathError
  | GameLinkError

/**
 * Play (docs/DESKTOP.md § Play): Export to game, then the handoff to the `ballest-editor-link` plugin, then the game
 * if it isn't running. Then it follows the game session the race runs in, and when the game's process exits, says so
 * on `sessionEnds` and to the page (`PushChannels.onPlaySessionEnded`): the moment sync detection (#141) checks the
 * exports.
 */
export class GamePlay extends Context.Service<GamePlay, {
  readonly play: (payload: PlayPayload) => Effect.Effect<PlayResult, PlayError>
  /** Export to game, then the handoff that opens the map in the in-game editor; nothing without a plugin that can. */
  readonly openInGame: (payload: OpenInGamePayload) => Effect.Effect<OpenInGameResult, PlayError>
  /** Each end of a game session a Play started or joined, from when the stream is run. */
  readonly sessionEnds: Stream.Stream<PlaySessionEnded>
}>()("ballest/desktop/game/GamePlay") {
  static readonly make = Effect.gen(function*() {
    const projects = yield* Projects
    const files = yield* MapFiles
    const exports = yield* MapExports
    const link = yield* GameLink
    const game = yield* GameProcess
    const shell = yield* ElectronShell
    const windows = yield* ElectronWindow
    // The session outlives the IPC call that started it; it stops with the app.
    const scope = yield* Effect.scope
    const ends = yield* PubSub.unbounded<PlaySessionEnded>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(ends))

    /** The map the last Play raced, and whether a session is being followed. One follower at a time. */
    const session = { fileName: "", following: false }

    const waitUntil = (running: boolean) =>
      Effect.gen(function*() {
        while ((yield* game.isRunning) !== running) yield* Effect.sleep(SESSION_POLL)
      })

    const follow = Effect.gen(function*() {
      const started = yield* waitUntil(true).pipe(Effect.timeoutOption(SESSION_START_TIMEOUT))
      if (Option.isNone(started)) return
      yield* waitUntil(false)
      const ended: PlaySessionEnded = { fileName: session.fileName }
      yield* Effect.logInfo(`The game session racing ${ended.fileName} ended`)
      yield* PubSub.publish(ends, ended)
      yield* encodeEnded(ended).pipe(
        Effect.flatMap((encoded) => windows.sendAll(PushChannels.onPlaySessionEnded, encoded)),
        Effect.orDie
      )
    }).pipe(
      Effect.ensuring(Effect.sync(() => void (session.following = false))),
      Effect.withSpan("GamePlay.follow")
    )

    const followSession = (fileName: string) =>
      Effect.suspend(() => {
        session.fileName = fileName
        if (session.following) return Effect.void
        session.following = true
        return Effect.asVoid(Effect.forkIn(follow, scope))
      })

    /** The game up, or asked to start through Steam, and its session followed: the last step of a handoff. */
    const launchFor = Effect.fnUntraced(function*(fileName: string) {
      const launch: PlayLaunch = (yield* game.isRunning)
        ? "running"
        : (yield* shell.launchGame)
        ? "launched"
        : "failed"
      if (launch !== "failed") yield* followSession(fileName)
      return launch
    })

    const play = Effect.fn("GamePlay.play")(function*(payload: PlayPayload) {
      const { fileName } = payload
      // not `read`, which stops at its size cap: a file too long for the game is Export's to refuse, with the reason
      const { publishedFileId } = yield* files.info(yield* projects.inUse, fileName)
      if (!isNeverPublished(publishedFileId)) return { _tag: "PublishedMap" } as const

      const exported = yield* exports.exportMap(payload)
      if (exported._tag !== "Exported") return exported

      yield* reportGameWriteProgress(windows, { fileName, stage: "launch" })
      const { plugin, sent } = yield* link.requestRace(fileName)
      return { _tag: "Played", plugin, sent, launch: yield* launchFor(fileName) } as const
    })

    const openInGame = Effect.fn("GamePlay.openInGame")(function*(payload: OpenInGamePayload) {
      const { fileName } = payload
      const plugin = yield* link.pluginStatus
      if (!opensMaps(plugin)) return { _tag: "NeedsPlugin", plugin } as const

      const exported = yield* exports.exportMap(payload)
      if (exported._tag !== "Exported") return exported

      yield* reportGameWriteProgress(windows, { fileName, stage: "launch" })
      const nonce = yield* link.requestEdit(fileName, payload.force)
      const launch = yield* launchFor(fileName)
      // A game that is only starting answers once it is up, long after this call.
      const { outcome, inGame } = launch === "running"
        ? yield* link.editOutcome(nonce)
        : { outcome: "pending" as const, inGame: null }
      if (outcome === "opened") yield* exports.markExportLoaded(fileName)
      return { _tag: "Opening", plugin, launch, outcome, inGame } as const
    })

    return GamePlay.of({ play, openInGame, sessionEnds: Stream.fromPubSub(ends) })
  })

  static readonly layer = Layer.effect(GamePlay, GamePlay.make)
}
