import { Context, Effect, Layer, Option } from "effect"
import type * as Electron from "electron"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { desktopUrl } from "../electron/ElectronProtocol"
import { ElectronShell } from "../electron/ElectronShell"
import {
  ElectronWindow,
  type ElectronWindowCreateError,
  type ElectronWindowLoadError
} from "../electron/ElectronWindow"
import { DesktopSettings, type WindowState } from "../settings/DesktopSettings"

const DEFAULT_SIZE = { width: 1440, height: 900 }
/** The editor's panels and viewport need about this much room. */
const MIN_SIZE = { minWidth: 960, minHeight: 600 }

/** Saved bounds whose title bar is on no current display (a monitor was unplugged) are dropped. */
const isOnScreen = (state: WindowState, workAreas: ReadonlyArray<Electron.Rectangle>) =>
  workAreas.some((area) =>
    state.x < area.x + area.width && state.x + state.width > area.x
    && state.y >= area.y && state.y < area.y + area.height
  )

const windowState = (window: Electron.BrowserWindow): WindowState => {
  const bounds = window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds()
  return { ...bounds, maximized: window.isMaximized() }
}

/** Same scheme and host as the app; `URL.origin` is "null" for every custom scheme, so it can't be compared. */
const isAppUrl = (target: string, app: URL) => {
  const url = URL.parse(target)
  return url !== null && url.protocol === app.protocol && url.host === app.host
}

export class DesktopWindow extends Context.Service<DesktopWindow, {
  /** Opens the editor window and completes when the user closes it; its bounds are saved for the next run. */
  readonly runMain: Effect.Effect<void, ElectronWindowCreateError | ElectronWindowLoadError>
}>()("ballest/desktop/window/DesktopWindow") {
  static readonly layer = Layer.effect(
    DesktopWindow,
    Effect.gen(function*() {
      const environment = yield* DesktopEnvironment
      const electronWindow = yield* ElectronWindow
      const shell = yield* ElectronShell
      const settings = yield* DesktopSettings
      const url = desktopUrl(environment.isDevelopment)
      const appUrl = new URL(url)

      const runMain = Effect.gen(function*() {
        const saved = yield* settings.get
        const workAreas = yield* electronWindow.workAreas
        const restored = Option.fromNullishOr(saved.window).pipe(
          Option.filter((state) => isOnScreen(state, workAreas))
        )

        const window = yield* electronWindow.create({
          ...Option.match(restored, {
            onNone: () => DEFAULT_SIZE,
            onSome: ({ x, y, width, height }) => ({ x, y, width, height })
          }),
          ...MIN_SIZE,
          title: "Ballest Editor",
          show: false,
          backgroundColor: "#0a0a0a",
          autoHideMenuBar: true,
          webPreferences: {
            preload: environment.preloadPath,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
          }
        })

        // Captured on `close`, while the window still has bounds; written once it is gone.
        let lastState: WindowState | undefined
        window.on("close", () => {
          lastState = windowState(window)
        })
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => lastState === undefined ? Effect.void : settings.set({ ...saved, window: lastState }))
            .pipe(
              Effect.catchTag("DesktopSettingsWriteError", (error) => Effect.logWarning(error.message, error.cause))
            )
        )

        window.once("ready-to-show", () => {
          if (Option.isSome(restored) && restored.value.maximized) window.maximize()
          window.show()
        })

        // The app never opens a second window or navigates away from itself: links go to the browser.
        const runFork = Effect.runForkWith(yield* Effect.context())
        window.webContents.setWindowOpenHandler(({ url: target }) => {
          runFork(shell.openExternal(target))
          return { action: "deny" }
        })
        window.webContents.on("will-navigate", (event, target) => {
          if (isAppUrl(target, appUrl)) return
          event.preventDefault()
          runFork(shell.openExternal(target))
        })

        yield* electronWindow.load(window, url)
        yield* electronWindow.closed(window)
      }).pipe(Effect.scoped)

      return DesktopWindow.of({ runMain })
    })
  )
}
