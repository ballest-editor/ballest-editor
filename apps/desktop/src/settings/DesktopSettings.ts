import { Context, Effect, FileSystem, Layer, Path, Schema, Semaphore } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"

const Size = Schema.Int.check(Schema.isGreaterThan(0))

export const WindowState = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Size,
  height: Size,
  maximized: Schema.Boolean
})
export type WindowState = typeof WindowState.Type

/** Game folders chosen in settings in place of the ones found through Steam (game/GamePaths.ts). */
export const GamePathOverrides = Schema.Struct({
  install: Schema.optional(Schema.String),
  mapsFolder: Schema.optional(Schema.String),
  pluginsFolder: Schema.optional(Schema.String)
})
export type GamePathOverrides = typeof GamePathOverrides.Type

/** The projects used on this machine (project/Projects.ts). */
export const ProjectSettings = Schema.Struct({
  /** Project folders, the one in use first (at most 8). Empty: the default project. */
  recent: Schema.optional(Schema.Array(Schema.String))
})
export type ProjectSettings = typeof ProjectSettings.Type

/** `desktop-settings.json`: what the main process remembers between runs. The renderer's settings live in its own storage. */
export const DesktopSettingsFile = Schema.Struct({
  window: Schema.optional(WindowState),
  project: Schema.optional(ProjectSettings),
  game: Schema.optional(GamePathOverrides)
})
export type DesktopSettingsFile = typeof DesktopSettingsFile.Type

const SettingsJson = Schema.fromJsonString(DesktopSettingsFile)

export class DesktopSettingsWriteError extends Schema.TaggedError<DesktopSettingsWriteError>()(
  "DesktopSettingsWriteError",
  { path: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Failed to write desktop settings to ${this.path}.`
  }
}

export class DesktopSettings extends Context.Service<DesktopSettings, {
  /** The saved settings; empty when the file is missing or doesn't decode (it is only ever a convenience). */
  readonly get: Effect.Effect<DesktopSettingsFile>
  /**
   * Reads the file, applies `f` and writes the result back. Updates run one at a time, so two of them (the window's
   * bounds, a recent project) never lose each other's change. The write is atomic: a crash mid-write leaves the previous
   * settings, never half a file.
   */
  readonly update: (
    f: (settings: DesktopSettingsFile) => DesktopSettingsFile
  ) => Effect.Effect<DesktopSettingsFile, DesktopSettingsWriteError>
}>()("ballest/desktop/settings/DesktopSettings") {
  static readonly make = Effect.fn("DesktopSettings.make")(function*(file: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const get = fs.readFileString(file).pipe(
      Effect.flatMap(Schema.decodeEffect(SettingsJson)),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed({})
            : Effect.logWarning("Could not read desktop settings", error).pipe(Effect.as({})),
        SchemaError: (error) =>
          Effect.logWarning("Ignoring invalid desktop settings", error.message).pipe(Effect.as({}))
      })
    )

    const write = (settings: DesktopSettingsFile) => {
      const temp = `${file}.${process.pid}.tmp`
      return Schema.encodeEffect(SettingsJson)(settings).pipe(
        Effect.tap(() => fs.makeDirectory(path.dirname(file), { recursive: true })),
        Effect.flatMap((json) => fs.writeFileString(temp, json)),
        Effect.andThen(fs.rename(temp, file)),
        Effect.mapError((cause) => new DesktopSettingsWriteError({ path: file, cause }))
      )
    }

    const lock = yield* Semaphore.make(1)
    const update = (f: (settings: DesktopSettingsFile) => DesktopSettingsFile) =>
      Effect.gen(function*() {
        const next = f(yield* get)
        yield* write(next)
        return next
      }).pipe(lock.withPermits(1))

    return DesktopSettings.of({ get, update })
  })

  static readonly layer = Layer.effect(
    DesktopSettings,
    Effect.gen(function*() {
      const { settingsPath } = yield* DesktopEnvironment
      return yield* DesktopSettings.make(settingsPath)
    })
  )
}
