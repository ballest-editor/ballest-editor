import type { RecoveryEntry } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { writeAtomic } from "./files"
import { WindowRegistry } from "./WindowRegistry"

/** The window that wrote the snapshot `<pid>.<key>.json`, and its key. Temp files and anything else don't parse. */
const parseName = (name: string) => {
  const [, pid, key] = /^(\d+)\.([0-9a-f-]{36})\.json$/.exec(name) ?? []
  return pid === undefined || key === undefined ? undefined : { pid: Number(pid), key }
}

/** A snapshot couldn't be written. The page has to know: it lets the one before go only after this one is on disk. */
export class RecoveryWriteError extends Schema.TaggedError<RecoveryWriteError>()("RecoveryWriteError", {
  key: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `Could not keep the recovery snapshot ${this.key}`
  }
}

/**
 * The tabs' unsaved edits, kept on disk for as long as they have any (docs/DESKTOP.md § Recovery): one file per tab,
 * `<userData>/recovery/<pid>.<key>.json`, named for the window that wrote it, so what a live window owns stays out of
 * the list the next launch sees. The text is the page's: this only keeps it.
 */
export class Recovery extends Context.Service<Recovery, {
  /** What no other running window owns. This window's are in it, for a reloaded page, which owns none of them, to find. */
  readonly list: Effect.Effect<ReadonlyArray<RecoveryEntry>>
  /** Keeps `text` under `key`, atomically. */
  readonly write: (entry: RecoveryEntry) => Effect.Effect<void, RecoveryWriteError>
  /** Drops the snapshot `key`, whichever window wrote it. */
  readonly remove: (key: string) => Effect.Effect<void>
}>()("ballest/desktop/project/Recovery") {
  static readonly make = Effect.fn("Recovery.make")(function*(folder: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const registry = yield* WindowRegistry

    const names = fs.readDirectory(folder).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))

    const list = Effect.gen(function*() {
      const others = new Set((yield* registry.others).map(({ pid }) => pid))
      const found = yield* Effect.forEach(yield* names, (name) => {
        const parsed = parseName(name)
        if (parsed === undefined || others.has(parsed.pid)) return Effect.succeed([])
        return fs.readFileString(path.join(folder, name)).pipe(
          Effect.map((text) => [{ key: parsed.key, text }]),
          // gone since the listing: its owner saved it
          Effect.orElseSucceed((): ReadonlyArray<RecoveryEntry> => [])
        )
      })
      return found.flat()
    })

    const write = ({ key, text }: RecoveryEntry) =>
      fs.makeDirectory(folder, { recursive: true }).pipe(
        Effect.andThen(writeAtomic(fs, path.join(folder, `${registry.pid}.${key}.json`), text)),
        Effect.mapError((cause) => new RecoveryWriteError({ key, cause }))
      )

    const remove = (key: string) =>
      names.pipe(
        Effect.map((all) => all.filter((name) => parseName(name)?.key === key)),
        Effect.flatMap(Effect.forEach((name) => Effect.ignore(fs.remove(path.join(folder, name), { force: true })))),
        Effect.asVoid
      )

    return Recovery.of({ list, write, remove })
  })

  static readonly layer = Layer.effect(
    Recovery,
    Effect.gen(function*() {
      return yield* Recovery.make((yield* DesktopEnvironment).recoveryDir)
    })
  )
}
