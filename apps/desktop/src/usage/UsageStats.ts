import { USAGE_BATCH_LIMIT, UsageEvent, type UsageStatsState } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schedule, Schema, type Scope, Semaphore } from "effect"
import * as Crypto from "node:crypto"
import * as Os from "node:os"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { writeJson } from "../project/files"
import { DesktopSettings, type DesktopSettingsWriteError } from "../settings/DesktopSettings"
import { CollectClient } from "./CollectClient"
import { type ScrubContext, scrubErrorText } from "./scrub"

/** The most events kept unsent; past it the oldest go. */
export const QUEUE_LIMIT = 500

/** The most errors one session keeps, so a loop that throws can't fill the queue. */
export const ERRORS_PER_SESSION = 20

const HEARTBEAT = "1 minute"
const QUIT_FLUSH = "3 seconds"

/** When the running session started and was last seen alive (ms since the epoch), for a crash's `sessionEnd`. */
const Session = Schema.Struct({ startedAt: Schema.Finite, lastSeen: Schema.Finite })
type Session = typeof Session.Type

/**
 * `<userData>/usage-queue.json`: the events not yet sent and the running session. Each event is decoded on its own, so
 * one a newer version wrote is dropped without losing the rest.
 */
const QueueFile = Schema.Struct({
  formatVersion: Schema.Literal(1),
  session: Schema.NullOr(Session),
  events: Schema.Array(Schema.Unknown)
})

interface Queue {
  readonly session: Session | null
  readonly events: ReadonlyArray<UsageEvent>
}

const emptyQueue: Queue = { session: null, events: [] }
const decodeQueue = Schema.decodeEffect(Schema.fromJsonString(QueueFile))
const decodeEvent = Schema.decodeUnknownOption(UsageEvent)
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Anonymous usage statistics (docs/DESKTOP.md § Feedback and usage statistics): sessions and unhandled errors, queued
 * in a file and sent to the collect endpoint at launch and at quit. Only a build with an endpoint collects (installed
 * builds), and only while the user leaves it on.
 */
