import { PushChannels } from "@ballest/contracts"
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
import { Projects } from "../project/Projects"
import { DesktopSettings, type WindowState } from "../settings/DesktopSettings"
import {
  isAppUrl,
  isPopoutUrl,
  popoutWindowOptions,
  titleBarOverlay,
  windowBackground,
  windowShortcutOf
} from "./chrome"
import { WindowStage } from "./WindowStage"

const DEFAULT_SIZE = { width: 1440, height: 900 }
/** The editor's panels and viewport need about this much room. */
const MIN_SIZE = { minWidth: 960, minHeight: 600 }
/** The welcome window: room for its two columns, centred, until a project is picked and it grows into the editor. */
const WELCOME_SIZE = { width: 960, height: 640, minWidth: 720, minHeight: 520 }

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

export class DesktopWindow extends Context.Service<DesktopWindow, {
  /**
   * Opens the editor window and completes when the user closes it; its bounds are saved for the next run. A window on
   * the welcome window starts small and centred, and takes the editor's bounds once its project is in use.
   */
  readonly runMain: Effect.Effect<void, ElectronWindowCreateError | ElectronWindowLoadError>
}>()("ballest/desktop/window/DesktopWindow") {
  static readonly layer = Layer.effect(
    DesktopWindow,
    Effect.gen(function*() {
      const environment = yield* DesktopEnvironment
      const electronWindow = yield* ElectronWindow
      const shell = yield* ElectronShell
      const settings = yield* DesktopSettings
      const projects = yield* Projects
      const stage = yield* WindowStage
      const url = desktopUrl(environment.isDevelopment)
      const appUrl = new URL(url)

      const runMain = Effect.gen(function*() {
        const saved = yield* settings.get
        const workAreas = yield* electronWindow.workAreas
        const restored = Option.fromNullishOr(saved.window).pipe(
          Option.filter((state) => isOnScreen(state, workAreas))
        )

        const editorBounds = Option.match(restored, {
          onNone: (): Partial<Electron.Rectangle> & typeof DEFAULT_SIZE => DEFAULT_SIZE,
          onSome: ({ x, y, width, height }) => ({ x, y, width, height })
        })
        // A window that must choose says so in its URL, so that its first paint is the start screen's, not the editor's
        // skeleton: the page hears `ProjectState` only once its code has loaded.
        const { chooserRequired } = yield* projects.state
        let welcome = chooserRequired

        const window = yield* electronWindow.create({
          ...welcome ? { ...WELCOME_SIZE, center: true } : { ...editorBounds, ...MIN_SIZE },
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
          // the welcome window's size isn't the editor's: the editor's stays as it was
          lastState = welcome ? undefined : windowState(window)
          closing = true
        })
        // The page holds the unload (its `beforeunload` cancels it) while the open map has unsaved edits. Electron
        // then keeps the window open, and the page asks Save / Don't save / Cancel before closing or reloading itself.
        window.webContents.on("will-prevent-unload", () => {
          const kind = closing ? "close" : "reload"
          closing = false
          window.webContents.send(PushChannels.onUnloadRequest, kind)
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

        // A menu bar never shows. Unpackaged builds keep a menu only for its reload and DevTools keys (devMenuTemplate).
        window.setMenuBarVisibility(false)
        // Quit is the editor window's close, from a panel's window too: that's where the unsaved-changes prompt is.
        const handleShortcuts = (target: Electron.BrowserWindow) =>
          target.webContents.on("before-input-event", (event, input) => {
            const shortcut = windowShortcutOf(input)
            if (shortcut === undefined) return
            event.preventDefault()
            if (shortcut === "quit") window.close()
            else target.setFullScreen(!target.isFullScreen())
          })
        handleShortcuts(window)

        // Shown at once, in the page's starting background: a new window is another copy of the app, and waiting for the
        // page's first paint kept it out of sight while that page's code loaded. The page's first paint is the editor's
        // frame (index.html), ahead of its code.
        const maximized = Option.isSome(restored) && restored.value.maximized
        if (!welcome && maximized) window.maximize()
        window.show()

        // The welcome window grows into the editor, where the editor was last left, once the page has the project open
        // and asks to show it (`WindowStage`): the page shows the editor only after.
        yield* Effect.forkScoped(stage.whenEditorShown(
          Effect.sync(() => {
            if (!welcome) return
            welcome = false
            window.setMinimumSize(MIN_SIZE.minWidth, MIN_SIZE.minHeight)
            if (editorBounds.x === undefined) {
              window.setSize(editorBounds.width, editorBounds.height)
              window.center()
            } else {
              window.setBounds(editorBounds)
            }
            if (maximized) window.maximize()
          })
        ))

        // A window never opens another in this process (a new window is a new copy, WindowLauncher) or navigates away from
        // itself: links go to the browser. The one exception is a panel popped out into a window of its own, which stays
        // part of this page: the page reaches into it directly, so it must be a same-origin child, in this process.
        const runFork = Effect.runForkWith(yield* Effect.context())
        const keepLinksOut = (target: Electron.BrowserWindow) => {
          target.webContents.setWindowOpenHandler(({ url: opened }) => {
            if (target === window && isPopoutUrl(opened, appUrl)) {
              return {
                action: "allow",
                overrideBrowserWindowOptions: popoutWindowOptions(window, environment.iconPath)
              }
            }
            runFork(shell.openExternal(opened))
            return { action: "deny" }
          })
          target.webContents.on("will-navigate", (event, opened) => {
            if (isAppUrl(opened, appUrl)) return
            event.preventDefault()
            runFork(shell.openExternal(opened))
          })
        }
        keepLinksOut(window)
        window.webContents.on("did-create-window", (popout) => {
          popout.setMenuBarVisibility(false)
          handleShortcuts(popout)
          keepLinksOut(popout)
        })

        yield* electronWindow.load(window, chooserRequired ? `${url}?chooser` : url)
        yield* electronWindow.closed(window)
      }).pipe(Effect.scoped)

      return DesktopWindow.of({ runMain })
    })
  )
}
