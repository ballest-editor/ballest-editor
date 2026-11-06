import type * as Electron from "electron"

/** The page's top bar (`TopBar.tsx`, `h-10`): the window controls are drawn over its end. */
export const TITLE_BAR_HEIGHT = 40

/**
 * The window controls Electron draws over the page's top bar, in the page theme's colours. The overlay itself is
 * clear so the top bar shows through; fully transparent (`#00000000`) renders wrong on Linux, hence `#01000000`.
 */
export const titleBarOverlay = (dark: boolean): Electron.TitleBarOverlayOptions => ({
  color: "#01000000",
  symbolColor: dark ? "#f5f7f9" : "#393d42",
  height: TITLE_BAR_HEIGHT
})

/** Same scheme and host as the app; `URL.origin` is "null" for every custom scheme, so it can't be compared. */
export const isAppUrl = (target: string, app: URL): boolean => {
  const url = URL.parse(target)
  return url !== null && url.protocol === app.protocol && url.host === app.host
}

/** The page a panel pops out into (`apps/web/public/popout.html`), the only window the page may open itself. */
export const isPopoutUrl = (target: string, app: URL): boolean =>
  isAppUrl(target, app) && URL.parse(target)?.pathname === "/popout.html"

/** A popped-out panel's tab strip (`h-8`, `components/dock/dock.css`): its window's title bar. */
const POPOUT_TITLE_BAR_HEIGHT = 32

/**
 * The window a panel pops out into: the main window's look, with the panel's tab strip as its title bar, floating over
 * the main window and closing with it. Dockview gives the size and position; the page reports the theme once it's in
 * (`setWindowTheme`), so it starts on the main window's background.
 */
export const popoutWindowOptions = (
  parent: Electron.BrowserWindow,
  iconPath: string
): Electron.BrowserWindowConstructorOptions => ({
  parent,
  icon: iconPath,
  minWidth: 320,
  minHeight: 240,
  titleBarStyle: "hidden",
  titleBarOverlay: popoutOverlay(titleBarOverlay(true)),
  backgroundColor: parent.getBackgroundColor()
})

/** `overlay`, the main window's title bar overlay, for a popped-out panel's window. */
export const popoutOverlay = (overlay: Electron.TitleBarOverlayOptions): Electron.TitleBarOverlayOptions => ({
  ...overlay,
  height: POPOUT_TITLE_BAR_HEIGHT
})

/** The page's `--background`, so a resize never flashes the other theme's colour. */
export const windowBackground = (dark: boolean): string => dark ? "#0b0d0f" : "#f3f5f6"

/**
 * The application menu of unpackaged builds, for its reload and DevTools keys. Nothing here may close the window:
 * Ctrl+W is Ctrl (fly down) and W (fly forward) held together.
 */
export const devMenuTemplate: Array<Electron.MenuItemConstructorOptions> = [
  { label: "Develop", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }] }
]

/**
 * The window shortcuts an application menu would have given. Neither build's menu has them (nothing may reload or
 * close the window behind the editor's back), so main handles these before the page sees the key.
 */
export type WindowShortcut = "quit" | "toggleFullScreen"

export const windowShortcutOf = (input: Electron.Input): WindowShortcut | undefined => {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.alt || input.meta) return undefined
  if (input.code === "F11" && !input.control && !input.shift) return "toggleFullScreen"
  if (input.code === "KeyQ" && input.control && !input.shift) return "quit"
  return undefined
}
