import type { MapFileRef, OpenedMapFile, RecentMapFiles } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { DesktopSettings, type DesktopSettingsFile } from "../settings/DesktopSettings"

/** What the open dialog offers and what may be read or written at all. */
export const MAP_EXTENSIONS = [".balledit", ".ballmap", ".json"] as const

const RECENT_LIMIT = 8
/** The game's largest maps are a few MB; anything this size isn't a map. */
const MAX_BYTES = 64 * 1024 * 1024

export class MapFileError extends Schema.TaggedError<MapFileError>()("MapFileError", {
  path: Schema.String,
  reason: Schema.Literals(["notPicked", "extension", "tooLarge", "notFound", "read", "write"]),
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    switch (this.reason) {
      case "notPicked":
        return `${this.path} wasn't picked in a file dialog.`
      case "extension":
        return `${this.path} isn't a map file (${MAP_EXTENSIONS.join(", ")}).`
      case "tooLarge":
        return `${this.path} is too large to be a map.`
      case "notFound":
        return `${this.path} doesn't exist any more.`
      case "read":
        return `Couldn't read ${this.path}.`
      case "write":
        return `Couldn't write ${this.path}.`
    }
  }
}

const withRecent = (path: string, touch: boolean) => (settings: DesktopSettingsFile): DesktopSettingsFile => {
  const others = (settings.recentMaps ?? []).filter((p) => p !== path)
  return { ...settings, recentMaps: (touch ? [path, ...others] : others).slice(0, RECENT_LIMIT) }
}

/**
 * The map files the renderer may touch. Main never takes a path from the page on trust: only files the user picked in
 * a dialog this session (`grant`), or picked before (the recent files), and only map files. Reads and writes keep the
 * bytes as they are: UTF-8, no BOM added or removed, line endings untouched.
 */
export class MapFiles extends Context.Service<MapFiles, {
  /** The user picked `path` in a dialog: `read` and `write` may use it from now on. */
  readonly grant: (path: string) => Effect.Effect<void>
  /** Reads a picked file and puts it first in the recent files (or drops it from them when it is gone). */
  readonly read: (path: string) => Effect.Effect<OpenedMapFile, MapFileError>
  /** Replaces a picked file atomically (a crash leaves the old file, never half of one); first in the recent files. */
  readonly write: (path: string, text: string) => Effect.Effect<MapFileRef, MapFileError>
  readonly recent: Effect.Effect<RecentMapFiles>
}>()("ballest/desktop/files/MapFiles") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const settings = yield* DesktopSettings

    const granted = new Set((yield* settings.get).recentMaps?.map((p) => path.resolve(p)))
    const refOf = (file: string): MapFileRef => ({ path: file, name: path.basename(file) })

    const updateRecent = (file: string, touch: boolean) =>
      settings.update(withRecent(file, touch)).pipe(
        Effect.asVoid,
        Effect.catchTag("DesktopSettingsWriteError", (error) => Effect.logWarning(error.message, error.cause))
      )

    /** The resolved path, if the renderer may use it. */
    const allowed = (raw: string) =>
      Effect.gen(function*() {
        const file = path.resolve(raw)
        if (!MAP_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext))) {
          return yield* new MapFileError({ path: file, reason: "extension" })
        }
        if (!granted.has(file)) return yield* new MapFileError({ path: file, reason: "notPicked" })
        return file
      })

    const read = Effect.fn("MapFiles.read")(function*(raw: string) {
      const file = yield* allowed(raw)
      const text = yield* fs.stat(file).pipe(
        Effect.filterOrFail(
          (info) => Number(info.size) <= MAX_BYTES,
          () => new MapFileError({ path: file, reason: "tooLarge" })
        ),
        Effect.andThen(fs.readFileString(file)),
        Effect.catchTag("PlatformError", (cause) =>
          cause.reason._tag === "NotFound"
            ? updateRecent(file, false).pipe(
              Effect.andThen(Effect.fail(new MapFileError({ path: file, reason: "notFound" })))
            )
            : Effect.fail(new MapFileError({ path: file, reason: "read", cause })))
      )
      yield* updateRecent(file, true)
      return { ...refOf(file), text } satisfies OpenedMapFile
    })

    const write = Effect.fn("MapFiles.write")(function*(raw: string, text: string) {
      const file = yield* allowed(raw)
      const temp = `${file}.${process.pid}.tmp`
      yield* fs.writeFileString(temp, text).pipe(
        Effect.andThen(fs.rename(temp, file)),
        Effect.catchTag("PlatformError", (cause) =>
          fs.remove(temp, { force: true }).pipe(
            Effect.ignore,
            Effect.andThen(Effect.fail(new MapFileError({ path: file, reason: "write", cause })))
          ))
      )
      yield* updateRecent(file, true)
      return refOf(file)
    })

    return MapFiles.of({
      grant: (raw) => Effect.sync(() => void granted.add(path.resolve(raw))),
      read,
      write,
      recent: settings.get.pipe(Effect.map((s) => (s.recentMaps ?? []).map(refOf)))
    })
  })

  static readonly layer = Layer.effect(MapFiles, MapFiles.make)
}
