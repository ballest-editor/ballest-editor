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
import { UNLOAD_REQUEST_CHANNEL } from "../ipc/channels"
import { DesktopSettings, type WindowState } from "../settings/DesktopSettings"
import { titleBarOverlay, windowBackground, windowShortcutOf } from "./chrome"

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
          // Windows takes the taskbar icon from the exe; Linux (and every unpackaged run) from this.
          icon: environment.iconPath,
          show: false,
          // No native title bar: the page's top bar is the title bar, and Electron draws the window controls over
          // its end (on the side the desktop puts them). The page starts dark and reports its theme (setWindowTheme).
          titleBarStyle: "hidden",
          titleBarOverlay: titleBarOverlay(true),
          backgroundColor: windowBackground(true),
          webPreferences: {
            preload: environment.preloadPath,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
          }
        })

        // Captured on `close`, while the window still has bounds; written once it is gone.
        let lastState: WindowState | undefined
        // Whether the unload the page is holding is a close (the close button, Alt+F4, Ctrl+Q) or a reload.
        let closing = false
        window.on("close", () => {
          lastState = windowState(window)
          closing = true
        })
        // The page holds the unload (its `beforeunload` cancels it) while the open map has unsaved edits. Electron
        // then keeps the window open, and the page asks Save / Don't save / Cancel before closing or reloading itself.
        window.webContents.on("will-prevent-unload", () => {
          const kind = closing ? "close" : "reload"
          closing = false
          window.webContents.send(UNLOAD_REQUEST_CHANNEL, kind)
        })
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            const state = lastState
            return state === undefined ? Effect.void : settings.update((current) => ({ ...current, window: state }))
          }).pipe(
            Effect.asVoid,
            Effect.catchTag("DesktopSettingsWriteError", (error) => Effect.logWarning(error.message, error.cause))
          )
        )

        // A menu bar never shows. Unpackaged builds keep Electron's default menu for its reload and DevTools keys.
        window.setMenuBarVisibility(false)
        window.webContents.on("before-input-event", (event, input) => {
          const shortcut = windowShortcutOf(input)
          if (shortcut === undefined) return
          event.preventDefault()
          if (shortcut === "quit") window.close()
          else window.setFullScreen(!window.isFullScreen())
        })

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
