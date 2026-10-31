import type * as Electron from "electron"

/** The page's top bar (`TopBar.tsx`, `h-10`): the window controls are drawn over its end. */
export const TITLE_BAR_HEIGHT = 40

/**
 * The window controls Electron draws over the page's top bar, in the page theme's colours. The overlay itself is
 * clear so the top bar shows through; fully transparent (`#00000000`) renders wrong on Linux, hence `#01000000`.
 */
export const titleBarOverlay = (dark: boolean): Electron.TitleBarOverlayOptions => ({
  color: "#01000000",
  symbolColor: dark ? "#fafafa" : "#09090b",
  height: TITLE_BAR_HEIGHT
})

/** The page's `--background`, so a resize never flashes the other theme's colour. */
export const windowBackground = (dark: boolean): string => dark ? "#09090b" : "#ffffff"

/**
 * The window shortcuts an application menu would have given. Installed builds have no menu (nothing to reload or
 * close the window behind the editor's back), so main handles these before the page sees the key.
 */
export type WindowShortcut = "quit" | "toggleFullScreen"

export const windowShortcutOf = (input: Electron.Input): WindowShortcut | undefined => {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.alt || input.meta) return undefined
  if (input.code === "F11" && !input.control && !input.shift) return "toggleFullScreen"
  if (input.code === "KeyQ" && input.control && !input.shift) return "quit"
  return undefined
}