export class UsageStats extends Context.Service<UsageStats, {
  readonly state: Effect.Effect<UsageStatsState>
  /** Turns usage statistics on or off, or records the notice as shown. Off drops the install id and the queue. */
  readonly set: (patch: {
    readonly enabled?: boolean
    readonly noticeShown?: boolean
  }) => Effect.Effect<UsageStatsState, DesktopSettingsWriteError>
  /** Queues an unhandled error, scrubbed; nothing while off, or past `ERRORS_PER_SESSION`. */
  readonly recordError: (source: "main" | "renderer", message: string, stack: string) => Effect.Effect<void>
  /**
   * Starts a session: ends the last one if it never ended (a crash), queues `sessionStart` and sends the queue, then
   * keeps the session alive until the scope closes, which queues `sessionEnd` and sends again. Nothing while off.
   */
  readonly run: Effect.Effect<void, never, Scope.Scope>
}>()("ballest/desktop/usage/UsageStats") {
  static readonly make = Effect.fn("UsageStats.make")(function*(queuePath: string, scrub: ScrubContext) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const settings = yield* DesktopSettings
    const collect = yield* CollectClient
    const collecting = Option.isSome(collect.endpoint)
    const lock = yield* Semaphore.make(1)
    const flushLock = yield* Semaphore.make(1)
    const errors = yield* Ref.make(0)

    const state = settings.get.pipe(Effect.map(({ usage }): UsageStatsState => ({
      enabled: usage?.enabled ?? true,
      noticeShown: usage?.noticeShown ?? false,
      collecting
    })))
    /**
     * Whether this session records: on, with an install id. Turned off and on again mid-session there is none, so
     * nothing is recorded until the next launch makes a new one.
     */
    const active = settings.get.pipe(
      Effect.map(({ usage }) => collecting && usage?.enabled !== false && usage?.installId !== undefined)
    )

    const read = fs.readFileString(queuePath).pipe(
      Effect.flatMap(decodeQueue),
      Effect.map((file): Queue => ({
        session: file.session,
        events: file.events.flatMap((raw) => Option.toArray(decodeEvent(raw)))
      })),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(emptyQueue)
            : Effect.logWarning(`Couldn't read ${queuePath}`, error).pipe(Effect.as(emptyQueue)),
        SchemaError: (error) =>
          Effect.logWarning(`Ignoring an invalid ${queuePath}`, error.message).pipe(Effect.as(emptyQueue))
      })
    )
    const write = (queue: Queue) =>
      fs.makeDirectory(path.dirname(queuePath), { recursive: true }).pipe(
        Effect.andThen(
          writeJson(fs, queuePath, { formatVersion: 1, ...queue, events: queue.events.slice(-QUEUE_LIMIT) })
        ),
        Effect.catch((error) => Effect.logWarning(`Couldn't write ${queuePath}`, error))
      )
    /**
     * Changes the queue file, one change at a time, and only while active: checked under the lock that turning off
     * deletes the file under, so nothing written after that brings it back.
     */
    const change = (f: (queue: Queue) => Queue) =>
      lock.withPermits(1)(Effect.gen(function*() {
        if (yield* active) yield* write(f(yield* read))
      }))

    /** Sends the queue in batches, oldest first, until it is empty or a batch fails (it is kept for next time). */
    const flush = flushLock.withPermits(1)(Effect.gen(function*() {
      const installId = (yield* settings.get).usage?.installId
      if (installId === undefined) return
      let sent = true
      while (sent) {
        const events = (yield* read).events.slice(0, USAGE_BATCH_LIMIT)
        if (events.length === 0 || !(yield* active)) return
        sent = yield* collect.post("/api/events", { installId, events }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("Couldn't send usage statistics", error.message).pipe(Effect.as(false))
          )
        )
        // Only this drops events, and new ones only ever go on the end: the first ones are the ones sent.
        if (sent) yield* change((q) => ({ ...q, events: q.events.slice(events.length) }))
      }
    }))

    const set = (patch: { readonly enabled?: boolean; readonly noticeShown?: boolean }) =>
      Effect.gen(function*() {
        yield* settings.update((s) => {
          const { installId, ...rest } = { ...s.usage, ...patch }
          return { ...s, usage: patch.enabled === false || installId === undefined ? rest : { ...rest, installId } }
        })
        if (patch.enabled === false) {
          yield* lock.withPermits(1)(fs.remove(queuePath, { force: true }).pipe(Effect.ignore))
        }
        return yield* state
      })

    const recordError = (source: "main" | "renderer", message: string, stack: string) =>
      Effect.gen(function*() {
        if (!(yield* active) || (yield* Ref.getAndUpdate(errors, (n) => n + 1)) >= ERRORS_PER_SESSION) return
        const event: UsageEvent = {
          _tag: "error",
          at: iso(Date.now()),
          source,
          message: scrubErrorText(message, scrub),
          stack: scrubErrorText(stack, scrub)
        }
        yield* change((q) => ({ ...q, events: [...q.events, event] }))
      })

    const endOf = (session: Session): UsageEvent => ({
      _tag: "sessionEnd",
      at: iso(session.lastSeen),
      durationS: Math.max(0, Math.round((session.lastSeen - session.startedAt) / 1000))
    })

    const run = Effect.gen(function*() {
      const { collecting: sends, enabled } = yield* state
      if (!sends || !enabled) return
      const before = (yield* settings.get).usage?.installId
      const firstLaunch = before === undefined
      if (firstLaunch) {
        const created = yield* settings.update((s) => ({ ...s, usage: { ...s.usage, installId: Crypto.randomUUID() } }))
          .pipe(Effect.option)
        if (Option.isNone(created)) return
      }
      const startedAt = Date.now()
      yield* change((q) => ({
        session: { startedAt, lastSeen: startedAt },
        events: [
          ...q.events,
          ...(q.session === null ? [] : [endOf(q.session)]),
          { _tag: "sessionStart", at: iso(startedAt), firstLaunch }
        ]
      }))
      yield* Effect.forkScoped(flush)

      const touch = change((q) => q.session === null ? q : { ...q, session: { ...q.session, lastSeen: Date.now() } })
      yield* Effect.forkScoped(touch.pipe(Effect.repeat(Schedule.spaced(HEARTBEAT))))

      yield* Effect.addFinalizer(() =>
        Effect.gen(function*() {
          if (!(yield* active)) return
          yield* change((q) => ({
            session: null,
            events: [...q.events, endOf({ startedAt, lastSeen: Date.now() })]
          }))
          yield* flush.pipe(Effect.timeoutOrElse({ duration: QUIT_FLUSH, orElse: () => Effect.void }))
        })
      )
    })

    return UsageStats.of({ state, set, recordError, run })
  })

  static readonly layer = Layer.effect(
    UsageStats,
    Effect.gen(function*() {
      const { userData } = yield* DesktopEnvironment
      const path = yield* Path.Path
      const user = yield* Effect.try(() => Os.userInfo().username).pipe(Effect.orElseSucceed(() => ""))
      return yield* UsageStats.make(path.join(userData, "usage-queue.json"), { home: Os.homedir(), user })
    })
  )
}
