import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
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

/** `desktop-settings.json`: what the main process remembers between runs. The renderer's settings live in its own storage. */
export const DesktopSettingsFile = Schema.Struct({
  window: Schema.optional(WindowState)
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
  /** Replaces the file atomically: a crash mid-write leaves the previous settings, never half a file. */
  readonly set: (settings: DesktopSettingsFile) => Effect.Effect<void, DesktopSettingsWriteError>
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

    const set = (settings: DesktopSettingsFile) => {
      const temp = `${file}.${process.pid}.tmp`
      return Schema.encodeEffect(SettingsJson)(settings).pipe(
        Effect.tap(() => fs.makeDirectory(path.dirname(file), { recursive: true })),
        Effect.flatMap((json) => fs.writeFileString(temp, json)),
        Effect.andThen(fs.rename(temp, file)),
        Effect.mapError((cause) => new DesktopSettingsWriteError({ path: file, cause }))
      )
    }

    return DesktopSettings.of({ get, set })
  })

  static readonly layer = Layer.effect(
    DesktopSettings,
    Effect.gen(function*() {
      const { settingsPath } = yield* DesktopEnvironment
      return yield* DesktopSettings.make(settingsPath)
    })
  )
}
