import { Context, Effect, Layer, Schema, type Scope } from "effect"
import * as Electron from "electron"

export class ElectronWindowCreateError extends Schema.TaggedError<ElectronWindowCreateError>()(
  "ElectronWindowCreateError",
  { cause: Schema.Defect() }
) {
  override get message(): string {
    return "Failed to create the Electron window."
  }
}

export class ElectronWindowLoadError extends Schema.TaggedError<ElectronWindowLoadError>()(
  "ElectronWindowLoadError",
  { url: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `The window failed to load ${this.url}.`
  }
}

export class ElectronWindow extends Context.Service<ElectronWindow, {
  /** A window that is destroyed when the scope closes, if the user hasn't closed it first. */
  readonly create: (
    options: Electron.BrowserWindowConstructorOptions
  ) => Effect.Effect<Electron.BrowserWindow, ElectronWindowCreateError, Scope.Scope>
  readonly load: (window: Electron.BrowserWindow, url: string) => Effect.Effect<void, ElectronWindowLoadError>
  /** Completes once the window has been closed and destroyed. */
  readonly closed: (window: Electron.BrowserWindow) => Effect.Effect<void>
  /** Each display's work area, for checking that saved bounds are still on screen. */
  readonly workAreas: Effect.Effect<ReadonlyArray<Electron.Rectangle>>
}>()("ballest/desktop/electron/ElectronWindow") {
  static readonly layer = Layer.succeed(
    ElectronWindow,
    ElectronWindow.of({
      create: (options) =>
        Effect.acquireRelease(
          Effect.try({
            try: () => new Electron.BrowserWindow(options),
            catch: (cause) => new ElectronWindowCreateError({ cause })
          }),
          (window) =>
            Effect.sync(() => {
              if (!window.isDestroyed()) window.destroy()
            })
        ),
      load: (window, url) =>
        Effect.tryPromise({
          try: () => window.loadURL(url),
          catch: (cause) => new ElectronWindowLoadError({ url, cause })
        }),
      closed: (window) =>
        Effect.callback<void>((resume) => {
          if (window.isDestroyed()) {
            resume(Effect.void)
            return
          }
          const listener = () => resume(Effect.void)
          window.once("closed", listener)
          return Effect.sync(() => {
            if (!window.isDestroyed()) window.removeListener("closed", listener)
          })
        }),
      workAreas: Effect.sync(() => Electron.screen.getAllDisplays().map((display) => display.workArea))
    })
  )
}
