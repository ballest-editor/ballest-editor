import { Cause, Effect, Option } from "effect"
import { ElectronApp } from "../electron/ElectronApp"
import { ElectronDialog } from "../electron/ElectronDialog"
import { ElectronMenu } from "../electron/ElectronMenu"
import { type DesktopProtocolSource, ElectronProtocol } from "../electron/ElectronProtocol"
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers"
import { DesktopWindow } from "../window/DesktopWindow"
import { DesktopEnvironment } from "./DesktopEnvironment"

const protocolSource = (environment: DesktopEnvironment["Service"]): DesktopProtocolSource =>
  Option.match(environment.devServerUrl, {
    onSome: (origin) => ({ _tag: "DevServer", origin }),
    onNone: () => ({
      _tag: "Static",
      site: {
        mounts: [
          { prefix: "/", directory: environment.rendererDir },
          ...Option.toArray(environment.assetsDir).map((directory) => ({ prefix: "/assets/", directory }))
        ],
        fallback: `${environment.rendererDir}/index.html`
      }
    })
  })

const run = Effect.gen(function*() {
  const app = yield* ElectronApp
  const environment = yield* DesktopEnvironment

  // Electron quits on its own once the last window closes, or straight after a Quit from the menu. Hold it off
  // until this scope has closed (window bounds saved, handlers removed); the program quits itself below.
  yield* app.on("window-all-closed", () => {})
  yield* app.on("will-quit", (event) => event.preventDefault())

  yield* app.whenReady
  // Installed builds have no application menu: the page's menu bar is the UI, and Electron's default one would
  // reload or close the window behind the editor's back. DesktopWindow handles F11 and Ctrl+Q instead.
  if (environment.isPackaged) yield* (yield* ElectronMenu).remove
  yield* (yield* ElectronProtocol).register(protocolSource(environment))
  yield* installDesktopIpcHandlers()
  yield* (yield* DesktopWindow).runMain
}).pipe(Effect.scoped)

/** whenReady → protocol → IPC handlers → window, until the window closes. Any failure is shown, then the app quits. */
export const program = Effect.gen(function*() {
  const app = yield* ElectronApp
  const dialog = yield* ElectronDialog
  yield* run.pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : dialog.showErrorBox("Ballest Editor failed", Cause.pretty(cause))
    ),
    Effect.ensuring(app.quit)
  )
})
