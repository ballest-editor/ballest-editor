import { Effect, Layer } from "effect"
import * as Electron from "electron"
import { ElectronWindow, ElectronWindowCreateError, ElectronWindowLoadError } from "../ElectronWindow"

export const layerElectronWindow = Layer.succeed(
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
    workAreas: Effect.sync(() => Electron.screen.getAllDisplays().map((display) => display.workArea)),
    setColors: (webContentsId, { overlay, popoutOverlay, background }) =>
      Effect.sync(() => {
        const contents = Electron.webContents.fromId(webContentsId)
        const window = contents === undefined ? null : Electron.BrowserWindow.fromWebContents(contents)
        if (window === null || window.isDestroyed()) return
        window.setBackgroundColor(background)
        window.setTitleBarOverlay(overlay)
        for (const popout of window.getChildWindows()) {
          popout.setBackgroundColor(background)
          popout.setTitleBarOverlay(popoutOverlay)
        }
      }),
    sendAll: (channel, payload) =>
      Effect.sync(() => {
        for (const window of Electron.BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(channel, payload)
        }
      })
  })
)
