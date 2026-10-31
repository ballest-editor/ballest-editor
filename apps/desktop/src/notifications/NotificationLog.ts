import { NOTIFICATION_LIMIT, NotificationRecord, type NotificationRecords } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Semaphore } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { writeJson } from "../project/files"

/**
 * `<userData>/notifications.json`. Each notification is decoded on its own, so one a newer version wrote (an action
 * this one doesn't know) is dropped without losing the rest.
 */
const NotificationFile = Schema.Struct({
  formatVersion: Schema.Literal(1),
  notifications: Schema.Array(Schema.Unknown)
})

const decodeRecord = Schema.decodeUnknownOption(NotificationRecord)

export class NotificationLogError extends Schema.TaggedError<NotificationLogError>()("NotificationLogError", {
  path: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `Couldn't write the notifications to ${this.path}.`
  }
}

/** The bell's notifications, kept across restarts (docs/PROJECTS.md § Shell). The renderer owns the list; this stores it. */
export class NotificationLog extends Context.Service<NotificationLog, {
  /** The kept notifications, newest first; empty when the file is missing or doesn't decode (it is logged). */
  readonly load: Effect.Effect<NotificationRecords>
  /** Replaces the kept notifications, atomically; one write at a time. */
  readonly save: (records: NotificationRecords) => Effect.Effect<void, NotificationLogError>
}>()("ballest/desktop/notifications/NotificationLog") {
  static readonly make = Effect.fn("NotificationLog.make")(function*(file: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const lock = yield* Semaphore.make(1)
    const decode = Schema.decodeEffect(Schema.fromJsonString(NotificationFile))

    const load = fs.readFileString(file).pipe(
      Effect.flatMap(decode),
      Effect.map((log) => log.notifications.flatMap((raw) => Option.toArray(decodeRecord(raw)))),
      Effect.map((records) => records.slice(0, NOTIFICATION_LIMIT)),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed([])
            : Effect.logWarning(`Couldn't read ${file}`, error).pipe(Effect.as([])),
        SchemaError: (error) => Effect.logWarning(`Ignoring an invalid ${file}`, error.message).pipe(Effect.as([]))
      })
    )

    const save = (records: NotificationRecords) =>
      fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
        Effect.andThen(writeJson(fs, file, { formatVersion: 1, notifications: records })),
        Effect.mapError((cause) => new NotificationLogError({ path: file, cause })),
        lock.withPermits(1)
      )

    return NotificationLog.of({ load, save })
  })

  static readonly layer = Layer.effect(
    NotificationLog,
    Effect.gen(function*() {
      return yield* NotificationLog.make((yield* DesktopEnvironment).notificationsPath)
    })
  )
}
