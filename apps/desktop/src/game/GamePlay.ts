import { type PlayLaunch, type PlayPayload, type PlayResult, PlaySessionEnded } from "@ballest/contracts"
import { Context, DateTime, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { ElectronShell } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { PLAY_SESSION_ENDED_CHANNEL } from "../ipc/channels"
import type { BackupError } from "../project/Backups"
import type { MapLinkError } from "../project/MapLinks"
import { type ProjectError, Projects } from "../project/Projects"
import { GameLink, type GameLinkError } from "./GameLink"
import type { GamePathError } from "./GamePaths"
import { GameProcess } from "./GameProcess"

/** How often a Play's game session is looked at: is the game up yet, is it still running. */
export const SESSION_POLL = "5 seconds"
/** How long a game Play started may take to show up; one that never does (Steam updating it, a closed prompt) is dropped. */
export const SESSION_START_TIMEOUT = "5 minutes"

/** The plugin manager races only maps never published: `levelPublishedFileId` -1 (docs/DESKTOP.md § Play). */
export const isNeverPublished = (publishedFileId: number): boolean => publishedFileId < 0

const encodeEnded = Schema.encodeEffect(PlaySessionEnded)

export type PlayError = ProjectError | MapLinkError | BackupError | GamePathError | GameLinkError

/**
 * Play (docs/DESKTOP.md § Play): Export to game, then the handoff to the `ballest-editor-link` plugin, then the game
 * if it isn't running. Then it follows the game session the race runs in, and when the game's process exits, says so
 * on `sessionEnds` and to the page (`PLAY_SESSION_ENDED_CHANNEL`): the moment sync detection (#141) checks the exports.
 */
export class GamePlay extends Context.Service<GamePlay, {
  readonly play: (payload: PlayPayload) => Effect.Effect<PlayResult, PlayError>
  /** Each end of a game session a Play started or joined, from when the stream is run. */
  readonly sessionEnds: Stream.Stream<PlaySessionEnded>
}>()("ballest/desktop/game/GamePlay") {
  static readonly make = Effect.gen(function*() {
    const projects = yield* Projects
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
      const ended: PlaySessionEnded = {
        fileName: session.fileName,
        endedAt: DateTime.formatIso(yield* DateTime.now)
      }
      yield* Effect.logInfo(`The game session racing ${ended.fileName} ended`)
      yield* PubSub.publish(ends, ended)
      yield* encodeEnded(ended).pipe(
        Effect.flatMap((encoded) => windows.sendAll(PLAY_SESSION_ENDED_CHANNEL, encoded)),
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

    const play = Effect.fn("GamePlay.play")(function*({ fileName, replacePublished }: PlayPayload) {
      const { publishedFileId } = yield* projects.read(fileName)
      if (!isNeverPublished(publishedFileId)) return { _tag: "PublishedMap", fileName, publishedFileId } as const

      const exported = yield* projects.exportMap({ fileName, replacePublished })
      if (exported._tag === "Published") return exported

      const { plugin, sent } = yield* link.requestRace(fileName)
      const launch: PlayLaunch = (yield* game.isRunning)
        ? "running"
        : (yield* shell.launchGame)
        ? "launched"
        : "failed"
      if (launch !== "failed") yield* followSession(fileName)
      return { _tag: "Played", file: exported.file, link: exported.link, plugin, sent, launch } as const
    })

    return GamePlay.of({ play, sessionEnds: Stream.fromPubSub(ends) })
  })

  static readonly layer = Layer.effect(GamePlay, GamePlay.make)
}
