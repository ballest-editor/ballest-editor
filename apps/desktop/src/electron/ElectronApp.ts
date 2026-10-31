import { Context, Effect, Layer, Schema, type Scope } from "effect"
import * as Electron from "electron"

export interface ElectronAppMetadata {
  readonly appVersion: string
  readonly appPath: string
  readonly userData: string
  /** The user's documents folder, where the default project goes. */
  readonly documents: string
  readonly isPackaged: boolean
  readonly resourcesPath: string
}

export class ElectronAppReadyError extends Schema.TaggedError<ElectronAppReadyError>()("ElectronAppReadyError", {
  cause: Schema.Defect()
}) {
  override get message(): string {
    return "Electron failed to become ready."
  }
}

export class ElectronApp extends Context.Service<ElectronApp, {
  readonly metadata: Effect.Effect<ElectronAppMetadata>
  readonly whenReady: Effect.Effect<void, ElectronAppReadyError>
  readonly quit: Effect.Effect<void>
  /** Listens to an `app` event until the scope closes. */
  readonly on: (
    eventName: string,
    listener: (event: Electron.Event) => void
  ) => Effect.Effect<void, never, Scope.Scope>
}>()("ballest/desktop/electron/ElectronApp") {
  static readonly layer = Layer.succeed(
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
}
