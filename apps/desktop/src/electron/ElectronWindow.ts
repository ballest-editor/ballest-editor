import { Context, Effect, Layer, Schema, type Scope } from "effect"
import type * as Electron from "electron"

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
  /**
   * Recolours the window showing `webContentsId` and the windows it popped its panels out into: their title bar overlays
   * and backgrounds. Nothing if it has none.
   */
  readonly setColors: (
    webContentsId: number,
    colors: {
      readonly overlay: Electron.TitleBarOverlayOptions
      readonly popoutOverlay: Electron.TitleBarOverlayOptions
      readonly background: string
    }
  ) => Effect.Effect<void>
  /** Sends `payload` on `channel` to every window's page (main → renderer). */
  readonly sendAll: (channel: string, payload: unknown) => Effect.Effect<void>
}>()("ballest/desktop/electron/ElectronWindow") {
  /** For tests: `methods`, and a defect from anything else. */
  static readonly layerTest = (methods: Partial<ElectronWindow["Service"]>) =>
    Layer.succeed(
      ElectronWindow,
      ElectronWindow.of({
        create: () => Effect.die("unused"),
        load: () => Effect.die("unused"),
        closed: () => Effect.die("unused"),
        workAreas: Effect.succeed([]),
        setColors: () => Effect.die("unused"),
        sendAll: () => Effect.die("unused"),
        ...methods
      })
    )
}
