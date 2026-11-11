import { Effect, Layer } from "effect"
import * as Electron from "electron"
import { ElectronApp, ElectronAppReadyError } from "../ElectronApp"

export const layerElectronApp = Layer.succeed(
  ElectronApp,
  ElectronApp.of({
    metadata: Effect.sync(() => ({
      appVersion: Electron.app.getVersion(),
      appPath: Electron.app.getAppPath(),
      userData: Electron.app.getPath("userData"),
      documents: Electron.app.getPath("documents"),
      isPackaged: Electron.app.isPackaged,
      resourcesPath: process.resourcesPath
    })),
    whenReady: Effect.tryPromise({
      try: () => Electron.app.whenReady(),
      catch: (cause) => new ElectronAppReadyError({ cause })
    }),
    quit: Effect.sync(() => Electron.app.quit()),
    on: (eventName, listener) => {
      // `app.on` is overloaded per event name; as a plain emitter it takes any of them.
      const emitter: NodeJS.EventEmitter = Electron.app
      return Effect.acquireRelease(
        Effect.sync(() => emitter.on(eventName, listener)),
        () => Effect.sync(() => emitter.removeListener(eventName, listener))
      ).pipe(Effect.asVoid)
    }
  })
)
