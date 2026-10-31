import { Context, Effect, Layer, Option, Schema } from "effect"
import { autoUpdater } from "electron-updater"

/** A release newer than the running app, as the feed describes it. */
export interface UpdateInfo {
  readonly version: string
  /** A string (GitHub: the release body as HTML), a list of `{ version, note }` with a full changelog, or nothing. */
  readonly releaseNotes: unknown
}

/** electron-updater's errors carry the HTTP request and response after the first line. */
const describeCause = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause)
  return (message.split(/\r?\n/, 1)[0] ?? "").slice(0, 300)
}

export class ElectronUpdaterError extends Schema.TaggedError<ElectronUpdaterError>()("ElectronUpdaterError", {
  operation: Schema.Literals(["check", "download", "install"]),
  cause: Schema.Defect()
}) {
  override get message(): string {
    const verb = { check: "check for", download: "download", install: "install" }[this.operation]
    return `Couldn't ${verb} the update: ${describeCause(this.cause)}`
  }
}

export class ElectronUpdater extends Context.Service<ElectronUpdater, {
  /**
   * Nothing happens unless asked: no download after a check, no install on quit. `feed` replaces the one packaged in
   * `app-update.yml` (the mock update server's).
   */
  readonly configure: (options: { readonly feed: Option.Option<URL> }) => Effect.Effect<void>
  /** The newer release, if the feed has one. */
  readonly checkForUpdates: Effect.Effect<Option.Option<UpdateInfo>, ElectronUpdaterError>
  /** Downloads the release the last check found, calling `onProgress` with 0 to 100 on the way. */
  readonly downloadUpdate: (onProgress: (percent: number) => void) => Effect.Effect<void, ElectronUpdaterError>
  /** Hands the downloaded release to its installer, which starts it once installed, and quits the app. */
  readonly quitAndInstall: Effect.Effect<void, ElectronUpdaterError>
}>()("ballest/desktop/electron/ElectronUpdater") {
  static readonly layer = Layer.succeed(
    ElectronUpdater,
    ElectronUpdater.of({
      configure: ({ feed }) =>
        Effect.sync(() => {
          autoUpdater.autoDownload = false
          autoUpdater.autoInstallOnAppQuit = false
          if (Option.isSome(feed)) autoUpdater.setFeedURL({ provider: "generic", url: feed.value.href })
        }),
      checkForUpdates: Effect.tryPromise({
        try: () => autoUpdater.checkForUpdates(),
        catch: (cause) => new ElectronUpdaterError({ operation: "check", cause })
      }).pipe(
        // null: the updater is inactive (no app-update.yml, or Linux outside an AppImage).
        Effect.map((result) =>
          result?.isUpdateAvailable === true
            ? Option.some({ version: result.updateInfo.version, releaseNotes: result.updateInfo.releaseNotes })
            : Option.none()
        )
      ),
      downloadUpdate: (onProgress) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            const listener = ({ percent }: { readonly percent: number }) => onProgress(percent)
            autoUpdater.on("download-progress", listener)
            return listener
          }),
          () =>
            Effect.tryPromise({
              try: () => autoUpdater.downloadUpdate(),
              catch: (cause) => new ElectronUpdaterError({ operation: "download", cause })
            }),
          (listener) => Effect.sync(() => autoUpdater.removeListener("download-progress", listener))
        ).pipe(Effect.asVoid),
      // `quitAndInstall` reports a failure to start the installer as an `error` event, synchronously, and then
      // doesn't quit.
      quitAndInstall: Effect.suspend(() => {
        let failure: unknown = undefined
        const listener = (error: Error) => {
          failure = error
        }
        autoUpdater.once("error", listener)
        try {
          autoUpdater.quitAndInstall(true, true)
        } catch (cause) {
          failure = cause
        } finally {
          autoUpdater.removeListener("error", listener)
        }
        return failure === undefined
          ? Effect.void
          : Effect.fail(new ElectronUpdaterError({ operation: "install", cause: failure }))
      })
    })
  )
}
