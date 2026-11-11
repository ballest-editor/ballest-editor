import { Effect, Layer, Option } from "effect"
import { autoUpdater } from "electron-updater"
import { ElectronUpdater, ElectronUpdaterError, findRelease } from "../ElectronUpdater"

export const layerElectronUpdater = Layer.succeed(
  ElectronUpdater,
  ElectronUpdater.of({
    configure: ({ feed }) =>
      Effect.sync(() => {
        autoUpdater.autoDownload = false
        autoUpdater.autoInstallOnAppQuit = false
        if (Option.isSome(feed)) autoUpdater.setFeedURL({ provider: "generic", url: feed.value.href })
      }),
    checkForUpdates: Effect.suspend(() => findRelease(autoUpdater)),
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
