import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Schema, Semaphore } from "effect"
import { Buffer } from "node:buffer"
import { DesktopSettings } from "../settings/DesktopSettings"
import { isMapFileName, writeAtomic } from "./files"

/** How long backups are kept unless `desktop-settings.json` says otherwise (`backups.keep`, `backups.maxAgeDays`). */
export const BACKUP_RETENTION = { keep: 20, maxAgeDays: 30 } as const

const DAY_MILLIS = 24 * 60 * 60 * 1000

/** A backup in its folder: `<time> <file name>`, the time being ISO 8601 UTC with `-` for `:` and `.`. */
export interface Backup {
  /** Its name in the folder. */
  readonly id: string
  /** The file it is a version of. */
  readonly fileName: string
  /** When it was backed up, as ISO 8601 UTC. */
  readonly at: string
  readonly millis: number
}

const stampOf = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis)).replace(/[:.]/g, "-")

const BACKUP_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z (.+)$/

/** Reads a backup's name back; none for anything this module didn't write (or a name that could leave the folder). */
export const parseBackupId = (id: string): Option.Option<Backup> => {
  const match = BACKUP_NAME.exec(id)
  if (match === null) return Option.none()
  const [, date, h, m, s, ms, fileName = ""] = match
  const at = `${date}T${h}:${m}:${s}.${ms}Z`
  const millis = Date.parse(at)
  return Number.isNaN(millis) || !isMapFileName(fileName) ? Option.none() : Option.some({ id, fileName, at, millis })
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && Buffer.compare(a, b) === 0

export class BackupError extends Schema.TaggedError<BackupError>()("BackupError", {
  path: Schema.String,
  reason: Schema.Literals(["backup", "write"]),
  cause: Schema.Defect()
}) {
  override get message(): string {
    return this.reason === "backup"
      ? `Couldn't back up ${this.path}, so it wasn't written over.`
      : `Couldn't write ${this.path}.`
  }
}

/**
 * The one way a map file is written over (docs/PROJECTS.md § The files): the old bytes go to a backups folder first,
 * then the new ones are written atomically, then the folder is pruned. Save, Rename, Import replacing a map and Export
 * to game (and so Play) go through it, and so does anything later that replaces a map (Re-import, the Export confirm's
 * Back up and overwrite). A backups folder is flat; every file name has its versions in it. Operations run one at a
 * time.
 */
export class Backups extends Context.Service<Backups, {
  /**
   * Writes `data` over `file`, keeping the old file in `dir` first. Nothing is written when the bytes are the same,
   * and nothing is backed up when `file` doesn't exist or the newest backup already holds its bytes. A failed backup
   * leaves `file` as it was. Answers whether `file` changed.
   */
  readonly overwrite: (dir: string, file: string, data: string | Uint8Array) => Effect.Effect<boolean, BackupError>
  /** Moves `file` into `dir` (a Rename's old file); it is removed instead when the newest backup holds its bytes. */
  readonly retire: (dir: string, file: string) => Effect.Effect<void, BackupError>
  /** The backups in `dir`, newest first; none when it doesn't exist. Other files there are ignored. */
  readonly list: (dir: string) => Effect.Effect<ReadonlyArray<Backup>>
}>()("ballest/desktop/project/Backups") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const settings = yield* DesktopSettings
    const lock = yield* Semaphore.make(1)

    const list = (dir: string) =>
      fs.readDirectory(dir).pipe(
        Effect.map((names) =>
          names.flatMap((name) => Option.toArray(parseBackupId(name))).sort((a, b) =>
            b.millis - a.millis || b.id.localeCompare(a.id)
          )
        ),
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed([])
            : Effect.logWarning(`Couldn't list the backups in ${dir}`, error).pipe(Effect.as([])))
      )

    /** Keeps `keep` versions per file and none older than `maxAgeDays`. A backup that won't go is only logged. */
    const prune = Effect.fnUntraced(function*(dir: string) {
      const { keep = BACKUP_RETENTION.keep, maxAgeDays = BACKUP_RETENTION.maxAgeDays } =
        (yield* settings.get).backups ??
          {}
      const oldest = DateTime.toEpochMillis(yield* DateTime.now) - maxAgeDays * DAY_MILLIS
      const seen = new Map<string, number>()
      const stale = (yield* list(dir)).filter((backup) => {
        const index = seen.get(backup.fileName) ?? 0
        seen.set(backup.fileName, index + 1)
        return index >= keep || backup.millis < oldest
      })
      yield* Effect.forEach(stale, (backup) =>
        fs.remove(path.join(dir, backup.id)).pipe(
          Effect.catch((error) => Effect.logWarning(`Couldn't remove the backup ${backup.id}`, error))
        ), { discard: true })
    })

    /**
     * Keeps `bytes`, the current content of `file`, in `dir`: by moving `file` there when `move`, else by copying.
     * Skipped when the newest backup of that file name holds the same bytes (a moved file is then removed).
     */
    const keep = Effect.fnUntraced(function*(dir: string, file: string, bytes: Uint8Array, move: boolean) {
      const fileName = path.basename(file)
      const newest = (yield* list(dir)).find((backup) => backup.fileName === fileName)
      const newestBytes = newest === undefined
        ? Option.none()
        : yield* Effect.option(fs.readFile(path.join(dir, newest.id)))
      if (Option.isSome(newestBytes) && sameBytes(newestBytes.value, bytes)) {
        if (move) yield* fs.remove(file)
        return
      }
      // Strictly after the newest, so two backups in the same millisecond keep their order and both names.
      const millis = Math.max(DateTime.toEpochMillis(yield* DateTime.now), (newest?.millis ?? -Infinity) + 1)
      const target = path.join(dir, `${stampOf(millis)} ${fileName}`)
      yield* fs.makeDirectory(dir, { recursive: true })
      yield* move ? fs.rename(file, target) : writeAtomic(fs, target, bytes)
    })

    /** The file's bytes; none when it doesn't exist. */
    const current = (file: string) =>
      fs.readFile(file).pipe(
        Effect.asSome,
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound" ? Effect.succeedNone : Effect.fail(error))
      )

    const overwrite = Effect.fn("Backups.overwrite")(
      function*(dir: string, file: string, data: string | Uint8Array) {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
        const old = yield* current(file).pipe(
          Effect.mapError((cause) => new BackupError({ path: file, reason: "backup", cause }))
        )
        if (Option.isSome(old) && sameBytes(old.value, bytes)) return false
        if (Option.isSome(old)) {
          yield* keep(dir, file, old.value, false).pipe(
            Effect.mapError((cause) => new BackupError({ path: file, reason: "backup", cause }))
          )
        }
        yield* writeAtomic(fs, file, bytes).pipe(
          Effect.mapError((cause) => new BackupError({ path: file, reason: "write", cause }))
        )
        yield* prune(dir)
        return true
      },
      lock.withPermits(1)
    )

    const retire = Effect.fn("Backups.retire")(
      function*(dir: string, file: string) {
        const old = yield* current(file)
        if (Option.isNone(old)) return
        yield* keep(dir, file, old.value, true)
        yield* prune(dir)
      },
      (effect, _dir, file) =>
        effect.pipe(Effect.mapError((cause) => new BackupError({ path: file, reason: "backup", cause }))),
      lock.withPermits(1)
    )

    return Backups.of({ overwrite, retire, list })
  })

  static readonly layer = Layer.effect(Backups, Backups.make)
}
